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
    ({"colher"}, 15),
    ({"colheres", "colherzinha", "colherzinhas"}, 15),
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


def _unit_grams(tokens: list[str], i: int) -> tuple[int | None, int]:
    """Gramas da unidade em tokens[i] (suporta 'colher de sopa/cha')."""
    t = stem(norm(tokens[i]))
    if t in ("colher", "colhere", "colherzinha", "colherzinhas"):
        # "colher de sopa" (15g) / "colher de cha" (5g)
        if tokens[i + 1 : i + 2] == ["de"] and i + 2 < len(tokens):
            n2 = norm(tokens[i + 2])
            if n2 == "sopa":
                return 15, 3
            if n2 == "cha":
                return 5, 3
            if tokens[i + 1] == "de":
                return 15, 2  # "colher de arroz"
        return 15, 1
    g = UNIT_LOOKUP.get(t)
    return (g, 1) if g else (None, 0)

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


def _query_idf(q: str) -> float:
    entries, idf = _index()
    best = 0.0
    for _, toks, _ in entries:
        for t in toks:
            if tok_match(q, t):
                w = idf(t)
                if w > best:
                    best = w
    n = len(entries) or 1
    return best or math.log(1 + n)


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


def _best_candidate(query_toks):
    """Melhor alimento para os tokens; devolve (food, waste) ou None.
    waste = fração do peso informativo (idf) que o match não cobre."""
    entries, idf = _index()
    best, best_score = None, 0.0
    best_matched_idf, best_head = 0.0, False
    for f, toks, brand_toks in entries:
        score = 0.0
        matched_idf, matched, head = 0.0, 0, False
        for q in query_toks:
            for t in toks:
                if tok_match(q, t):
                    score += idf(t) * (1.3 if t in brand_toks else 1)
                    matched_idf += idf(t)
                    matched += 1
                    if q == query_toks[0]:
                        head = True
                    break
        if matched:
            score += (matched / len(toks)) * 0.8
            if head:
                score *= 1.5  # o head da query é prioridade
            if score > best_score:
                best, best_score = f, score
                best_matched_idf, best_head = matched_idf, head
    if best is None or not best_head:
        return None
    total = sum(_query_idf(q) for q in query_toks) or 1.0
    return best, (total - best_matched_idf) / total


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
        unit, consumed = _unit_grams(tokens, i)
        if unit:
            unit_grams = unit
            i += consumed
            if i < len(tokens) and tokens[i] == "de":
                i += 1
    return qty, unit_grams, tokens[i:]


def _parse_segment(segment: str):
    tokens = [t for t in segment.split() if t]
    if not tokens:
        return [], []
    qty, unit_grams, rest = _parse_qty_unit(tokens)
    toks = [t for t in (stem(norm(t)) for t in rest) if t and t not in STOP and len(t) > 1]
    # 'sem X' é negação: sai da query de match
    query_toks, skip = [], False
    for t in toks:
        if t == "sem":
            skip = True
            continue
        if skip:
            skip = False
            continue
        query_toks.append(t)
    if not query_toks:
        return [], []

    cand = _best_candidate(query_toks)

    def as_item(food):
        if unit_grams and qty is not None:
            grams = unit_grams * qty
        elif unit_grams:
            grams = unit_grams
        else:
            grams = (food.get("portion") or 100) * (qty or 1)
        brand = food.get("brand", "")
        label = f"{food['name']} ({brand})" if brand else food["name"]
        return [(food, round(grams), label)], []

    # match "limpo" (sobra <=30% do peso) -> 1 alimento; senão divide
    if cand is not None and cand[1] <= 0.3:
        return as_item(cand[0])
    if re.search(r"\s(com|e)\s", segment):
        items, unknown = [], []
        for part in re.split(r"\s+com\s+|\s+e\s+", segment):
            a, b = _parse_segment(part.strip())
            items.extend(a)
            unknown.extend(b)
        if items:
            return items, unknown
    if cand is not None:
        return as_item(cand[0])
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
