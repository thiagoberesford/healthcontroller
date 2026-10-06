"""Sync dos treinos planeados (Treinus via SuuntoPlus Guides) -> Supabase.

O Treinus empurra os treinos planeados para a conta Suunto como
"SuuntoPlus Guides" (owner: Treinus). O suuntool lê-os:

  guides list             -> metadados (id, localDate, name)
  guides download <id>    -> zip com guide.json (passos estruturados)

Grava em public.planned_workouts (upsert por id; idempotente).
O campo data traz um resumo dos passos para o frontend:

  { steps: [{title, text, duration_s}], total_duration_s }

Uso:
  .venv/bin/python scripts/suunto_guides_sync.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL", "")
SUUNTOOL_BIN = shutil.which("suuntool") or "/opt/homebrew/bin/suuntool"


def suuntool(*args: str) -> str:
    r = subprocess.run([SUUNTOOL_BIN, *args], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"suuntool {' '.join(args)} falhou: {r.stderr[:200]}")
    return r.stdout


def parse_guide(doc: dict) -> dict:
    """guide.json -> resumo dos passos (notificação + bloco estruturado)."""
    steps = []
    pending_text = None
    for s in doc.get("steps") or []:
        if s.get("type") == "notification":
            texts = [f.get("value") for f in s.get("fields", []) if f.get("type") == "text"]
            pending_text = texts[0] if texts else None
            continue
        if s.get("type") == "fields":
            steps.append({
                "title": s.get("title"),
                "text": pending_text,
                "duration_s": (s.get("trigger") or {}).get("value"),
            })
            pending_text = None
    return {
        "steps": steps,
        "total_duration_s": round(sum(st["duration_s"] or 0 for st in steps)),
    }


def sync_guides(conn, dry_run: bool = False) -> int:
    items = (json.loads(suuntool("guides", "list", "-f", "json")) or {}).get("items") or []
    ids = [i["id"] for i in items if i.get("id")]
    if not dry_run:
        with conn.cursor() as cur:
            cur.execute(
                "delete from public.planned_workouts where not (id = any(%s))",
                (ids,),
            )
    done = 0
    for it in items:
        gid = it.get("id")
        if not gid:
            continue
        try:
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
                tmp = f.name
            subprocess.run(
                [SUUNTOOL_BIN, "guides", "download", gid, "-o", tmp],
                capture_output=True, text=True, timeout=180, check=True,
            )
            with zipfile.ZipFile(tmp) as z:
                guide = json.loads(z.read("guide.json"))
            os.unlink(tmp)
            summary = parse_guide(guide)
            summary["external_id"] = guide.get("externalId")
            print(f"  {it.get('localDate')} | {it.get('name')} "
                  f"({len(summary['steps'])} passos, {summary['total_duration_s']:.0f}s)")
            if not dry_run:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        insert into public.planned_workouts (id, date, name, source, data)
                        values (%s, %s, %s, 'suunto_guide', %s::jsonb)
                        on conflict (id) do update set
                          date = excluded.date, name = excluded.name,
                          data = excluded.data, updated_at = now()
                        """,
                        (gid, it.get("localDate"), it.get("name"), json.dumps(summary)),
                    )
                conn.commit()
            done += 1
        except Exception as ex:
            print(f"  ERRO {gid}: {str(ex)[:120]}")
    return done


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not DB_URL:
        print("ERRO: SUPABASE_DB_URL em falta no .env")
        sys.exit(1)

    with psycopg.connect(DB_URL) as conn:
        n = sync_guides(conn, dry_run=args.dry_run)
        print(f"guides ok: {n}")


if __name__ == "__main__":
    sys.exit(main())
