"""Guia SuuntoPlus para os treinos de ginásio ABC (circuito cronometrado).

Gera guide.json no MESMO formato das guias Treinus (treinus_guide_fix):
por série -> _notif("Exercício — série 2/3") + _block(work_s) + _block("Descanso").
O plano vive em backend/data/gym_plan.json (versionado).

Se o total de passos exceder max_steps, os descansos após a última série de
cada exercício são agrupados/omitidos (transição implícita).

Uso:
  .venv/bin/python scripts/gym_guide_build.py                 # gera as 3 guias em data/gym_guides/
  .venv/bin/python scripts/gym_guide_build.py --workout C    # só o treino C
  .venv/bin/python scripts/gym_guide_build.py --workout A --date 2026-10-14
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
PLAN_PATH = SCRIPTS.parent / "data" / "gym_plan.json"
OUT_DIR = SCRIPTS.parent / "data" / "gym_guides"

# modos desportivos onde a guia aparece: Gym (23) e Strength training (76)
# (mapeamento activityId do HA-Suunto); as corridas ficam nas guias Treinus
ACTIVITIES = [23, 76]


def _notif(text: str) -> dict:
    return {"type": "notification", "title": "Ginásio",
            "fields": [{"type": "text", "value": text}]}


def _block(title: str, duration_s: float) -> dict:
    return {
        "type": "fields",
        "createManualLap": True,
        "trigger": {"type": "stepDuration", "value": duration_s},
        "title": title,
        "fields": [
            {"type": "pace", "title": "Atual"},
            {"type": "stepDurationCountdown", "value": duration_s},
        ],
    }


def load_plan() -> dict:
    return json.loads(PLAN_PATH.read_text())


def gym_steps(workout: dict, defaults: dict, final_block: dict, max_steps: int) -> list[dict]:
    work_s = defaults.get("work_s", 45)
    rest_s = defaults.get("rest_s", 75)

    steps: list[dict] = []
    series: list[tuple[str, int, bool]] = []  # (nome, série total, é última do exercício)
    for ex in workout["exercises"]:
        sets = ex.get("sets", 3)
        for s in range(1, sets + 1):
            series.append((ex["name"], s, s == sets))

    def emit(with_last_rest: bool) -> int:
        out = [_notif(f"{workout['title']}")]
        for name, s, is_last in series:
            out.append(_notif(f"{name} — série {s}"))
            out.append(_block(name[:12], work_s))
            if not is_last or with_last_rest:
                out.append(_block("Descanso", rest_s))
        out.append(_notif(final_block["name"]))
        out.append(_block(final_block["name"], final_block["duration_s"]))
        out.append(_notif("Treino completo. Boa!"))
        return out

    steps = emit(True)
    if len(steps) > max_steps:
        steps = emit(False)
    return steps


def build_gym_guide(plan: dict, key: str, date: str | None = None) -> dict | None:
    workout = (plan.get("workouts") or {}).get(key.upper())
    if not workout:
        return None
    steps = gym_steps(workout, plan.get("defaults") or {},
                      plan.get("final_block") or {}, plan.get("max_steps") or 64)
    guide = {
        "type": "sequence",
        "name": f"Ginásio {key.upper()} — {workout['title']}",
        "description": "Circuito cronometrado do plano ABC (Health Controller)",
        "owner": "Health Controller",
        "activities": ACTIVITIES,
        "usage": "workout",
        "externalId": f"gym-{key.lower()}",
        "steps": steps,
    }
    if date:
        guide["localDate"] = date
    return guide


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workout", choices=["A", "B", "C", "a", "b", "c"])
    ap.add_argument("--date", help="data opcional da guia (YYYY-MM-DD)")
    args = ap.parse_args()

    plan = load_plan()
    keys = [args.workout.upper()] if args.workout else ["A", "B", "C"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for key in keys:
        guide = build_gym_guide(plan, key, args.date)
        if not guide:
            print(f"treino {key} não existe no plano")
            continue
        out = OUT_DIR / f"gym_{key.lower()}.json"
        out.write_text(json.dumps(guide, ensure_ascii=False, indent=2))
        blocks = sum(1 for s in guide["steps"] if s["type"] == "fields")
        total_s = sum(s["trigger"]["value"] for s in guide["steps"] if s["type"] == "fields")
        print(f"{key}: '{guide['name']}' — {len(guide['steps'])} passos "
              f"({blocks} blocos, {total_s / 60:.0f} min) -> {out}")


if __name__ == "__main__":
    sys.exit(main())
