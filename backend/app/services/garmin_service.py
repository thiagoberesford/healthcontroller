"""Integração Garmin Connect (biblioteca garminconnect).

Fluxo:
1. `uvicorn app.main:app` e sincronizar uma vez (salva token em ~/.garminconnect)
2. GET /api/garmin devolve dados recentes (cache em backend/data/garmin_cache.json)
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from app.config import DATA_DIR, GARMIN_DOMAIN, GARMIN_EMAIL, GARMIN_PASSWORD, GARMIN_TOKEN_DIR

CACHE_PATH = DATA_DIR / "garmin_cache.json"


def read_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return {"status": "never-synced", "activities": [], "daily": []}


def write_cache(payload: dict) -> None:
    payload["synced_at"] = datetime.now().isoformat(timespec="seconds")
    CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def login_and_sync(days: int = 7) -> dict:
    from garminconnect import Garmin

    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD, domain=GARMIN_DOMAIN)
    try:
        client.login(GARMIN_TOKEN_DIR)
    except Exception:
        client.login()
        client.dump_garmin_tokens(GARMIN_TOKEN_DIR)

    start = date.today() - timedelta(days=days)
    daily = []
    d = start
    while d <= date.today():
        try:
            stats = client.get_stats(d.isoformat())
            daily.append(stats)
        except Exception:
            pass
        d += timedelta(days=1)

    activities = client.get_activities_by_date(start.isoformat(), date.today().isoformat())
    payload = {
        "status": "ok",
        "daily": daily,
        "activities": [
            {
                "id": a.get("activityId"),
                "name": a.get("activityName"),
                "type": a.get("activityType", {}).get("typeKey"),
                "start": a.get("startTimeLocal"),
                "distance_km": round((a.get("distance") or 0) / 1000, 2),
                "duration_s": a.get("duration"),
                "kcal": a.get("calories"),
                "avg_hr": a.get("averageHR"),
            }
            for a in activities
        ],
    }
    write_cache(payload)
    return payload
