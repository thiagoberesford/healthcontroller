"""Snapshot completo da conta Garmin Connect -> backend/data/garmin_export/.

Resumível: cada fase/ficheiro só é refeito se não existir.
Uso:  .venv/bin/python scripts/garmin_snapshot.py [--start 2019-06-26]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.garmin_service import _login

EXPORT_DIR = Path(__file__).resolve().parent.parent / "data" / "garmin_export"
ACTIVITY_FILES_DIR = EXPORT_DIR / "activity_files"
SLEEP_DIR = EXPORT_DIR / "sleep"
DAILY_DIR = EXPORT_DIR / "daily"

RATE_LIMIT_PAUSE = 60
CALL_DELAY = 0.08

_t0 = 0.0
_max_seconds = 240.0


_paused = False


def budget_left() -> bool:
    return (time.time() - _t0) < _max_seconds


def _fmt(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def _retry(fn, tries: int = 3):
    last_exc = None
    for attempt in range(tries):
        try:
            return fn()
        except Exception as e:
            msg = str(e)
            if "429" in msg or "Too Many Requests" in msg:
                wait = RATE_LIMIT_PAUSE * (attempt + 1)
                print(f"  429 rate limited, esperando {wait}s...", flush=True)
                time.sleep(wait)
                last_exc = e
            else:
                raise
    raise last_exc


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_fmt(data), encoding="utf-8")


def phase_profile(client) -> None:
    out = EXPORT_DIR / "profile.json"
    if out.exists():
        print("[1/5] profile: já existe, skip", flush=True)
        return
    profile = _retry(client.get_user_profile)
    settings = _retry(client.get_userprofile_settings)
    devices = _retry(client.get_devices)
    gear = []
    for key in ("profileId", "userProfilePk", "id"):
        uid = profile.get(key) if isinstance(profile, dict) else None
        if uid:
            try:
                gear = _retry(lambda u=str(uid): client.get_gear(u))
            except Exception as ex:
                print(f"  gear indisponível: {str(ex)[:80]}", flush=True)
            break
    else:
        print("  gear skip: sem userProfileNumber no profile", flush=True)
    save_json(out, {"profile": profile, "settings": settings, "devices": devices, "gear": gear})
    print(f"[1/5] profile ok (devices={len(devices)}, gear={len(gear)})", flush=True)


def phase_activities(client) -> list[dict]:
    out = EXPORT_DIR / "activities.json"
    if out.exists():
        print("[2/5] activities: já existe, skip", flush=True)
        return json.loads(out.read_text())
    acts = []
    page, size = 0, 200
    while True:
        batch = _retry(lambda p=page: client.get_activities(p, size))
        if not batch:
            break
        acts.extend(batch)
        print(f"  activities página {page}: +{len(batch)} (total {len(acts)})", flush=True)
        if len(batch) < size:
            break
        page += size
    save_json(out, acts)
    print(f"[2/5] activities ok ({len(acts)} atividades)", flush=True)
    return acts


def pause(msg: str) -> None:
    global _paused
    _paused = True
    print(f"  PAUSA (orçamento de tempo): {msg} — rerun para continuar", flush=True)


def phase_activity_files(client, activities: list[dict]) -> None:
    print(f"[3/5] ficheiros originais (FIT) de {len(activities)} atividades...", flush=True)
    skipped = done = failed = 0
    for i, a in enumerate(activities, 1):
        if not budget_left():
            pause(f"ficheiros em {i}/{len(activities)}")
            return
        aid = str(a.get("activityId"))
        if not aid:
            continue
        existing = list(ACTIVITY_FILES_DIR.glob(f"{aid}.*"))
        if existing:
            skipped += 1
            continue
        try:
            data = _retry(lambda a_=aid: client.download_activity(a_, client.ActivityDownloadFormat.ORIGINAL))
            if data[:4] == b"PK\x03\x04":
                ext = "zip"
            elif b"FIT" in data[:20]:
                ext = "fit"
            else:
                ext = "bin"
            ACTIVITY_FILES_DIR.mkdir(parents=True, exist_ok=True)
            (ACTIVITY_FILES_DIR / f"{aid}.{ext}").write_bytes(data)
            done += 1
        except Exception as e:
            failed += 1
            print(f"  ERRO {aid}: {str(e)[:120]}", flush=True)
        if i % 50 == 0:
            print(f"  progresso: {i}/{len(activities)} (ok {done}, skip {skipped}, erro {failed})", flush=True)
        time.sleep(CALL_DELAY)
    print(f"[3/5] ficheiros ok (baixados {done}, já existiam {skipped}, erros {failed})", flush=True)


def phase_body(client, start: date, end: date) -> None:
    year = start.year
    while year <= end.year:
        bc_path = EXPORT_DIR / f"body_composition_{year}.json"
        wi_path = EXPORT_DIR / f"weigh_ins_{year}.json"
        if not bc_path.exists():
            s = max(start, date(year, 1, 1)).isoformat()
            e = min(end, date(year, 12, 31)).isoformat()
            try:
                save_json(bc_path, _retry(lambda: client.get_body_composition(s, e)))
                print(f"  body composition {year} ok", flush=True)
            except Exception as ex:
                print(f"  body composition {year} ERRO: {str(ex)[:120]}", flush=True)
                save_json(bc_path, {"error": str(ex)})
            time.sleep(CALL_DELAY)
        if not wi_path.exists():
            s = max(start, date(year, 1, 1)).isoformat()
            e = min(end, date(year, 12, 31)).isoformat()
            try:
                save_json(wi_path, _retry(lambda: client.get_weigh_ins(s, e)))
                print(f"  weigh-ins {year} ok", flush=True)
            except Exception as ex:
                print(f"  weigh-ins {year} ERRO: {str(ex)[:120]}", flush=True)
                save_json(wi_path, {"error": str(ex)})
            time.sleep(CALL_DELAY)
        year += 1
    print("[4/5] corpo ok", flush=True)


def _fetch_day(client, s: str) -> None:
    """Busca sono + stats + HRV de um dia e grava os ficheiros."""
    sleep_path = SLEEP_DIR / f"{s}.json"
    daily_path = DAILY_DIR / f"{s}.json"
    if not sleep_path.exists():
        try:
            save_json(sleep_path, _retry(lambda: client.get_sleep_data(s)))
            time.sleep(CALL_DELAY)
        except Exception as ex:
            if "404" not in str(ex):
                save_json(sleep_path, {"error": str(ex)})
    if not daily_path.exists():
        try:
            stats = _retry(lambda: client.get_stats(s))
            hrv = None
            try:
                hrv = client.get_hrv_data(s)
            except Exception:
                pass
            save_json(daily_path, {"stats": stats, "hrv": hrv})
            time.sleep(CALL_DELAY)
        except Exception as ex:
            if "404" not in str(ex):
                save_json(daily_path, {"error": str(ex)})


def phase_daily(client, start: date, end: date) -> None:
    from concurrent.futures import ThreadPoolExecutor

    total = (end - start).days + 1
    print(f"[5/5] dados diários (sono, stats, HRV) {start} -> {end} ({total} dias)...", flush=True)
    pending = []
    d = start
    while d <= end:
        s = d.isoformat()
        if not (SLEEP_DIR / f"{s}.json").exists() or not (DAILY_DIR / f"{s}.json").exists():
            pending.append(s)
        d += timedelta(days=1)
    print(f"  {len(pending)} dias em falta", flush=True)

    done = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = []
        for i, s in enumerate(pending):
            if not budget_left():
                pause(f"dados diários: {done}/{len(pending)} dias processados")
                break
            futures.append(ex.submit(_fetch_day, client, s))
            if len(futures) >= 40:
                for f in futures:
                    f.result()
                futures = []
                done += 40
                print(f"  progresso: {done}/{len(pending)} dias", flush=True)
        for f in futures:
            f.result()
    if not _paused:
        print("[5/5] dados diários ok", flush=True)


def main() -> None:
    global _t0, _max_seconds
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2019-06-26", help="primeira data da conta")
    ap.add_argument("--max-seconds", type=float, default=240.0, help="orçamento de tempo antes de pausar")
    args = ap.parse_args()
    _max_seconds = args.max_seconds
    _t0 = time.time()
    start = date.fromisoformat(args.start)
    end = date.today()

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Login Garmin...", flush=True)
    client = _login()
    print("Login ok", flush=True)

    phase_profile(client)
    activities = phase_activities(client)
    phase_activity_files(client, activities)
    phase_body(client, start, end)
    phase_daily(client, start, end)

    if _paused:
        print("SNAPSHOT INCOMPLETO (pausado por orçamento) — correr de novo para continuar", flush=True)
        sys.exit(2)

    # data da primeira atividade real (caso --start seja depois)
    oldest = activities[-1].get("startTimeLocal", "")[:10] if activities else None
    save_json(EXPORT_DIR / "snapshot_meta.json", {
        "started": start.isoformat(),
        "ended": end.isoformat(),
        "oldest_activity": oldest,
        "activities": len(activities),
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    print("SNAPSHOT COMPLETO", flush=True)


if __name__ == "__main__":
    sys.exit(main())
