"""Stub de integração Suunto (Fase 3 — Suunto app export / suuntool)."""
from __future__ import annotations

import json

from app.config import DATA_DIR

CACHE_PATH = DATA_DIR / "suunto_cache.json"


def read_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text())
    return {"status": "not-implemented-yet", "activities": []}


def write_cache(payload: dict) -> None:
    CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
