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
EXPORT_ACTIVITIES_PATH = DATA_DIR / "garmin_export" / "activities.json"


def read_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return {"status": "never-synced", "activities": [], "daily": []}


def list_activities(start_iso: str | None = None, end_iso: str | None = None) -> list[dict]:
    """Atividades (snapshot completo se existir, senão cache), filtradas por data (ISO)."""
    if EXPORT_ACTIVITIES_PATH.exists():
        acts = [_summarize(a) for a in json.loads(EXPORT_ACTIVITIES_PATH.read_text())]
    else:
        acts = read_cache().get("activities", [])
    acts = [a for a in acts if a.get("start")]
    acts.sort(key=lambda a: a["start"], reverse=True)
    if start_iso:
        acts = [a for a in acts if a["start"][:10] >= start_iso]
    if end_iso:
        acts = [a for a in acts if a["start"][:10] <= end_iso]
    return acts


def write_cache(payload: dict) -> None:
    payload["synced_at"] = datetime.now().isoformat(timespec="seconds")
    CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def _login():
    from garminconnect import Garmin

    client = Garmin(
        GARMIN_EMAIL,
        GARMIN_PASSWORD,
        is_cn=GARMIN_DOMAIN.endswith(".cn"),
    )
    needs_mfa, _ = client.login(str(GARMIN_TOKEN_DIR))
    if needs_mfa:
        raise RuntimeError(
            "Garmin pediu MFA (2FA). Execute o login interativo uma vez para "
            f"gerar o token em {GARMIN_TOKEN_DIR}."
        )
    return client


def _summarize(a: dict) -> dict:
    return {
        "id": a.get("activityId"),
        "name": a.get("activityName"),
        "type": a.get("activityType", {}).get("typeKey"),
        "start": a.get("startTimeLocal"),
        "distance_km": round((a.get("distance") or 0) / 1000, 2),
        "duration_s": a.get("duration"),
        "kcal": a.get("calories"),
        "avg_hr": a.get("averageHR"),
    }


def login_and_sync(days: int = 7) -> dict:

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
        "activities": [_summarize(a) for a in activities],
    }
    write_cache(payload)
    return payload


def sync_full_history(daily_days: int = 7) -> dict:
    """Busca TODAS as atividades da conta (paginação) + stats diários recentes."""
    client = _login()

    start = date.today() - timedelta(days=daily_days)
    daily = []
    d = start
    while d <= date.today():
        try:
            daily.append(client.get_stats(d.isoformat()))
        except Exception:
            pass
        d += timedelta(days=1)

    all_activities: list[dict] = []
    page_size = 200
    start_index = 0
    while True:
        batch = client.get_activities(start_index, page_size)
        if not batch:
            break
        all_activities.extend(batch)
        if len(batch) < page_size:
            break
        start_index += page_size

    all_activities.sort(key=lambda a: a.get("startTimeLocal") or "", reverse=True)
    payload = {
        "status": "ok",
        "daily": daily,
        "activities": [_summarize(a) for a in all_activities],
    }
    write_cache(payload)
    return payload
