"""Corrige as guias SuuntoPlus (relógio) com o plano atual do Treinus.

O Treinus empurra as guias para a conta Suunto, mas não re-exporta
edições do treinador — o relógio fica a guiar a versão antiga. Este
script reconstrói cada guia a partir do campo `detail` estruturado do
plano atual (API Treinus, já em public.planned_workouts) e substitui a
guia dessa data na conta: delete + upload (o `guides update` devolve
404 nas guias criadas pelo Treinus, que não são nossas).

Mapeamento SegmentType -> passo:
  1501 aquecer | 1500 bloco de repetições (Steps x Repetitions) | 1506 desaquecer

Uso:
  .venv/bin/python scripts/treinus_guide_fix.py [--dry-run] [--upload]
  --upload: datas sem guia na conta também recebem guia nova
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL", "")
SUUNTOOL_BIN = shutil.which("suuntool") or "/opt/homebrew/bin/suuntool"

ACTIVITIES = [1, 22, 0, 83, 92, 11, 80, 53]  # modos desportivos (igual às guias do Treinus)
WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]


def _suuntool(*args: str, binary_out: str | None = None) -> bytes | str:
    cmd = [SUUNTOOL_BIN, *args]
    r = subprocess.run(cmd, capture_output=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError(f"suuntool {' '.join(args[:3])} falhou: {r.stderr[:200].decode('utf-8', 'replace')}")
    return r.stdout


def _notif(text: str) -> dict:
    return {"type": "notification", "title": "Treinus",
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


def guide_steps(detail: dict) -> list[dict]:
    steps: list[dict] = []
    segs = (detail or {}).get("List") or []

    def warm_cool(seg: dict) -> None:
        dur = seg.get("TimeMax") or seg.get("TimeMin") or 0
        minutes = dur / 60
        brief = seg.get("DetailBriefing") or ""
        title = "Aquecer" if seg.get("SegmentType") == 1501 else "Desaquecer"
        steps.append(_notif(f"{title} {minutes:.0f}'" + (f"\n{brief}" if brief else "")))
        steps.append(_block(title, dur))

    for seg in segs:
        stype = seg.get("SegmentType")
        if stype in (1501, 1506):
            warm_cool(seg)
        elif stype == 1500:
            reps = seg.get("Repetitions") or 1
            inner = seg.get("Steps") or []
            for rep in range(1, reps + 1):
                for s in inner:
                    dur = s.get("TimeMax") or s.get("TimeMin") or 0
                    text = (s.get("SummaryText") or "Treino").strip()
                    steps.append(_notif(f"{text} ({rep}/{reps})"))
                    steps.append(_block(text.split()[0], dur))
    if steps:
        steps.append(_notif("Parabéns pela conclusão da atividade.\n#treinus"))
    return steps


def build_guide(row: dict) -> dict | None:
    detail = row.get("detail")
    if isinstance(detail, str):
        try:
            detail = json.loads(detail)
        except json.JSONDecodeError:
            detail = None
    steps = guide_steps(detail or {})
    if not steps:
        return None
    d = datetime.strptime(row["date"], "%Y-%m-%d")
    wd = WEEKDAYS[d.weekday()]
    suffix = f"{wd} {d.strftime('%d/%m')}"
    name = row["name"] if suffix in row["name"] else f"{row['name']} {suffix}"
    return {
        "type": "sequence",
        "name": name,
        "description": "Consulte os detalhes desta atividade no Treinus",
        "owner": "Treinus",
        "activities": ACTIVITIES,
        "usage": "workout",
        "localDate": row["date"],
        "externalId": str(row["id_exercise"]),
        "steps": steps,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--upload", action="store_true", help="datas sem guia recebem upload novo")
    args = ap.parse_args()

    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select date::text, name, data->>'detail' as detail, data->>'id_exercise' as id_exercise
                from public.planned_workouts
                where source = 'treinus' and date >= current_date
                order by date
                """
            )
            rows = [dict(zip(("date", "name", "detail", "id_exercise"), r)) for r in cur.fetchall()]

    guides = json.loads(_suuntool("guides", "list", "-f", "json")).get("items") or []
    by_date = {g["localDate"]: g["id"] for g in guides}

    # icon: reutilizar o de uma guia existente (logo Treinus)
    icon: bytes | None = None
    for g in guides:
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            tmp = f.name
        try:
            subprocess.run([SUUNTOOL_BIN, "guides", "download", g["id"], "-o", tmp],
                           capture_output=True, timeout=180, check=True)
            with zipfile.ZipFile(tmp) as z:
                if "icon.png" in z.namelist():
                    icon = z.read("icon.png")
            break
        except Exception:
            pass
        finally:
            os.unlink(tmp)

    print(f"plano: {len(rows)} datas futuras | guias na conta: {len(guides)}")
    for row in rows:
        guide = build_guide(row)
        if not guide:
            print(f"  {row['date']}: sem segmentos no detail — a ignorar")
            continue
        gid = by_date.get(row["date"])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("guide.json", json.dumps(guide, ensure_ascii=False))
            z.writestr("manifest.json", json.dumps(
                {"name": guide["name"], "icon": "icon.png", "files": ["guide.json"]}))
            if icon:
                z.writestr("icon.png", icon)
        if gid:
            action = "replace"  # delete + upload
        elif args.upload:
            action = "upload"
        else:
            print(f"  {row['date']}: sem guia na conta (usar --upload para criar)")
            continue
        if args.dry_run:
            print(f"  {row['date']}: DRY-RUN {action} '{guide['name']}' "
                  f"({len(guide['steps'])} passos)")
            continue
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
            f.write(buf.getvalue())
            tmp = f.name
        try:
            if gid:
                _suuntool("guides", "delete", gid, "--yes")
            _suuntool("guides", "upload", tmp)
            print(f"  {row['date']}: {action} OK '{guide['name']}'")
        finally:
            os.unlink(tmp)
    print("guides fix: concluído")


if __name__ == "__main__":
    sys.exit(main())
