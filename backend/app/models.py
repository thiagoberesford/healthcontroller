"""Schemas Pydantic compartilhados."""
from datetime import date, time

from pydantic import BaseModel


class MealItem(BaseModel):
    label: str
    grams: int
    kcal: int
    protein: float
    carbs: float
    fat: float


class Meal(BaseModel):
    id: str
    date: date
    time: time
    text: str
    items: list[MealItem]
    kcal: int
    protein: float
    carbs: float
    fat: float


class BodyMeasurement(BaseModel):
    date: date
    weight_kg: float
    muscle_kg: float | None = None
    fat_pct: float | None = None
    source: str = "manual"  # manual | garmin | xiaomi


class MealParseRequest(BaseModel):
    text: str


class MealParseResponse(BaseModel):
    items: list[MealItem]
    unknown: list[str]
    totals: MealItem | None
