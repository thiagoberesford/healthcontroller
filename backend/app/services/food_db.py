"""Parser de refeição em linguagem natural (pt-PT).

Base: backend/data/foods_pt.json (2.2k alimentos: marcas PT do Open Food
Facts + genéricos + curadoria). Algoritmo espelha frontend/src/lib/foodParser.js:
segmentação + índice invertido TF-IDF-ish + cobertura de tokens >= 75%.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from functools import lru_cache

from app.models import MealItem, MealParseResponse

FOODS_PATH = __import__("pathlib").Path(__file__).resolve().parent.parent.parent / "data" / "foods_pt.json"

UNITS = [
    ({"grama", "gramas", "g"}, 1),
    ({"colher de sopa", "colher"}, 15),
    ({"colher de cha", "colherzinha"}, 5),
    ({"copo", "copos"}, 200),
    ({"xicara"}, 200),
    ({"fatia", "fatias"}, 30),
    ({"scoop", "scoops"}, 30),
    ({"prato", "pratos"}, 150),
]
UNIT_LOOKUP = {}
for keys, grams in UNITS:
    for k in keys:
        UNIT_LOOKUP[k] = grams

NUM_WORDS = {"um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "meio": 0.5, "meia": 0.5}

STOP = {
    "comi", "jantei", "almoei", "almocei", "tomei", "bebi", "com", "e", "de", "do", "da",
    "no", "na", "o", "a", "os", "as", "um", "uma", "que", "sabor", "sabores",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^\w\s]", " ", s).strip()


def stem(t: str) -> str:
    return t[:-1] if len(t) > 3 and t.endswith("s") else t


def name_tokens(s: str) -> set[str]:
    return {stem(t) for t in norm(s).split() if t and t not in STOP and len(t) > 1}


def tok_match(q: str, f: str) -> bool:
    return q == f or (
        len(q) >= 4 and len(f) >= 4 and abs(len(q) - len(f)) <= 2 and (f.startswith(q) or q.startswith(f))
    )


@lru_cache(maxsize=1)
def _index():
    foods = json.loads(FOODS_PATH.read_text(encoding="utf-8"))
    entries = []
    df: dict[str, int] = {}
    for f in foods:
        toks = name_tokens(f["name"]) | name_tokens(f.get("brand", ""))
        brand_toks = name_tokens(f.get("brand", ""))
        for t in toks:
            df[t] = df.get(t, 0) + 1
        entries.append((f, toks, brand_toks))
    n = len(entries) or 1

    def idf(t: str) -> float:
        return math.log(1 + n / (1 + df.get(t, 0)))

    return entries, idf


def _match_food(query_toks: list[str]):
    entries, idf = _index()
    best, best_score, best_matched = None, 0.0, 0
    for f, toks, brand_toks in entries:
        score = 0.0
        matched = 0
        for q in query_toks:
            for t in toks:
                if tok_match(q, t):
                    score += idf(t) * (1.3 if t in brand_toks else 1)
                    matched += 1
                    break
        if matched:
            score += (matched / len(toks)) * 0.8
            if score > best_score:
                best, best_score, best_matched = f, score, matched
    need = max(1, math.ceil(len(query_toks) * 0.75))
    return best if best and best_matched >= need else None


def _parse_qty_unit(tokens: list[str]):
    i, qty, unit_grams = 0, None, None
    t0 = tokens[0] if tokens else None
    m = re.fullmatch(r"(\d+(?:[.,]\d+)?)(g|gr|kg|ml)", t0 or "")
    if m:
        n = float(m.group(1).replace(",", "."))
        qty, unit_grams = 1, n * 1000 if m.group(2) == "kg" else n
        i = 1
    elif t0 and re.fullmatch(r"\d+([.,]\d+)?", t0):
        qty = float(t0.replace(",", "."))
        i = 1
    elif t0 and norm(t0) in NUM_WORDS:
        qty = NUM_WORDS[norm(t0)]
        i = 1
    if i < len(tokens) and tokens[i] == "de":
        i += 1
    if i < len(tokens):
        unit = UNIT_LOOKUP.get(stem(norm(tokens[i])))
        if unit:
            unit_grams = unit
            i += 1
            if i < len(tokens) and tokens[i] == "de":
                i += 1
    return qty, unit_grams, tokens[i:]


def _parse_segment(segment: str):
    tokens = [t for t in segment.split() if t]
    if not tokens:
        return [], []
    qty, unit_grams, rest = _parse_qty_unit(tokens)
    query_toks = [t for t in (stem(norm(t)) for t in rest) if t and t not in STOP and len(t) > 1]
    if not query_toks:
        return [], []
    food = _match_food(query_toks)
    if food:
        if unit_grams and qty is not None:
            grams = unit_grams * qty
        elif unit_grams:
            grams = unit_grams
        else:
            grams = (food.get("portion") or 100) * (qty or 1)
        grams = round(grams)
        brand = food.get("brand", "")
        label = f"{food['name']} ({brand})" if brand else food["name"]
        return [(food, grams, label)], []
    if re.search(r"\s(com|e)\s", segment):
        items, unknown = [], []
        for part in re.split(r"\s+com\s+|\s+e\s+", segment):
            a, b = _parse_segment(part.strip())
            items.extend(a)
            unknown.extend(b)
        if items:
            return items, unknown
    return [], [t for t in rest if norm(t) not in STOP and len(t) > 2]


def parse_meal(text: str) -> MealParseResponse:
    segments = [s.strip() for s in re.split(r"[,;()]+", text.lower()) if s.strip()]
    items: list[MealItem] = []
    unknown: list[str] = []
    for seg in segments:
        found, unk = _parse_segment(seg)
        for food, grams, label in found:
            items.append(
                MealItem(
                    label=label,
                    grams=grams,
                    kcal=round(food["kcal"] * grams / 100),
                    protein=round(food["protein"] * grams / 100, 1),
                    carbs=round(food["carbs"] * grams / 100, 1),
                    fat=round(food["fat"] * grams / 100, 1),
                )
            )
        unknown.extend(unk)

    totals = None
    if items:
        totals = MealItem(
            label="Total",
            grams=sum(x.grams for x in items),
            kcal=sum(x.kcal for x in items),
            protein=round(sum(x.protein for x in items), 1),
            carbs=round(sum(x.carbs for x in items), 1),
            fat=round(sum(x.fat for x in items), 1),
        )
    return MealParseResponse(items=items, unknown=unknown, totals=totals)
