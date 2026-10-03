"""Constrói a base de alimentos portugueses (backend/data/foods_pt.json).

Fontes:
- Open Food Facts (search.pl): produtos de marca vendidos em PT com macros
  por 100g (iogurtes Continente, Pingo Doce, Mimosa, Lidl, ...)
- Genéricos: os FOODS atuais do food_db.py + curadoria manual PT

Resumível: resultados crus em data/food_db_raw.jsonl; queries feitas em
data/food_db_progress.txt. Uso (repetir até terminar):
  .venv/bin/python scripts/build_food_db.py [--max-seconds 200]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "food_db_raw.jsonl"
PROGRESS = DATA / "food_db_progress.txt"
OUT = DATA / "foods_pt.json"

UA = "healthcontroller-food-db/1.0 (github.com/thiagoberesford/healthcontroller)"
BASE = "https://pt.openfoodfacts.org/cgi/search.pl?search_terms={}&search_simple=1&json=1&page_size=100&page={}"

BRANDS = [
    "continente protein", "continente iogurte", "continente equilíbrio",
    "continente pão", "continente queijo", "pingo doce iogurte",
    "pingo doce", "mimosa", "danone", "nestlé portugal", "milbona",
    "compal", "viveiro", "lidl portugal", "mia", "jörd",
]
GENERIC_TERMS = [
    "iogurte grego", "iogurte natural", "iogurte magro", "skyr",
    "pão de mistura", "broa de milho", "pão de centeio",
    "bacalhau", "francesinha", "pastel de nata", "caldo verde",
    "queijo flamengo", "queijo fresco", "requeijão", "flamengo",
    "leite meio gordo", "leite magro", "cereal", "torrada",
    "tremoços", "azeitonas", "sardinhas em lata", "atum em lata",
    "gelado", "batido proteico", "barra proteica", "bifana", "prego",
    "bolo", "tosta mista", "sopa", "salada", "atum",
]

# genéricos curados (por 100g; INSA/USDA/TACO aproximações públicas)
CURATED = [
    {"name": "Francesinha", "category": "prato", "portion": 400, "kcal": 220, "protein": 12, "carbs": 14, "fat": 13},
    {"name": "Pastel de nata", "category": "doçaria", "portion": 65, "kcal": 297, "protein": 6, "carbs": 33, "fat": 15},
    {"name": "Bacalhau à brás", "category": "prato", "portion": 350, "kcal": 190, "protein": 14, "carbs": 10, "fat": 11},
    {"name": "Bacalhau cozido", "category": "peixe", "portion": 200, "kcal": 105, "protein": 23, "carbs": 0, "fat": 0.9},
    {"name": "Caldo verde", "category": "sopa", "portion": 300, "kcal": 48, "protein": 2.4, "carbs": 6, "fat": 1.5},
    {"name": "Pão de mistura", "category": "pão", "portion": 50, "kcal": 253, "protein": 8.5, "carbs": 51, "fat": 1.8},
    {"name": "Broa de milho", "category": "pão", "portion": 70, "kcal": 266, "protein": 6.5, "carbs": 54, "fat": 2.5},
    {"name": "Queijo flamengo", "category": "queijo", "portion": 30, "kcal": 330, "protein": 24, "carbs": 1, "fat": 26},
    {"name": "Queijo fresco", "category": "queijo", "portion": 100, "kcal": 167, "protein": 15, "carbs": 2, "fat": 10.5},
    {"name": "Bifana no pão", "category": "sanduíche", "portion": 180, "kcal": 235, "protein": 15, "carbs": 28, "fat": 6.5},
    {"name": "Prego no pão", "category": "sanduíche", "portion": 200, "kcal": 245, "protein": 17, "carbs": 26, "fat": 8},
    {"name": "Tremoços", "category": "snack", "portion": 50, "kcal": 119, "protein": 10, "carbs": 9, "fat": 3.5},
    {"name": "Azeitonas", "category": "snack", "portion": 30, "kcal": 145, "protein": 1, "carbs": 4, "fat": 15},
    {"name": "Sardinhas em lata (azeite)", "category": "peixe", "portion": 90, "kcal": 208, "protein": 25, "carbs": 0, "fat": 11},
    {"name": "Papas de aveia com leite", "category": "pequeno-almoço", "portion": 250, "kcal": 92, "protein": 4, "carbs": 13, "fat": 2.5},
    {"name": "Sonho", "category": "doçaria", "portion": 60, "kcal": 380, "protein": 5, "carbs": 40, "fat": 22},
    {"name": "Bolo de arroz", "category": "doçaria", "portion": 80, "kcal": 390, "protein": 6, "carbs": 52, "fat": 16},
    {"name": "Omelette 3 ovos", "category": "ovos", "portion": 180, "kcal": 154, "protein": 11, "carbs": 0.7, "fat": 11.5},
    {"name": "Tosta mista", "category": "sanduíche", "portion": 120, "kcal": 280, "protein": 13, "carbs": 29, "fat": 12},
    {"name": "Bacalhau à Gomes de Sá", "category": "prato", "portion": 350, "kcal": 150, "protein": 13, "carbs": 9, "fat": 7},
    {"name": "Arroz de polvo", "category": "prato", "portion": 300, "kcal": 140, "protein": 9, "carbs": 15, "fat": 4.5},
    {"name": "Polvo cozido", "category": "peixe", "portion": 150, "kcal": 82, "protein": 15, "carbs": 2, "fat": 1.5},
    {"name": "Peito de peru (fatiado)", "category": "carne", "portion": 40, "kcal": 104, "protein": 19, "carbs": 1, "fat": 2.5},
    {"name": "Bife de porco grelhado", "category": "carne", "portion": 150, "kcal": 172, "protein": 27, "carbs": 0, "fat": 6.5},
    {"name": "Café", "category": "bebida", "portion": 40, "kcal": 2, "protein": 0.2, "carbs": 0.3, "fat": 0},
    {"name": "Café com leite", "category": "bebida", "portion": 150, "kcal": 44, "protein": 2.6, "carbs": 4, "fat": 2.2},
    {"name": "Chá", "category": "bebida", "portion": 200, "kcal": 1, "protein": 0, "carbs": 0.2, "fat": 0},
]


def norm(s: str) -> str:
    return unicodedata.normalize("NFD", re.sub(r"[^\w\s]", " ", s or "").lower()).encode("ascii", "ignore").decode()


def fetch_json(url: str, tries: int = 3):
    for attempt in range(tries):
        try:
            req = Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"    retry em {wait}s ({str(e)[:60]})", flush=True)
            time.sleep(wait)
    return None


def done_keys() -> set[str]:
    return {l.strip() for l in PROGRESS.read_text().splitlines() if l.strip()} if PROGRESS.exists() else set()


def mark_done(k: str) -> None:
    with PROGRESS.open("a") as f:
        f.write(k + "\n")


def append_raw(product: dict) -> None:
    with RAW.open("a", encoding="utf-8") as f:
        f.write(json.dumps(product, ensure_ascii=False) + "\n")


def extract(p: dict) -> dict | None:
    """Produto OFF -> registo da nossa base (ou None se incompleto)."""
    n = p.get("nutriments") or {}
    kcal = n.get("energy-kcal_100g")
    prot = n.get("proteins_100g")
    carbs = n.get("carbohydrates_100g")
    fat = n.get("fat_100g")
    if None in (kcal, prot, carbs, fat):
        return None
    name = p.get("product_name_pt") or p.get("product_name") or p.get("generic_name") or ""
    name = name.strip()
    if len(name) < 3:
        return None
    serving = p.get("serving_size") or ""
    m = re.search(r"([\d.,]+)\s*(g|ml)", serving)
    portion = None
    if m:
        try:
            portion = round(float(m.group(1).replace(",", ".")))
        except ValueError:
            pass
    return {
        "name": name[:80],
        "brand": (p.get("brands") or "").split(",")[0].strip()[:40],
        "category": (p.get("categories") or "").split(",")[0].strip().split(":")[-1][:30],
        "kcal": round(float(kcal), 1),
        "protein": round(float(prot), 1),
        "carbs": round(float(carbs), 1),
        "fat": round(float(fat), 1),
        "portion": portion or 100,
        "source": "openfoodfacts",
    }


def queries() -> list[str]:
    qs = []
    for b in BRANDS:
        qs.append(f"brand:{b}:1")
    for t in GENERIC_TERMS:
        qs.append(f"term:{t}:1")
        qs.append(f"term:{t}:2")
    return qs


def run_off(done: set[str], budget_end: float, args) -> None:
    for qkey in queries():
        if qkey in done:
            continue
        if time.time() > budget_end:
            print("PAUSA (orçamento) — rerun para continuar", flush=True)
            sys.exit(2)
        kind, term, page = qkey.split(":", 2) if qkey.startswith("term") else (qkey.split(":")[0], ":".join(qkey.split(":")[1:-1]), qkey.split(":")[-1])
        url = BASE.format(quote(term), page)
        print(f"[OFF] {term} pág {page}...", flush=True)
        d = fetch_json(url)
        mark_done(qkey)
        if not d:
            continue
        products = d.get("products") or []
        kept = 0
        for p in products:
            rec = extract(p)
            if rec:
                append_raw(rec)
                kept += 1
        print(f"  {len(products)} produtos, {kept} com macros completos", flush=True)
        time.sleep(args.delay)


def merge() -> None:
    from app.services.food_db import FOODS as CURRENT

    foods: dict[str, dict] = {}
    for f in CURRENT:
        rec = {
            "name": f["name"], "brand": "", "category": "genérico",
            "kcal": f["kcal"], "protein": f["protein"], "carbs": f["carbs"], "fat": f["fat"],
            "portion": f["portion"], "source": "generico",
        }
        foods[norm(f["name"])] = rec
    for c in CURATED:
        foods[norm(c["name"])] = {**c, "brand": "", "source": "curado"}
    if RAW.exists():
        for line in RAW.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = norm(f"{rec['brand']} {rec['name']}")
            if key not in foods:
                foods[key] = rec
    out = sorted(foods.values(), key=lambda r: norm(r["name"]))
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"foods_pt.json: {len(out)} alimentos "
          f"({sum(1 for r in out if r['source']=='openfoodfacts')} de marcas)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-seconds", type=float, default=200.0)
    ap.add_argument("--delay", type=float, default=4.0, help="segundos entre queries (rate-limit OFF)")
    args = ap.parse_args()

    done = done_keys()
    remaining = [q for q in queries() if q not in done]
    print(f"queries feitas: {len(done)} | restantes: {len(remaining)}", flush=True)
    if remaining:
        run_off(done, time.time() + args.max_seconds, args)
    merge()


if __name__ == "__main__":
    sys.exit(main())
