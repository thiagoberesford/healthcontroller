"""Sync diário Suunto -> Supabase (activities/daily com source='suunto').

Usa o CLI `suuntool` (backend Sports-Tracker; sessão em ~/.config/suuntool/).
Incremental: só busca desde o último registo suunto no Supabase (ou --since).
Idempotente: upsert on conflict (source, source_key) / (date, source).

Uso:
  .venv/bin/python scripts/suunto_sync.py [--dry-run] [--since 7d]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from datetime import date, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

SUUNTO_EMAIL = os.getenv("SUUNTO_EMAIL", "")
SUUNTO_PASSWORD = os.getenv("SUUNTO_PASSWORD", "")
DB_URL = os.getenv("SUPABASE_DB_URL", "")
CUTOFF = date(2026, 10, 7)  # datas Suunto < cutoff não são esperadas

# Mapear tipos Suunto -> tipos do app (editável quando houver dados reais)
TYPE_MAP = {
    "RUNNING": "running",
    "TREADMILL_RUNNING": "treadmill_running",
    "TRAIL_RUNNING": "trail_running",
    "WALKING": "walking",
    "HIKING": "walking",
    "CYCLING": "indoor_cycling",
    "GYM": "strength_training",
    "GYM_AND_FITNESS": "strength_training",
    "STRENGTH_TRAINING": "strength_training",
}


def suuntool(*args: str) -> str:
    cmd = ["suuntool", *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"suuntool {' '.join(args)} falhou: {r.stderr[:200]}")
    return r.stdout


def ensure_login() -> None:
    who = subprocess.run(["suuntool", "whoami"], capture_output=True, text=True)
    if who.returncode != 0 or '"username"' not in who.stdout:
        if not SUUNTO_EMAIL or not SUUNTO_PASSWORD:
            raise RuntimeError("Sem sessão suuntool e sem SUUNTO_EMAIL/SUUNTO_PASSWORD no .env")
        subprocess.run(
            ["suuntool", "login", "--email", SUUNTO_EMAIL, "--password-stdin"],
            input=SUUNTO_PASSWORD,
            capture_output=True,
            text=True,
            check=True,
        )


def ndjson(out: str) -> list[dict]:
    items = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            items.append(obj)
        except json.JSONDecodeError:
            pass
    return items


def last_synced(conn) -> date:
    with conn.cursor() as cur:
        cur.execute("select max(date) from public.daily where source = 'suunto'")
        d = cur.fetchone()[0]
    if d:
        return d
    with conn.cursor() as cur:
        cur.execute("select max(start)::date from public.activities where source = 'suunto'")
        d = cur.fetchone()[0]
    return d or (date.today() - timedelta(days=3))


def fetch_workouts(since_iso: str) -> list[dict]:
    out = suuntool("workouts", "list", "--since", since_iso, "--stream")
    return ndjson(out)


def fetch_wellness(kind: str, since_iso: str) -> list[dict]:
    try:
        out = suuntool("wellness", kind, "--since", since_iso)
    except RuntimeError as e:
        print(f"  wellness {kind} indisponível ({str(e)[:80]}) — a ignorar")
        return []
    return ndjson(out)


def map_workout(w: dict) -> dict | None:
    key = w.get("key") or w.get("workoutKey")
    start = w.get("startTime") or w.get("localStartTime")
    if not key or not start:
        return None
    raw_type = (w.get("activityName") or w.get("activityType") or "").upper()
    dist = w.get("totalDistance") or w.get("distance")
    dur = w.get("duration") or w.get("elapsedTime") or w.get("movingTime")
    kcal = w.get("kcal") or w.get("energy") or w.get("calories")
    hr = w.get("hrAvg") or w.get("avgHr") or w.get("averageHeartRate")
    return {
        "source": "suunto",
        "source_key": str(key),
        "name": w.get("name") or raw_type.title() or "Treino",
        "type": TYPE_MAP.get(raw_type, "other"),
        "start": str(start)[:19].replace("T", " "),
        "distance_km": round((dist or 0) / 1000, 2) if dist else 0,
        "duration_s": round(dur) if dur else None,
        "kcal": int(kcal) if kcal else None,
        "avg_hr": int(hr) if hr else None,
    }


def map_daily(entries: dict[str, list[dict]]) -> list[dict]:
    """Une wellness activity/sleep/recovery por dia."""
    by_day: dict[str, dict] = {}
    for e in entries.get("activity", []):
        d = (e.get("timestamp") or e.get("date") or "")[:10]
        data = e.get("entryData") or {}
        row = by_day.setdefault(d, {"date": d, "source": "suunto"})
        row["steps"] = data.get("stepCount") or row.get("steps")
        row["active_kcal"] = (
            data.get("activityCalories") or data.get("kcal") or row.get("active_kcal")
        )
        row["total_kcal"] = data.get("totalCalories") or row.get("total_kcal")
        row["floors"] = data.get("ascentMeters") or row.get("floors")
    for e in entries.get("sleep", []):
        d = (e.get("timestamp") or e.get("date") or "")[:10]
        data = e.get("entryData") or {}
        if data.get("isNap"):
            continue
        row = by_day.setdefault(d, {"date": d, "source": "suunto"})
        dur_min = data.get("durationMin") or data.get("sleepMin")
        if dur_min:
            row["sleep_hours"] = round(dur_min / 60, 1)
        hr = data.get("hrAvg")
        if hr and hr < 5:  # Hz -> bpm ( Sports-Tracker devolve Hz às vezes)
            hr = round(hr * 60)
        if hr:
            row["resting_hr"] = round(hr)
    for e in entries.get("recovery", []):
        d = (e.get("timestamp") or e.get("date") or "")[:10]
        data = e.get("entryData") or {}
        row = by_day.setdefault(d, {"date": d, "source": "suunto"})
        row["hrv"] = data.get("hrv") or data.get("hrvMs") or row.get("hrv")
        row["stress_avg"] = data.get("stress") or row.get("stress_avg")
    return [r for r in by_day.values() if r["date"]]


def upsert(conn, workouts: list[dict], daily: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into public.activities
                (source, source_key, name, type, start, distance_km, duration_s, kcal, avg_hr)
            values ('suunto', %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (source, source_key) do update set
                name = excluded.name, type = excluded.type, start = excluded.start,
                distance_km = excluded.distance_km, duration_s = excluded.duration_s,
                kcal = excluded.kcal, avg_hr = excluded.avg_hr
            """,
            [
                (w["source_key"], w["name"], w["type"], w["start"], w["distance_km"],
                 w["duration_s"], w["kcal"], w["avg_hr"])
                for w in workouts
            ],
        )
        cur.executemany(
            """
            insert into public.daily
                (date, source, steps, active_kcal, total_kcal, resting_hr, hrv,
                 sleep_hours, stress_avg, floors)
            values (%s, 'suunto', %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (date, source) do update set
                steps = excluded.steps, active_kcal = excluded.active_kcal,
                total_kcal = excluded.total_kcal, resting_hr = excluded.resting_hr,
                hrv = excluded.hrv, sleep_hours = excluded.sleep_hours,
                stress_avg = excluded.stress_avg, floors = excluded.floors
            """,
            [
                (d["date"], d.get("steps"), d.get("active_kcal"), d.get("total_kcal"),
                 d.get("resting_hr"), d.get("hrv"), d.get("sleep_hours"),
                 d.get("stress_avg"), d.get("floors"))
                for d in daily
            ],
        )
    conn.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="não escreve no Supabase")
    ap.add_argument("--since", default=None, help="ex.: 7d ou 2026-10-07 (sobrepõe incremental)")
    args = ap.parse_args()

    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)

    ensure_login()
    print("sessão suuntool OK")

    with psycopg.connect(DB_URL) as conn:
        since = args.since
        if not since:
            last = last_synced(conn)
            if last < CUTOFF:
                last = min(CUTOFF, date.today() - timedelta(days=1))
            since = last.isoformat()
        print(f"sync desde: {since}")

        workouts = [m for w in fetch_workouts(since) if (m := map_workout(w))]
        entries = {
            kind: fetch_wellness(kind, since)
            for kind in ("activity", "sleep", "recovery")
        }
        daily = map_daily(entries)
        bad = [w for w in workouts if w["start"][:10] < CUTOFF.isoformat()]
        if bad:
            print(f"AVISO: {len(bad)} treinos com data < {CUTOFF} — ignorados (investigar)")
            workouts = [w for w in workouts if w["start"][:10] >= CUTOFF.isoformat()]

        print(f"workouts: {len(workouts)} | dias: {len(daily)}")
        for w in workouts[:5]:
            print("  ", w["start"], w["type"], w["distance_km"], "km")
        if args.dry_run:
            print("DRY-RUN: nada escrito")
            return
        upsert(conn, workouts, daily)
        print("SYNC OK")


if __name__ == "__main__":
    sys.exit(main())
