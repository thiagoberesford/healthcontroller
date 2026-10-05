"""Detalhes por-atividade Suunto -> public.activity_details (jsonb).

Baixa o SML de cada treino suunto sem detalhes e grava no mesmo formato
que o garmin_details.py produzia (polyline/hr/splits/gear), para o
ActivityDetail.jsx funcionar sem alterações:

  polyline: [[lat, lon], ...]  (graus decimais, <=400 pts)
  hr:       [[t_s, bpm], ...]   (t relativo ao início; SML vem em Hz)
  splits:   per-km laps (distance m, duration s, avg/max_hr, elev_gain, cadence spm)
  gear:     [] (Suunto não exporta equipamento por treino)

Amostras SML (Data.Samples):
  HR em Hz (x60 -> bpm); Latitude/Longitude em RADIANOS (x180/pi);
  Cadence em Hz (x120 -> spm); Distance em metros; Altitude em metros.

Uso:
  .venv/bin/python scripts/suunto_details.py [--dry-run] [--key <workoutKey>]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL", "")
SUUNTOOL_BIN = shutil.which("suuntool") or "/opt/homebrew/bin/suuntool"


def _t(iso: str) -> float:
    """ISO8601 -> epoch s."""
    return datetime.fromisoformat(iso).timestamp()


def fetch_sml(key: str) -> dict:
    """Baixa o SML de um workout para ficheiro temporário e faz parse."""
    with tempfile.NamedTemporaryFile(suffix=".sml.json", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run(
            [SUUNTOOL_BIN, "workouts", "sml", key, "-o", tmp],
            capture_output=True, text=True, timeout=180, check=True,
        )
        return json.loads(Path(tmp).read_text())
    finally:
        os.unlink(tmp)


def parse_sml(doc: dict) -> dict:
    samples = doc.get("Data", {}).get("Samples") or []
    t0 = None
    hr: list[list[int]] = []          # [t_s, bpm]
    poly: list[list[float]] = []      # [lat, lon] graus
    dist: list[tuple[float, float, float, float]] = []  # (t, m, alt_m, cad_hz)

    for s in samples:
        iso = s.get("TimeISO8601")
        if not iso:
            continue
        t = _t(iso)
        if t0 is None:
            t0 = t
        rel = t - t0
        a = (s.get("Attributes") or {}).get("suunto/sml", {}).get("Sample") or {}
        if a.get("HR"):
            hr.append([round(rel), round(a["HR"] * 60)])
        lat, lon = a.get("Latitude"), a.get("Longitude")
        if lat is not None and lon is not None:
            poly.append([round(math.degrees(lat), 5), round(math.degrees(lon), 5)])
        if a.get("Distance") is not None:
            dist.append((rel, a["Distance"], a.get("Altitude") or 0.0, a.get("Cadence")))

    # polyline <=400 pts
    if len(poly) > 400:
        step = math.ceil(len(poly) / 400)
        poly = poly[::step]

    # splits por km a partir da série de distância
    splits = []
    if len(dist) > 2:
        total_m = dist[-1][1]
        lap_start_t, lap_start_d = 0.0, 0.0
        prev_alt = dist[0][2]
        lap_alt_gain = 0.0
        lap_cad: list[float] = []
        km = 1
        for t, d, alt, cad in dist[1:]:
            da = alt - prev_alt
            if da > 0:
                lap_alt_gain += da
            prev_alt = alt
            if cad:
                lap_cad.append(cad)
            boundary = km * 1000
            if d >= boundary:
                frac = (boundary - lap_start_d) / max(d - lap_start_d, 1e-6)
                t_cross = lap_start_t + frac * (t - lap_start_t)
                splits.append(_lap(1000, hr, lap_start_t, t_cross, lap_alt_gain, lap_cad))
                lap_start_t, lap_start_d = t_cross, boundary
                lap_alt_gain = 0.0
                lap_cad = []
                km += 1
        if lap_start_d < total_m:  # último km parcial
            partial = round(total_m - lap_start_d)
            splits.append(_lap(partial, hr, lap_start_t, dist[-1][0], lap_alt_gain, lap_cad))

    return {"polyline": poly, "hr": hr, "splits": splits, "gear": []}


def _lap(lap_m: int, hr, t0, t1, alt_gain, cad_hz):
    window = [bpm for t, bpm in hr if t0 <= t <= t1]
    return {
        "distance": lap_m,
        "duration": round(t1 - t0, 1),
        "avg_hr": round(sum(window) / len(window)) if window else None,
        "max_hr": max(window) if window else None,
        "elev_gain": round(alt_gain) if alt_gain else None,
        "cadence": round(sum(cad_hz) / len(cad_hz) * 120) if cad_hz else None,
    }


def missing_keys(conn) -> list[tuple[str, str]]:
    """(source_key, type) dos treinos suunto sem detalhe."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.source_key, a.type
            from public.activities a
            left join public.activity_details d
              on d.source = a.source and d.source_key = a.source_key
            where a.source = 'suunto' and d.source_key is null
            order by a.start
            """
        )
        return cur.fetchall()


def sync_details(conn, keys: list[str], dry_run: bool = False) -> int:
    done = 0
    for key in keys:
        try:
            data = parse_sml(fetch_sml(key))
            total = sum(s["duration"] for s in data["splits"])
            print(f"  {key}: {len(data['polyline'])} pts GPS, "
                  f"{len(data['hr'])} HR, {len(data['splits'])} laps"
                  + (f" ({total:.0f}s)" if total else ""))
            if not dry_run:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        insert into public.activity_details (source, source_key, data)
                        values ('suunto', %s, %s::jsonb)
                        on conflict (source, source_key) do update set data = excluded.data
                        """,
                        (key, json.dumps(data)),
                    )
                conn.commit()
            done += 1
        except Exception as ex:
            print(f"  ERRO {key}: {str(ex)[:120]}")
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--key", default=None, help="forçar um workoutKey específico")
    args = ap.parse_args()

    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)

    with psycopg.connect(DB_URL) as conn:
        if args.key:
            keys = [args.key]
        else:
            keys = [k for k, _ in missing_keys(conn)]
        print(f"detalhes em falta: {len(keys)}")
        n = sync_details(conn, keys, dry_run=args.dry_run)
        print(f"detalhes ok: {n}")


if __name__ == "__main__":
    sys.exit(main())
