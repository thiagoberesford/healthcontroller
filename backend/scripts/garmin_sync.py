"""Sync incremental recente do Garmin -> Supabase (tabelas unificadas).

Para manter o site "ao vivo" enquanto o Garmin é a fonte (até 07/10/2026):
- últimos N dias: stats diários, sono, HRV, VO2max -> daily (source='garmin')
- atividades dos últimos N dias -> activities (source='garmin')
Idempotente (upsert). Após o freeze de 07/10 este script deixa de ser
agendado (regra: não escrever em linhas garmin após congelamento).

Uso: .venv/bin/python scripts/garmin_sync.py [--days 7]
LaunchAgent: com.healthcontroller.garmin (StartInterval 3600)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

import os

from app.services.garmin_service import _login

DB_URL = os.getenv("SUPABASE_DB_URL", "")


def fetch_day(client, d: date) -> dict | None:
    """Um dia: stats + sono + hrv + vo2max."""
    iso = d.isoformat()
    row = {"date": iso, "source": "garmin"}
    ok = False
    try:
        stats = client.get_stats(iso)
        if stats:
            row["steps"] = stats.get("totalSteps")
            row["active_kcal"] = stats.get("activeKilocalories")
            row["total_kcal"] = stats.get("totalKilocalories")
            row["resting_hr"] = stats.get("restingHeartRate")
            row["stress_avg"] = stats.get("averageStressLevel")
            row["floors"] = stats.get("floorsAscended")
            intense = (stats.get("moderateIntensityMinutes") or 0) + (
                stats.get("vigorousIntensityMinutes") or 0
            )
            row["intense_min"] = intense or None
            ok = True
    except Exception:
        pass
    try:
        sleep = client.get_sleep_data(iso)
        secs = ((sleep or {}).get("dailySleepDTO") or {}).get("sleepTimeSeconds")
        if secs:
            row["sleep_hours"] = round(secs / 3600, 1)
            ok = True
    except Exception:
        pass
    try:
        hrv = client.get_hrv_data(iso)
        summary = ((hrv or {}).get("hrvSummary") or {})
        if summary.get("lastNightAvg"):
            row["hrv"] = summary["lastNightAvg"]
            ok = True
    except Exception:
        pass
    try:
        mm = client.get_max_metrics(iso)
        for m in mm or []:
            g = (m or {}).get("generic") or {}
            if g.get("vo2MaxValue"):
                row["vo2max"] = int(g["vo2MaxValue"])
                break
    except Exception:
        pass
    return row if ok else None


def fetch_activities(client, since: str) -> list[dict]:
    acts = client.get_activities_by_date(since, date.today().isoformat())
    out = []
    for a in acts:
        if not a.get("activityId"):
            continue
        dist = a.get("distance") or 0
        kcal = a.get("calories")
        hr = a.get("averageHR")
        out.append(
            (
                str(a["activityId"]),
                a.get("activityName"),
                (a.get("activityType") or {}).get("typeKey", "other"),
                (a.get("startTimeLocal") or "")[:19],
                round(dist / 1000, 2),
                a.get("duration"),
                int(kcal) if kcal else None,
                int(hr) if hr else None,
            )
        )
    return out


DAILY_COLS = (
    "steps", "active_kcal", "total_kcal", "resting_hr", "hrv", "sleep_hours",
    "stress_avg", "floors", "intense_min", "vo2max",
)


def upsert_daily(conn, rows: list[dict]) -> None:
    rows = [{**{c: None for c in DAILY_COLS}, **r} for r in rows]
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into public.daily
                (date, source, steps, active_kcal, total_kcal, resting_hr, hrv,
                 sleep_hours, stress_avg, floors, intense_min, vo2max)
            values (%(date)s, 'garmin', %(steps)s, %(active_kcal)s, %(total_kcal)s,
                    %(resting_hr)s, %(hrv)s, %(sleep_hours)s, %(stress_avg)s,
                    %(floors)s, %(intense_min)s, %(vo2max)s)
            on conflict (date, source) do update set
                steps = excluded.steps, active_kcal = excluded.active_kcal,
                total_kcal = excluded.total_kcal, resting_hr = excluded.resting_hr,
                hrv = excluded.hrv, sleep_hours = excluded.sleep_hours,
                stress_avg = excluded.stress_avg, floors = excluded.floors,
                intense_min = excluded.intense_min, vo2max = excluded.vo2max
            """,
            rows,
        )
    conn.commit()


def upsert_activities(conn, rows: list[tuple]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into public.activities
                (source, source_key, name, type, start, distance_km, duration_s, kcal, avg_hr)
            values ('garmin', %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (source, source_key) do update set
                name = excluded.name, type = excluded.type, start = excluded.start,
                distance_km = excluded.distance_km, duration_s = excluded.duration_s,
                kcal = excluded.kcal, avg_hr = excluded.avg_hr
            """,
            rows,
        )
    conn.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()

    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta")
        sys.exit(1)

    since = date.today() - timedelta(days=args.days - 1)
    print(f"garmin_sync: últimos {args.days} dias (desde {since})", flush=True)

    client = _login()
    print("login ok", flush=True)

    days = []
    d = date.today()
    while d >= since:
        row = fetch_day(client, d)
        if row:
            days.append(row)
        time.sleep(0.3)
        d -= timedelta(days=1)
    acts = fetch_activities(client, since.isoformat())

    conn = psycopg.connect(DB_URL)
    try:
        upsert_daily(conn, days)
        upsert_activities(conn, acts)
    finally:
        conn.close()
    print(f"GARMIN SYNC OK: {len(days)} dias, {len(acts)} atividades", flush=True)


if __name__ == "__main__":
    sys.exit(main())
