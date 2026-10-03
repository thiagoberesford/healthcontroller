"""Busca detalhes por-atividade + VO2max + PRs do Garmin -> garmin_export/.

- details/<id>.json  (corridas): polyline (<=400 pts), série HR, série velocidade,
  splits (laps), gear (ténis)
- vo2max.json       : últimos N dias (get_max_metrics)
- personal_records.json : PRs oficiais (typeId 1,2,3,4,5,6)

Resumível; --max-seconds para correr em blocos.
Uso: .venv/bin/python scripts/garmin_details.py [--max-seconds 240]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.garmin_service import _login, EXPORT_ACTIVITIES_PATH

EXPORT_DIR = EXPORT_ACTIVITIES_PATH.parent
DETAILS_DIR = EXPORT_DIR / "details"
CALL_DELAY = 0.08
RUN_TYPES = {"running", "treadmill_running", "trail_running"}
PR_TYPE_LABELS = {1: "1 km", 2: "1 milha", 3: "5 km", 4: "10 km", 5: "meia maratona", 6: "maratona"}

_t0 = 0.0
_max_seconds = 240.0
_paused = False


def budget_left() -> bool:
    return (time.time() - _t0) < _max_seconds


def save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def retry(fn, tries: int = 3):
    for attempt in range(tries):
        try:
            return fn()
        except Exception as e:
            if "429" in str(e):
                wait = 60 * (attempt + 1)
                print(f"  429, esperando {wait}s...", flush=True)
                time.sleep(wait)
            else:
                raise
    raise RuntimeError("retry esgotado")


def phase_prs(client) -> None:
    out = EXPORT_DIR / "personal_records.json"
    if out.exists():
        print("[1/3] PRs: já existe", flush=True)
        return
    prs = retry(client.get_personal_record)
    rows = [
        {
            "type_id": p.get("typeId"),
            "label": PR_TYPE_LABELS.get(p.get("typeId")),
            "value_s": round(p.get("value") or 0, 1),
            "activity_id": p.get("activityId"),
            "activity_name": p.get("activityName"),
            "date": (p.get("actStartDateTimeInGMTFormatted") or "")[:10],
        }
        for p in prs
        if p.get("typeId") in PR_TYPE_LABELS and p.get("value")
    ]
    save(out, rows)
    print(f"[1/3] PRs ok ({len(rows)})", flush=True)


def phase_vo2max(client, days: int = 180) -> None:
    out = EXPORT_DIR / "vo2max.json"
    if out.exists():
        print("[2/3] VO2max: já existe", flush=True)
        return
    rows = []
    d = date.today()
    while len(rows) < days and d >= date(2019, 6, 26):
        try:
            mm = retry(lambda dd=d.isoformat(): client.get_max_metrics(dd))
            for m in mm or []:
                g = (m or {}).get("generic") or {}
                if g.get("vo2MaxValue"):
                    rows.append({"date": g.get("calendarDate") or dd, "vo2max": g.get("vo2MaxValue")})
                    break
        except Exception as ex:
            print(f"  vo2max {d} erro: {str(ex)[:80]}", flush=True)
        time.sleep(CALL_DELAY)
        d -= timedelta(days=1)
        if len(rows) % 30 == 0 and rows:
            print(f"  vo2max: {len(rows)} dias", flush=True)
    rows.sort(key=lambda r: r["date"])
    save(out, rows)
    print(f"[2/3] VO2max ok ({len(rows)} dias)", flush=True)


def phase_details(client) -> None:
    acts = json.loads(EXPORT_ACTIVITIES_PATH.read_text())
    runs = [a for a in acts if a.get("activityType", {}).get("typeKey") in RUN_TYPES]
    runs.sort(key=lambda a: a.get("startTimeLocal") or "", reverse=True)
    print(f"[3/3] detalhes para {len(runs)} corridas", flush=True)

    done = failed = 0
    for i, a in enumerate(runs, 1):
        aid = str(a.get("activityId"))
        if not aid or (DETAILS_DIR / f"{aid}.json").exists():
            continue
        if not budget_left():
            global _paused
            _paused = True
            print(f"  PAUSA em {i}/{len(runs)} — rerun para continuar", flush=True)
            return
        try:
            d = retry(lambda a_=aid: client.get_activity_details(a_))
            descs = [m.get("key") for m in d.get("metricDescriptors", [])]
            idx = {k: i for i, k in enumerate(descs)}
            i_hr, i_t, i_sp, i_el = (
                idx.get("directHeartRate", -1),
                idx.get("directTimestamp", -1),
                idx.get("directSpeed", -1),
                idx.get("directElevation", -1),
            )
            pts = d.get("activityDetailMetrics") or []
            step = max(1, len(pts) // 400)
            hr, speed, elev = [], [], []
            for p in pts[::step]:
                m = p.get("metrics") or []
                t = m[i_t] / 1000 if i_t >= 0 and len(m) > i_t and m[i_t] else None
                if t is None:
                    continue
                if i_hr >= 0 and m[i_hr]:
                    hr.append([round(t), m[i_hr]])
                if i_sp >= 0 and m[i_sp]:
                    speed.append([round(t), m[i_sp]])
                if i_el >= 0 and m[i_el]:
                    elev.append([round(t), m[i_el]])
            poly = (d.get("geoPolylineDTO") or {}).get("polyline") or []
            polyline = (
                [[round(p["lat"], 5), round(p["lon"], 5)] for p in poly[:: max(1, len(poly) // 400)] if p.get("lat")]
            )

            splits = retry(lambda a_=aid: client.get_activity_splits(a_))
            laps = [
                {
                    "distance": l.get("distance"),
                    "duration": l.get("duration"),
                    "moving": l.get("movingDuration"),
                    "avg_hr": l.get("averageHR"),
                    "max_hr": l.get("maxHR"),
                    "kcal": l.get("calories"),
                    "elev_gain": l.get("elevationGain"),
                    "cadence": l.get("averageRunCadence"),
                }
                for l in splits.get("lapDTOs") or []
                if l.get("distance")
            ]

            gear = []
            try:
                gear = [
                    {
                        "name": g.get("customMakeModel") or f"{g.get('gearMakeName')} {g.get('gearModelName')}",
                        "type": g.get("gearTypeName"),
                        "status": g.get("gearStatusName"),
                    }
                    for g in client.get_activity_gear(aid) or []
                ]
            except Exception:
                pass

            save(DETAILS_DIR / f"{aid}.json", {
                "polyline": polyline,
                "hr": hr,
                "speed": speed,
                "elevation": elev,
                "splits": laps,
                "gear": gear,
            })
            done += 1
        except Exception as ex:
            failed += 1
            print(f"  ERRO {aid}: {str(ex)[:100]}", flush=True)
        time.sleep(CALL_DELAY)
        if done and done % 25 == 0:
            print(f"  progresso: {done} detalhes ({failed} erros)", flush=True)
    print(f"[3/3] detalhes ok (baixados {done}, erros {failed})", flush=True)


def main() -> None:
    global _t0, _max_seconds
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=float, default=240.0)
    args = ap.parse_args()
    _max_seconds = args.max_seconds
    _t0 = time.time()

    print("Login Garmin...", flush=True)
    client = _login()
    print("Login ok", flush=True)

    phase_prs(client)
    phase_vo2max(client)
    phase_details(client)
    if _paused:
        print("INCOMPLETO — correr de novo", flush=True)
        sys.exit(2)
    print("DETALHES COMPLETOS", flush=True)


if __name__ == "__main__":
    sys.exit(main())
