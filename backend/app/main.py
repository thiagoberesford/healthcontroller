"""API do HealthTracker. Swagger: http://localhost:8000/docs"""
from datetime import date, datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import BodyMeasurement, MealParseRequest, MealParseResponse
from app.services import food_db, garmin_service, storage, suunto_service

app = FastAPI(title="HealthTracker API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # refine quando hospedar
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- nutrição ----------------

@app.post("/api/parse-meal", response_model=MealParseResponse)
def parse_meal(req: MealParseRequest) -> MealParseResponse:
    return food_db.parse_meal(req.text)


@app.post("/api/meals")
def create_meal(req: MealParseRequest):
    parsed = food_db.parse_meal(req.text)
    if not parsed.items:
        raise HTTPException(422, "Nenhum alimento reconhecido.")
    return storage.add_meal(req.text, parsed.items, meal_time=datetime.now().time())


@app.get("/api/meals")
def get_meals(day: date | None = None):
    return storage.list_meals(day)


@app.delete("/api/meals/{meal_id}")
def del_meal(meal_id: str):
    if not storage.delete_meal(meal_id):
        raise HTTPException(404, "Refeição não encontrada.")
    return {"ok": True}


# ---------------- corpo ----------------

@app.post("/api/body")
def add_body(m: BodyMeasurement):
    return storage.add_body_measurement(m)


@app.get("/api/body")
def list_body():
    return storage.list_body_measurements()


# ---------------- dispositivos ----------------

@app.get("/api/garmin")
def garmin_data():
    return garmin_service.read_cache()


@app.get("/api/garmin/activities")
def garmin_activities(start: date | None = None, end: date | None = None):
    return {
        "activities": garmin_service.list_activities(
            start.isoformat() if start else None,
            end.isoformat() if end else None,
        )
    }


@app.get("/api/garmin/daily")
def garmin_daily(start: date | None = None, end: date | None = None):
    return {
        "daily": garmin_service.list_daily(
            start.isoformat() if start else None,
            end.isoformat() if end else None,
        )
    }


@app.post("/api/garmin/sync")
def garmin_sync(full: bool = False, days: int = 7):
    try:
        if full:
            return garmin_service.sync_full_history(daily_days=days)
        return garmin_service.login_and_sync(days=days)
    except Exception as e:
        raise HTTPException(502, f"Falha na sincronização Garmin: {e}")


@app.get("/api/suunto")
def suunto_data():
    return suunto_service.read_cache()


@app.get("/api/health")
def health():
    return {"status": "ok"}
