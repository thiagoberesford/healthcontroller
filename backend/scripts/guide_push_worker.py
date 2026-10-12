"""Worker da fila guide_push_queue: aprovações do site -> guia no relógio.

Cada linha pending tem (date, payload). O worker:
  1. busca o treino planeado (source='treinus') dessa data
  2. constrói guide.json (treinus_guide_fix.build_guide)
  3. apaga a guia existente dessa data e faz upload da nova
  4. marca a fila 'done' e planned_workouts.push_status='watch'

Corre via LaunchAgent (com.healthcontroller.guide_push, a cada 5 min)
ou manualmente: .venv/bin/python scripts/guide_push_worker.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import zipfile
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL", "")

from treinus_guide_fix import build_guide, _suuntool, SUUNTOOL_BIN  # noqa: E402
from gym_guide_build import build_gym_guide, load_plan  # noqa: E402

ICON_CACHE = Path(__file__).resolve().parent.parent / "data" / "guide_icon.png"


def get_icon() -> bytes | None:
    if ICON_CACHE.exists():
        return ICON_CACHE.read_bytes()
    guides = json.loads(_suuntool("guides", "list", "-f", "json")).get("items") or []
    for g in guides:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            tmp = f.name
        try:
            import subprocess
            subprocess.run([SUUNTOOL_BIN, "guides", "download", g["id"], "-o", tmp],
                           capture_output=True, timeout=180, check=True)
            with zipfile.ZipFile(tmp) as z:
                if "icon.png" in z.namelist():
                    ICON_CACHE.parent.mkdir(parents=True, exist_ok=True)
                    ICON_CACHE.write_bytes(z.read("icon.png"))
                    return ICON_CACHE.read_bytes()
        except Exception:
            pass
        finally:
            os.unlink(tmp)
    return None


def upload_guide(guide: dict, icon: bytes | None, match: str = "date") -> str:
    """match='date': substitui a guia com a mesma localDate (Treinus).
    match='name': substitui a guia com o mesmo nome (ginásio, sem data)."""
    guides = json.loads(_suuntool("guides", "list", "-f", "json")).get("items") or []
    for g in guides:
        same = (g.get("localDate") == guide.get("localDate") if match == "date"
                else g.get("name") == guide["name"])
        if same:
            _suuntool("guides", "delete", g["id"], "--yes")
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
        with zipfile.ZipFile(f, "w") as z:
            z.writestr("guide.json", json.dumps(guide, ensure_ascii=False))
            z.writestr("manifest.json", json.dumps(
                {"name": guide["name"], "icon": "icon.png", "files": ["guide.json"]}))
            if icon:
                z.writestr("icon.png", icon)
        tmp = f.name
    try:
        out = _suuntool("guides", "upload", tmp)
        return json.loads(out)["id"]
    finally:
        os.unlink(tmp)


def process_queue() -> int:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # uma linha por data (cliques repetidos criam linhas extra)
            cur.execute(
                "select distinct on (date) id, date, payload from public.guide_push_queue "
                "where status = 'pending' and source = 'treinus' order by date, id limit 10"
            )
            rows = cur.fetchall()
            # ginásio: uma linha por treino (A/B/C), não por data
            cur.execute(
                "select distinct on (payload->>'workout') id, date, payload "
                "from public.guide_push_queue "
                "where status = 'pending' and source = 'gym' "
                "order by payload->>'workout', id limit 10"
            )
            gym_rows = cur.fetchall()
        if not rows and not gym_rows:
            return 0
        icon = get_icon()
        n = 0
        for qid, d, payload in rows:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "select date::text, name, data->>'detail', data->>'id_exercise' "
                        "from public.planned_workouts where source = 'treinus' and date = %s",
                        (d,),
                    )
                    r = cur.fetchone()
                if not r:
                    raise RuntimeError(f"sem treino planeado Treinus em {d}")
                row = dict(zip(("date", "name", "detail", "id_exercise"), r))
                if payload:
                    # payload (edição futura) sobrepõe campos do row
                    for k, v in payload.items():
                        row[k] = v
                guide = build_guide(row)
                if not guide:
                    raise RuntimeError("detail sem segmentos")
                gid = upload_guide(guide, icon)
                with conn.cursor() as cur:
                    # resolve todas as pendências dessa data, não só esta linha
                    cur.execute(
                        "update public.guide_push_queue set status = 'done', "
                        "processed_at = now(), error = null "
                        "where date = %s and status = 'pending'", (d,))
                    cur.execute(
                        "update public.planned_workouts set push_status = 'watch', "
                        "pushed_at = now() where source = 'treinus' and date = %s", (d,))
                conn.commit()
                print(f"  {d}: guia {gid} enviada ('{guide['name']}')")
                n += 1
            except Exception as ex:
                msg = str(ex)[:300]
                print(f"  {d}: ERRO {msg}")
                with conn.cursor() as cur:
                    cur.execute(
                        "update public.guide_push_queue set status = 'error', "
                        "processed_at = now(), error = %s where id = %s", (msg, qid))
                    cur.execute(
                        "update public.planned_workouts set push_status = 'error' "
                        "where source = 'treinus' and date = %s", (d,))
                conn.commit()
        # ginásio ABC: guia estática por treino OU rotação agendada com data
        for qid, d, payload in gym_rows:
            payload = payload or {}
            try:
                plan = load_plan()
                if payload.get("schedule"):
                    # rotação A->B->C nos dias escolhidos, semanas à frente
                    weekdays = set(payload.get("weekdays") or [0, 2, 4])
                    weeks = int(payload.get("weeks") or 4)
                    today = date.today()
                    dates = [today + timedelta(days=i)
                             for i in range(weeks * 7 + 1)
                             if (today + timedelta(days=i)).weekday() in weekdays]
                    sent = 0
                    for i, gd in enumerate(dates):
                        guide = build_gym_guide(plan, "ABC"[i % 3], gd.isoformat())
                        if guide:
                            upload_guide(guide, icon, match="name")
                            sent += 1
                    with conn.cursor() as cur:
                        cur.execute(
                            "update public.guide_push_queue set status = 'done', "
                            "processed_at = now(), error = null "
                            "where source = 'gym' and payload ? 'schedule' "
                            "and status = 'pending'")
                    conn.commit()
                    print(f"  ginásio: rotação agendada — {sent} guias datadas "
                          f"({len(dates)} dias de ginásio em {weeks} semanas)")
                    n += 1
                    continue
                wk = (payload.get("workout") or "").upper()
                guide = build_gym_guide(plan, wk, payload.get("date"))
                if not guide:
                    raise RuntimeError(f"treino de ginásio '{wk}' não existe no plano")
                gid = upload_guide(guide, icon, match="name")
                with conn.cursor() as cur:
                    cur.execute(
                        "update public.guide_push_queue set status = 'done', "
                        "processed_at = now(), error = null "
                        "where source = 'gym' and payload->>'workout' = %s "
                        "and status = 'pending'", (wk,))
                conn.commit()
                print(f"  ginásio {wk}: guia {gid} enviada ('{guide['name']}')")
                n += 1
            except Exception as ex:
                msg = str(ex)[:300]
                print(f"  ginásio: ERRO {msg}")
                with conn.cursor() as cur:
                    cur.execute(
                        "update public.guide_push_queue set status = 'error', "
                        "processed_at = now(), error = %s where id = %s", (msg, qid))
                conn.commit()
        return n


def main() -> None:
    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)
    n = process_queue()
    if n:
        print(f"guide_push_worker: {n} pedidos processados")
    else:
        print("guide_push_worker: fila vazia")


if __name__ == "__main__":
    sys.exit(main())
