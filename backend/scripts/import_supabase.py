"""Importa o snapshot Garmin para o Postgres do Supabase (upsert idempotente).

Requer SUPABASE_DB_URL em backend/.env (connection string do projeto).
Uso:  .venv/bin/python scripts/import_supabase.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from psycopg.types.json import Jsonb

from app.config import DATA_DIR
from app.services.garmin_service import list_activities, list_daily

BATCH = 500
MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"


def migrate(conn) -> None:
    for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        print(f"migration: {sql_file.name}")
        with conn.cursor() as cur:
            cur.execute(sql_file.read_text())
        conn.commit()


def import_activities(conn) -> int:
    acts = list_activities()
    with conn.cursor() as cur:
        for i in range(0, len(acts), BATCH):
            rows = [
                (
                    a["id"],
                    a.get("name"),
                    a.get("type"),
                    a["start"].replace("T", " "),
                    a.get("distance_km") or 0,
                    a.get("duration_s"),
                    int(a["kcal"]) if a.get("kcal") else None,
                    int(a["avg_hr"]) if a.get("avg_hr") else None,
                )
                for a in acts[i : i + BATCH]
                if a.get("id")
            ]
            cur.executemany(
                """
                insert into public.garmin_activities
                    (id, name, type, start, distance_km, duration_s, kcal, avg_hr)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                    name = excluded.name, type = excluded.type, start = excluded.start,
                    distance_km = excluded.distance_km, duration_s = excluded.duration_s,
                    kcal = excluded.kcal, avg_hr = excluded.avg_hr
                """,
                rows,
            )
    conn.commit()
    return len(acts)


def import_daily(conn) -> int:
    daily = list_daily()
    with conn.cursor() as cur:
        for i in range(0, len(daily), BATCH):
            rows = [
                (
                    d["date"],
                    d.get("steps"),
                    d.get("active_kcal"),
                    d.get("total_kcal"),
                    d.get("resting_hr"),
                    d.get("hrv"),
                    d.get("sleep_hours"),
                    d.get("stress_avg"),
                    d.get("floors"),
                    d.get("intense_min"),
                )
                for d in daily[i : i + BATCH]
            ]
            cur.executemany(
                """
                insert into public.garmin_daily
                    (date, steps, active_kcal, total_kcal, resting_hr, hrv,
                     sleep_hours, stress_avg, floors, intense_min)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (date) do update set
                    steps = excluded.steps, active_kcal = excluded.active_kcal,
                    total_kcal = excluded.total_kcal, resting_hr = excluded.resting_hr,
                    hrv = excluded.hrv, sleep_hours = excluded.sleep_hours,
                    stress_avg = excluded.stress_avg, floors = excluded.floors,
                    intense_min = excluded.intense_min
                """,
                rows,
            )
    conn.commit()
    return len(daily)


def main() -> None:
    import os

    from dotenv import load_dotenv

    load_dotenv()
    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        print("ERRO: SUPABASE_DB_URL não definido em backend/.env")
        sys.exit(1)
    if not (DATA_DIR / "garmin_export").exists():
        print("ERRO: sem snapshot em backend/data/garmin_export — corra garmin_snapshot.py")
        sys.exit(1)

    print(f"Atividades no snapshot: {len(list_activities())}")
    print(f"Dias no snapshot: {len(list_daily())}")

    with psycopg.connect(db_url) as conn:
        migrate(conn)
        n1 = import_activities(conn)
        print(f"garmin_activities: {n1} linhas (upsert)")
        n2 = import_daily(conn)
        print(f"garmin_daily: {n2} linhas (upsert)")
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.garmin_activities")
            print("total na tabela:", cur.fetchone()[0])
    print("IMPORT OK")


if __name__ == "__main__":
    sys.exit(main())
