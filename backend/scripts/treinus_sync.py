"""Sync dos treinos planeados direto da API do Treinus -> Supabase.

API (reverse-engineered da app Android com.af2g.treinus):
  POST https://api.treinus.com/v2/app/auth
       {"Param": base64(AES-128-CBC("email|password")), "TokenDevice": "...", "TypeDevice": 1}
       -> {"Teams": [{"Token": "...", "IdTeam": ...}, ...]}
  GET  https://api.treinus.com/v2/app/exercises/planneds   (header "Token": <team token>)
       -> lista de PlannedExercise (Date, Briefing, Detail, Distance, Intensity, ...)

Credenciais: TREINUS_EMAIL / TREINUS_PASSWORD no backend/.env.
Grava em public.planned_workouts com source='treinus' (upsert por id
"treinus_<IdExercise>"). O que está no relógio (SuuntoPlus Guides) fica
em source='suunto_guide' — este é o plano autoritativo do treinador.

Uso:
  .venv/bin/python scripts/treinus_sync.py [--dry-run]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding

load_dotenv()

API = "https://api.treinus.com/v2"
TREINUS_EMAIL = os.getenv("TREINUS_EMAIL", "")
TREINUS_PASSWORD = os.getenv("TREINUS_PASSWORD", "")
DB_URL = os.getenv("SUPABASE_DB_URL", "")

# Chave/IV extraídos de com.af2g.treinus.utils.Cripto (app Android)
# Nota: Ascii.FF (Guava) = form feed = 12, NÃO 0xFF
_AES_KEY = b"tv93h58sk1zh5x8v"
_AES_IV = bytes([12, 34, 56, 78, 90, 102, 114, 126] * 2)


def cript_string(text: str) -> str:
    padder = padding.PKCS7(128).padder()
    data = padder.update(text.encode("utf-8")) + padder.finalize()
    enc = Cipher(algorithms.AES(_AES_KEY), modes.CBC(_AES_IV)).encryptor()
    return base64.b64encode(enc.update(data) + enc.finalize()).decode()


def _req(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    if token:
        req.add_header("Token", token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def login() -> str:
    if not TREINUS_EMAIL or not TREINUS_PASSWORD:
        raise RuntimeError("TREINUS_EMAIL/TREINUS_PASSWORD em falta no .env")
    param = cript_string(f"{TREINUS_EMAIL}|{TREINUS_PASSWORD}")
    status, body = _req("POST", "/app/auth", body={
        "Param": param,
        "TokenDevice": "healthcontroller-mac",
        "TypeDevice": 1,
    })
    if status != 200:
        raise RuntimeError(f"login falhou ({status}): {body[:200].decode('utf-8', 'replace')}")
    doc = json.loads(body)
    teams = doc.get("Teams") or []
    if not teams:
        raise RuntimeError("login OK mas sem teams na resposta")
    print(f"login OK ({len(teams)} team(s))")
    return teams[0].get("Token") or ""


def fetch_planned(token: str, days_back: int = 3, days_ahead: int = 14) -> list[dict]:
    """GET app/exercises/{yyyy-MM-dd} por dia -> ExercisesPlan."""
    planned: list[dict] = []
    today = datetime.now().date()
    for delta in range(-days_back, days_ahead + 1):
        d = (today + timedelta(days=delta)).isoformat()
        status, body = _req("GET", f"/app/exercises/{d}", token=token)
        if status != 200:
            continue  # dia sem plano ou indisponível
        doc = json.loads(body)
        planned.extend(doc.get("ExercisesPlan") or [])
    return planned


WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


def map_row(p: dict) -> dict | None:
    pid = p.get("IdExercise")
    date = (p.get("Date") or "")[:10]
    if not pid or not date:
        return None
    d = datetime.strptime(date, "%Y-%m-%d")
    wd = WEEKDAYS[d.weekday()]
    type_name = p.get("Type") or p.get("Genre") or "Treino"
    return {
        "id": f"treinus_{pid}",
        "date": date,
        "name": f"{type_name} {wd} {d.strftime('%d/%m')}",
        "data": {
            "briefing": (p.get("Briefing") or "").replace("\r\n", "\n").strip(),
            "detail": p.get("Detail"),
            "genre": p.get("Genre"),
            "course_type": p.get("CourseType"),
            "distance": p.get("Distance"),
            "distance_unit": p.get("DistanceUnit"),
            "time_min": p.get("TimeMin"),
            "time_max": p.get("TimeMax"),
            "done": p.get("Done"),
            "id_exercise": pid,
        },
    }


def sync(dry_run: bool = False) -> int:
    token = login()
    planned = fetch_planned(token)
    print(f"planneds: {len(planned)}")
    if dry_run:
        print(json.dumps(planned, ensure_ascii=False, indent=1)[:4000])
        return len(planned)

    rows = [m for p in planned if (m := map_row(p))]
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # apagar planeados do Treinus que já não existem na API
            cur.execute(
                "delete from public.planned_workouts where source = 'treinus' and not (id = any(%s))",
                ([r["id"] for r in rows],),
            )
            cur.executemany(
                """
                insert into public.planned_workouts (id, date, name, source, data)
                values (%s, %s, %s, 'treinus', %s::jsonb)
                on conflict (id) do update set
                  date = excluded.date, name = excluded.name,
                  data = excluded.data, updated_at = now()
                """,
                [(r["id"], r["date"], r["name"], json.dumps(r["data"], ensure_ascii=False)) for r in rows],
            )
        conn.commit()
    print(f"treinus ok: {len(rows)} planeados")
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)

    sync(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
