"""Sincroniza export do SmartScaleConnect (balança Xiaomi) -> body_metrics.

Lê CSV ou JSON exportado do app Android SmartScaleConnect
(github.com/AlexxIT/SmartScaleConnect) do caminho configurável:
  --input PATH  ou  BODY_EXPORT_PATH no backend/.env

- Normaliza datas (ISO / epoch s-ms / dd/mm/yyyy) -> date local
- Parse tolerante dos campos de composição (vários nomes possíveis)
- Uma linha por dia: mantém a última medição de cada dia
- Upsert idempotente (on conflict date); incremental por omissão:
  ignora dates <= último registo source='xiaomi' (use --force para reprocessar)
Uso:
  .venv/bin/python scripts/body_sync.py --input export.csv [--dry-run] [--force]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime, date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL", "")

# coluna -> chaves candidatas no export (case-insensitive, sem espaços/_)
FIELD_ALIASES = {
    "weight": ["weight", "peso", "weightkg", "kg"],
    "body_fat": ["bodyfat", "fat", "gordura", "bodyfatpercent", "fatpercent", "gorduracorporal"],
    "water": ["water", "agua", "humidity", "waterpercent", "percentagemagua"],
    "muscle": ["muscle", "musclemass", "musculo", "musclepercent", "massamuscular"],
    "bone_mass": ["bonemass", "bone", "osso", "massaosea", "boneweight"],
    "visceral_fat": ["visceral", "visceral fat", "visceralfat", "gorduravisceral"],
    "protein": ["protein", "proteina"],
    "bmi": ["bmi", "imc"],
}
DATE_ALIASES = ["datetime", "date", "timestamp", "time", "data", "createdat", "measuredat"]
TS_KEYS = ["datetime", "timestamp", "createdat", "measuredat", "time", "data"]  # com hora


def norm_key(k: str) -> str:
    return re.sub(r"[\s_\-]+", "", str(k or "")).strip().lower()


def parse_number(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    s = re.sub(r"[^\d.\-]", "", s)
    if not s or s in (".", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_dt(v):
    """-> datetime local ou None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        f = float(v)
        if f > 1e12:
            return datetime.fromtimestamp(f / 1000)
        if f > 1e9:
            return datetime.fromtimestamp(f)
        return None
    s = str(v).strip()
    for fmt in (
        "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
        "%Y-%m-%d", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
        "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y",
    ):
        try:
            return datetime.strptime(s.replace("Z", "").split(".")[0], fmt)
        except ValueError:
            continue
    return None


def load_records(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json" or text.lstrip().startswith(("[", "{")):
        obj = json.loads(text)
        if isinstance(obj, dict):
            for k in ("measurements", "data", "items", "rows", "weights"):
                if isinstance(obj.get(k), list):
                    obj = obj[k]
                    break
            else:
                obj = [obj]
        return [r for r in obj if isinstance(r, dict)]
    # CSV: detetar delimiter
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return list(csv.DictReader(text.splitlines(), dialect=dialect))


def map_record(rec: dict) -> dict | None:
    keys = {norm_key(k): k for k in rec.keys()}
    # datetime (com hora) tem prioridade sobre date
    ts = None
    for alias in TS_KEYS:
        real = keys.get(norm_key(alias)) or keys.get(alias)
        if real is not None:
            ts = parse_dt(rec[real])
            if ts:
                break
    if ts is None:
        for alias in DATE_ALIASES:
            real = keys.get(norm_key(alias))
            if real is not None:
                ts = parse_dt(rec[real])
                if ts:
                    break
    if ts is None:
        return None

    out = {"dt": ts}
    for col, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            real = keys.get(norm_key(alias)) or keys.get(alias)
            if real is not None:
                val = parse_number(rec[real])
                if val is not None:
                    out[col] = val
                    break
    if "weight" not in out:
        return None
    return out


def normalize(records: list[dict]) -> dict[str, dict]:
    """Uma medição por dia (a última)."""
    by_day: dict[str, dict] = {}
    for rec in records:
        m = map_record(rec)
        if not m:
            continue
        d = m["dt"].date().isoformat()
        prev = by_day.get(d)
        if not prev or m["dt"] > prev["dt"]:
            by_day[d] = m
    return by_day


def retry(fn, tries: int = 3):
    last = None
    for attempt in range(tries):
        try:
            return fn()
        except psycopg.OperationalError as e:
            wait = 10 * (attempt + 1)
            print(f"  erro de ligação ({str(e)[:60]}); retry em {wait}s", flush=True)
            last = e
            time.sleep(wait)
    raise last


UPSERT_SQL = """
    insert into public.body_metrics
        (date, weight, body_fat, water, muscle, bone_mass,
         visceral_fat, protein, bmi, source)
    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    on conflict (date) do update set
        weight = excluded.weight, body_fat = excluded.body_fat,
        water = excluded.water, muscle = excluded.muscle,
        bone_mass = excluded.bone_mass, visceral_fat = excluded.visceral_fat,
        protein = excluded.protein, bmi = excluded.bmi, source = excluded.source
    """


def upsert_body_rows(conn, rows: list[tuple], source: str = "xiaomi") -> None:
    """rows: (date_iso, weight, body_fat, water, muscle, bone_mass,
    visceral_fat, protein, bmi). Partilhado com o scale_listener."""
    payload = [tuple(r) + (source,) for r in rows]
    with conn.cursor() as cur:
        cur.executemany(UPSERT_SQL, payload)
    conn.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=os.getenv("BODY_EXPORT_PATH", ""), help="CSV/JSON do SmartScaleConnect")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="reprocessa também datas <= último importado")
    args = ap.parse_args()

    if not args.input:
        print("ERRO: --input PATH ou BODY_EXPORT_PATH em falta")
        sys.exit(1)
    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)
    path = Path(args.input).expanduser()
    if not path.exists():
        print(f"ERRO: ficheiro não encontrado: {path}")
        sys.exit(1)

    records = load_records(path)
    if not records:
        print("ERRO: export sem registos reconhecidos")
        sys.exit(1)
    by_day = normalize(records)
    print(f"registos lidos: {len(records)} | dias: {len(by_day)}")

    conn = retry(lambda: psycopg.connect(DB_URL))
    with conn:
        with conn.cursor() as cur:
            cur.execute("select coalesce(max(date), '1900-01-01') from public.body_metrics where source = 'xiaomi'")
            last = cur.fetchone()[0]
        if not args.force and str(last) != "1900-01-01":
            todo = {d: m for d, m in by_day.items() if d > str(last)}
            print(f"incremental: último xiaomi = {last}; ignora <= {last} (use --force para reprocessar)")
        else:
            todo = by_day
        print(f"a importar: {len(todo)} dias")

        for d, m in sorted(todo.items()):
            print(
                f"  {d}: {m['weight']} kg"
                + (f" | {m.get('body_fat')}% gordura" if m.get("body_fat") else "")
                + (f" | {m.get('muscle')} kg músculo" if m.get("muscle") else "")
                + (f" | {m.get('water')}% água" if m.get("water") else "")
            )
        if args.dry_run:
            print("DRY-RUN: nada escrito")
            return
        rows = [
            (
                d,
                m["weight"],
                m.get("body_fat"),
                m.get("water"),
                m.get("muscle"),
                m.get("bone_mass"),
                m.get("visceral_fat"),
                m.get("protein"),
                m.get("bmi"),
            )
            for d, m in sorted(todo.items())
        ]
        if not rows:
            print("nada novo para importar")
            return
        upsert_body_rows(conn, rows, source="xiaomi")
        print(f"BODY SYNC OK ({len(rows)} dias)")


if __name__ == "__main__":
    sys.exit(main())
