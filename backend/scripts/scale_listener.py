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

LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "scale_log.jsonl"
SERVICE_181D = "181d"
NAME_HINTS = ("mibcs", "mi body", "mi body composition")


# ---------------- descodificação ----------------

def decode_measurement(data: bytes) -> dict | None:
    """Descodifica os 13 bytes do service data 0x181D. None se não é medição."""
    if len(data) < 13:
        return None
    d = data
    ctrl0, ctrl1 = d[0], d[1]
    is_lbs = bool(ctrl0 & 0x01)
    stabilized = bool(ctrl1 & (1 << 5))
    weight_removed = bool(ctrl1 & (1 << 7))
    has_impedance = bool(ctrl1 & (1 << 1))
    if not stabilized or weight_removed:
        return None

    raw_weight = d[2] | (d[3] << 8)
    if is_lbs:
        weight_kg = round(raw_weight * 0.01 * 0.45359237, 1)  # 0.01 lb
    else:
        weight_kg = round(raw_weight / 200.0, 1)  # unidade 5 g

    # timestamp da balança (se presente, bit4 do ctrl0)
    scale_time = None
    if ctrl0 & 0x10:
        try:
            year = d[4] | (d[5] << 8)
            if 2000 <= year <= 2100:
                scale_time = f"{year:04d}-{d[6]:02d}-{d[7]:02d} {d[8]:02d}:{d[9]:02d}"
        except Exception:
            pass

    impedance = None
    if has_impedance and len(d) >= 12:
        impedance = d[10] | (d[11] << 8)

    return {
        "weight": weight_kg,
        "impedance": impedance,
        "is_lbs": is_lbs,
        "stabilized": stabilized,
        "scale_time": scale_time,
        "raw": d.hex(),
    }


def compute_composition(weight: float, impedance: float | None) -> dict:
    """openScale MiScale2: LBM -> gordura; água por impedância; IMC.
    Constantes centralizadas — validar contra a app Mi Fitness na primeira
    pesagem real (raw fica sempre no scale_log.jsonl para recalcular)."""
    h = SCALE_HEIGHT_CM / 100.0
    out = {"bmi": round(weight / (h * h), 1)}
    if not impedance:
        return out
    z = float(impedance)
    # openScale: lean body mass = (0.0062*h_cm² + 0.0041*Z² + 3414.73) / peso_kg
    lbm = (0.0062 * SCALE_HEIGHT_CM**2 + 0.0041 * z * z + 3414.73) / weight
    fat_pct = (1.0 - lbm / weight) * 100.0
    if 2.0 <= fat_pct <= 70.0:
        out["body_fat"] = round(fat_pct, 1)
        out["muscle"] = round(lbm - 2.5, 1)  # LBM menos massa óssea estimada
    out["water"] = round(min(max(100.0 - z * 0.0774, 30.0), 75.0), 1)
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
        upsert_body_rows(conn, [row], source="xiaomi")
        print(f"  Supabase OK: {day}", flush=True)
    finally:
        conn.close()


# ---------------- listener ----------------

class ScaleListener:
    def __init__(self, once: bool = False, duration: float = 60.0, dry_run: bool = False):
        self.once = once
        self.duration = duration
        self.dry_run = dry_run
        self.seen_minutes: set[str] = set()
        self.found_any = False

    def _handle(self, device, adv) -> None:
        name = (device.name or "").lower()
        service_data = adv.service_data or {}
        matched = None
        for uuid, data in service_data.items():
            if uuid[-8:-4].lower() == SERVICE_181D:
                matched = data
                break
        if matched is None and not any(h in name for h in NAME_HINTS):
            return
        self.found_any = True
        print(f"[{datetime.now():%H:%M:%S}] {device.name or '?'} ({device.address})", flush=True)
        if matched is None:
            print(f"  sem service data 0x181D (adv: rssi={adv.rssi})", flush=True)
            return
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
            while True:
                await asyncio.sleep(self.duration if self.once else 5)
                if self.once:
                    break
        finally:
            await scanner.stop()
        if self.once and not self.found_any:
            print("Nenhum anúncio da balança. Pisar a balança ativa os anúncios (~15 min).", flush=True)


async def main_async(args) -> None:
    listener = ScaleListener(once=args.once, duration=args.duration, dry_run=args.dry_run)
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
    args = ap.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("terminado", flush=True)


if __name__ == "__main__":
    sys.exit(main())
