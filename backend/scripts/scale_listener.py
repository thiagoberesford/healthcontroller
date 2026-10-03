"""Listener BLE para a Xiaomi Mi Body Composition Scale 2 (macOS, bleak).

A balança anuncia (sem pareamento) service data do serviço 0x181D durante
~15 min após a pesagem. Payload de 13 bytes (protocolo documentado no
openScale, oliexdev/openScale — MiScale2.java):

  d[0]  ctrl0: bit0 = unidades imperiais (lbs)
  d[1]  ctrl1: bit1 = impedância presente, bit5 = estabilizado,
        bit7 = peso retirado
  d[2:4] peso uint16 LE (unidade 5 g -> kg = raw/200; imperial: 0.01 lb)
  d[4:10] timestamp da balança (ano LE, mês, dia, hh, mm)
  d[10:12] impedância uint16 LE (ohm)
  d[12]  resíduo/checksum

Composição (gordura/água/músculo) via fórmulas openScale usando
idade/altura/sexo configuráveis (SCALE_AGE, SCALE_HEIGHT_CM, SCALE_SEX).

Fluxo por pesagem: append a backend/data/scale_log.jsonl + upsert
Supabase (upsert_body_rows partilhado com body_sync.py).

Uso:
  .venv/bin/python scripts/scale_listener.py --once --duration 60   # teste
  .venv/bin/python scripts/scale_listener.py                        # contínuo
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from body_sync import retry, upsert_body_rows  # noqa: E402

import psycopg  # noqa: E402
from bleak import BleakScanner  # noqa: E402

DB_URL = os.getenv("SUPABASE_DB_URL", "")
SCALE_AGE = int(os.getenv("SCALE_AGE", "36"))
SCALE_HEIGHT_CM = int(os.getenv("SCALE_HEIGHT_CM", "180"))
SCALE_SEX = os.getenv("SCALE_SEX", "male")  # male | female
# 1: uma pesagem por dia e só com composição completa substitui um registo
# completo; pesagens sem impedância ficam apenas no scale_log.jsonl
SCALE_KEEP_COMPLETE = os.getenv("SCALE_KEEP_COMPLETE", "1") == "1"

LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "scale_log.jsonl"
SERVICE_181D = "181d"
SERVICE_181B = "181b"  # confirmado com anúncio real (MIBFS)
NAME_HINTS = ("mibfs", "mibcs", "mi body", "mi body composition")
APPLE_COMPANY = 76  # 0x004C — macOS embrulha service data aqui (tipo 0x10)


def extract_scale_data(adv) -> bytes | None:
    """Service data 0x181B/0x181D do anúncio. No macOS pode vir embrulhado
    no manufacturer data Apple: 10 .. 1d 18 <payload 13B>."""
    for uuid, data in (adv.service_data or {}).items():
        u = uuid.lower()
        if u in (SERVICE_181B, SERVICE_181D) or u[4:8] in (SERVICE_181B, SERVICE_181D):
            return bytes(data)
    for company, md in (adv.manufacturer_data or {}).items():
        if int(company) != APPLE_COMPANY:
            continue
        b = bytes(md)
        i = 0
        while i + 4 <= len(b):
            if b[i] != 0x10:
                i += 1
                continue
            if b[i + 2 : i + 4] in (b"\x1d\x18", b"\x1b\x18"):
                # payload do Mi Scale 2 = 13 bytes fixos; se o campo de
                # tamanho (n-2) fizer sentido, respeita-o
                n = b[i + 1]
                plen = n - 2 if 15 <= n <= 20 else 13
                payload = b[i + 4 : i + 4 + plen]
                if len(payload) >= 13:
                    return payload
            i += 1
    return None


# ---------------- descodificação ----------------

def decode_measurement(data: bytes) -> dict | None:
    """Descodifica os 13 bytes (formato confirmado com anúncio real MIBFS):

      d[0]   ctrl0: bit0 = lbs, bit1 = catty (jin)
      d[1]   ctrl1: bit5 = estabilizado; bit7 = anúncio final (peso
             retirado) — é ESTE que queremos guardar
      d[2:4] ano LE | d[4] mês | d[5] dia | d[6] hh | d[7] mm | d[8] ss
      d[9:11] impedância LE (ohm)
      d[11:13] peso LE (kg: raw/200; catty: raw/100*0.5; lbs: raw/100*0.4536)
    """
    if len(data) < 13:
        return None
    d = data
    ctrl0, ctrl1 = d[0], d[1]
    stabilized = bool(ctrl1 & (1 << 5))
    if not stabilized:
        return None  # medição em curso; esperar o anúncio final

    is_lbs = bool(ctrl0 & 0x01)
    is_catty = bool(ctrl0 & 0x02)
    weight_raw = d[11] | (d[12] << 8)
    if is_lbs:
        weight = weight_raw * 0.01 * 0.45359237
    elif is_catty:
        weight = weight_raw * 0.01 * 0.5
    else:
        weight = weight_raw / 200.0
    weight_kg = round(weight, 2)

    scale_time = None
    try:
        year = d[2] | (d[3] << 8)
        if 2000 <= year <= 2100:
            scale_time = f"{year:04d}-{d[4]:02d}-{d[5]:02d} {d[6]:02d}:{d[7]:02d}:{d[8]:02d}"
    except Exception:
        pass

    impedance_raw = d[9] | (d[10] << 8)
    impedance = impedance_raw if 100 <= impedance_raw <= 1000 else None

    return {
        "weight": weight_kg,
        "weight_raw": weight_raw,
        "units": "lbs" if is_lbs else ("catty" if is_catty else "kg"),
        "impedance": impedance,
        "stabilized": stabilized,
        "final": bool(ctrl1 & (1 << 7)),
        "scale_time": scale_time,
        "raw": d.hex(),
    }


def compute_composition(weight: float, impedance) -> dict:
    """Composição corporal — fórmulas oficiais do openScale (MiScaleLib.kt),
    portadas de Kotlin: sex 1=male/0=female, altura cm, idade anos."""
    sex = 1 if SCALE_SEX == "male" else 0
    h, age = SCALE_HEIGHT_CM, SCALE_AGE
    out = {"bmi": round(weight / ((h / 100) ** 2), 1)}
    if not impedance:
        return out
    z = float(impedance)

    lbm_coeff = (h * 9.058 / 100) * (h / 100)
    lbm_coeff += weight * 0.32 + 12.226
    lbm_coeff -= z * 0.0068
    lbm_coeff -= age * 0.0542

    # gordura %
    lbm_sub = 0.8
    if sex == 0 and age <= 49:
        lbm_sub = 9.25
    elif sex == 0 and age > 49:
        lbm_sub = 7.25
    coeff = 1.0
    if sex == 1 and weight < 61.0:
        coeff = 0.98
    elif sex == 0 and weight > 60.0:
        coeff = 0.96
        if h > 160.0:
            coeff *= 1.03
    elif sex == 0 and weight < 50.0:
        coeff = 1.02
        if h > 160.0:
            coeff *= 1.03
    body_fat = (1 - ((lbm_coeff - lbm_sub) * coeff) / weight) * 100
    if body_fat > 63:
        body_fat = 75.0
    out["body_fat"] = round(body_fat, 1)

    # água %
    water = (100 - body_fat) * 0.7
    water *= 1.02 if water < 50 else 0.98
    out["water"] = round(water, 1)

    # músculo: massa muscular esquelética (Janssen et al.), kg
    smm = 0.401 * ((h * h) / z) + 3.825 * sex - 0.071 * age + 5.102
    out["muscle"] = round(smm, 1)

    # massa óssea kg
    base = 0.245691014 if sex == 0 else 0.18016894
    bone = -(base - lbm_coeff * 0.05158)
    bone = bone + 0.1 if bone > 2.2 else bone - 0.1
    out["bone_mass"] = round(bone, 1)

    # gordura visceral
    if sex == 0:
        if weight > (13 - h * 0.5) * -1:
            subsubcalc = (h * 1.45) + (h * 0.1158) * h - 120
            subcalc = weight * 500 / subsubcalc
            vf = (subcalc - 6) + age * 0.07
        else:
            subcalc = 0.691 + h * -0.0024 + h * -0.0024
            vf = ((h * 0.027 - subcalc * weight) * -1) + age * 0.07 - age
    else:
        if h < weight * 1.6:
            subcalc = ((h * 0.4) - (h * (h * 0.0826))) * -1
            vf = (weight * 305) / (subcalc + 48) - 2.9 + age * 0.15
        else:
            subcalc = 0.765 + h * -0.0015
            vf = ((h * 0.143 - weight * subcalc) * -1) + age * 0.15 - 5
    out["visceral_fat"] = round(vf)

    return out


# ---------------- persistência ----------------

def append_log(entry: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def save_to_supabase(entry: dict) -> None:
    if not DB_URL:
        print("  (SUPABASE_DB_URL ausente — só log local)", flush=True)
        return
    day = entry["measured_at"][:10]
    comp = entry.get("composition") or {}
    row = (
        day,
        entry["weight"],
        comp.get("body_fat"),
        comp.get("water"),
        comp.get("muscle"),
        comp.get("bone_mass"),
        comp.get("visceral_fat"),
        comp.get("protein"),
        comp.get("bmi"),
    )
    conn = retry(lambda: psycopg.connect(DB_URL))
    try:
        # uma pesagem por dia: só substitui o registo se a nova trouxer
        # composição completa (impedância) ou se a atual for incompleta
        if SCALE_KEEP_COMPLETE and not comp.get("body_fat"):
            with conn.cursor() as cur:
                cur.execute(
                    "select body_fat from public.body_metrics where date = %s",
                    (day,),
                )
                existing = cur.fetchone()
            if existing and existing[0] is not None:
                print(
                    f"  mantém registo de {day} com composição completa; "
                    "pesagem sem impedância fica só no log",
                    flush=True,
                )
                return
        upsert_body_rows(conn, [row], source="xiaomi")
        print(f"  Supabase OK: {day}", flush=True)
    finally:
        conn.close()


# ---------------- listener ----------------

class ScaleListener:
    def __init__(self, once: bool = False, duration: float = 60.0, dry_run: bool = False, verbose: bool = False):
        self.once = once
        self.duration = duration
        self.dry_run = dry_run
        self.verbose = verbose
        self.seen_minutes: set[str] = set()
        self.last_scale_time: str | None = None
        self.found_any = False

    def _handle(self, device, adv) -> None:
        name = (device.name or "").lower()
        matched = extract_scale_data(adv)
        interesting = matched is not None or any(h in name for h in NAME_HINTS)
        if not interesting and not self.verbose:
            return
        if self.verbose:
            md = {c: bytes(v).hex() for c, v in (adv.manufacturer_data or {}).items()}
            sd = {u: bytes(v).hex() for u, v in (adv.service_data or {}).items()}
            print(
                f"  [adv] {(device.name or '?')[:32]:32} rssi={adv.rssi} md={md} sd={sd}",
                flush=True,
            )
        if matched is None:
            return
        self.found_any = True
        print(f"[{datetime.now():%H:%M:%S}] {device.name or '?'} ({device.address})", flush=True)
        print(f"  raw ({len(matched)}B): {matched.hex()}", flush=True)
        m = decode_measurement(bytes(matched))
        if not m:
            print("  anúncio não-estabilizado/ignorado", flush=True)
            return

        now = datetime.now()
        minute_key = f"{now:%Y-%m-%d %H:%M}"
        if minute_key in self.seen_minutes:
            print("  duplicado no mesmo minuto — ignora", flush=True)
            return
        self.seen_minutes.add(minute_key)
        # broadcasts repetidos da MESMA pesagem (janela ~15 min)
        if m.get("scale_time") and m["scale_time"] == self.last_scale_time:
            print("  mesma pesagem (re-broadcast) — ignora", flush=True)
            return
        if m.get("scale_time"):
            self.last_scale_time = m["scale_time"]

        comp = compute_composition(m["weight"], m["impedance"])
        entry = {
            "measured_at": now.isoformat(timespec="seconds"),
            "device": device.name,
            **m,
            "scale_time": m.get("scale_time"),
            "composition": comp,
            "config": {"age": SCALE_AGE, "height_cm": SCALE_HEIGHT_CM, "sex": SCALE_SEX},
        }
        print(
            f"  PESAGEM: {m['weight']} kg"
            + (f" | {m['impedance']} Ω" if m.get("impedance") else "")
            + (m.get("scale_time") and f" | balança: {m['scale_time']}" or "")
            + f" | comp: {comp}",
            flush=True,
        )
        if self.dry_run:
            print("  DRY-RUN: nada escrito", flush=True)
            return
        append_log(entry)
        try:
            save_to_supabase(entry)
        except Exception as e:
            print(f"  ERRO Supabase ({str(e)[:100]}) — fica no scale_log.jsonl", flush=True)

    async def run(self) -> None:
        mode = "--once" if self.once else "contínuo"
        print(f"Scanner BLE {mode} ({int(self.duration)}s) — procura service data 0x181D", flush=True)
        print(f"config: idade={SCALE_AGE} altura={SCALE_HEIGHT_CM}cm sexo={SCALE_SEX}", flush=True)
        scanner = BleakScanner(detection_callback=self._handle)
        await scanner.start()
        try:
            last_recycle = time.time()
            while True:
                await asyncio.sleep(self.duration if self.once else 5)
                if self.once:
                    break
                # reciclar o scanner: o CoreBluetooth morre em silêncio
                # (ex.: após o Mac adormecer) sem lançar erro
                if time.time() - last_recycle > 600:
                    try:
                        await scanner.stop()
                        await scanner.start()
                        last_recycle = time.time()
                    except Exception as e:
                        print(f"reciclagem do scanner falhou ({e}); reinicio total", flush=True)
                        raise
        finally:
            await scanner.stop()
        if self.once and not self.found_any:
            print("Nenhum anúncio da balança. Pisar a balança ativa os anúncios (~15 min).", flush=True)


async def main_async(args) -> None:
    listener = ScaleListener(once=args.once, duration=args.duration, dry_run=args.dry_run, verbose=args.verbose)
    if args.once:
        await listener.run()
        return
    # loop contínuo: reinicia em caso de erro (Bluetooth oscilar)
    while True:
        try:
            await listener.run()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"erro no scanner ({str(e)[:120]}); reinicio em 15s", flush=True)
            await asyncio.sleep(15)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="scan único e sai")
    ap.add_argument("--duration", type=float, default=60.0, help="segundos do scan (--once)")
    ap.add_argument("--dry-run", action="store_true", help="não escreve (log/Supabase)")
    ap.add_argument("--verbose", action="store_true", help="imprime todos os anúncios BLE (diagnóstico)")
    args = ap.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("terminado", flush=True)


if __name__ == "__main__":
    sys.exit(main())
