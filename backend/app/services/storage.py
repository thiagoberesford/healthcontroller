"""Persistência simples em JSON (substituível por Supabase na Fase 2)."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time

from app.config import DB_PATH
from app.models import BodyMeasurement, Meal, MealItem


def _load() -> dict:
    if DB_PATH.exists():
        return json.loads(DB_PATH.read_text())
    return {"meals": [], "body": []}


def _save(db: dict) -> None:
    DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2))


# ---------------- refeições ----------------

def add_meal(text: str, items: list[MealItem], meal_time: time | None = None) -> Meal:
    db = _load()
    now = datetime.now()
    meal = Meal(
        id=uuid.uuid4().hex[:12],
        date=now.date(),
        time=meal_time or now.time().replace(microsecond=0),
        text=text,
        items=items,
        kcal=sum(i.kcal for i in items),
        protein=round(sum(i.protein for i in items), 1),
        carbs=round(sum(i.carbs for i in items), 1),
        fat=round(sum(i.fat for i in items), 1),
    )
    db["meals"].append(json.loads(meal.model_dump_json()))
    _save(db)
    return meal


def list_meals(day: date | None = None) -> list[dict]:
    db = _load()
    meals = db["meals"]
    if day:
        meals = [m for m in meals if m["date"] == day.isoformat()]
    return sorted(meals, key=lambda m: (m["date"], m["time"]), reverse=True)


def delete_meal(meal_id: str) -> bool:
    db = _load()
    before = len(db["meals"])
    db["meals"] = [m for m in db["meals"] if m["id"] != meal_id]
    if len(db["meals"]) == before:
        return False
    _save(db)
    return True


# ---------------- corpo ----------------

def add_body_measurement(m: BodyMeasurement) -> dict:
    db = _load()
    entry = m.model_dump()
    entry["date"] = m.date.isoformat()
    db["body"].append(entry)
    db["body"].sort(key=lambda b: b["date"])
    _save(db)
    return entry


def list_body_measurements() -> list[dict]:
    return _load()["body"]
