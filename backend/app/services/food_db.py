"""Base de alimentos (valores por 100g, aproximados TACO/USDA) e parser pt-BR."""
from __future__ import annotations

import re
import unicodedata

from app.models import MealItem, MealParseResponse

# keys: variações reconhecidas; portion: porção típica em gramas
FOODS: list[dict] = [
    {"keys": ["iogurte grego", "grego"], "name": "Iogurte grego", "portion": 170, "kcal": 97, "protein": 9.0, "carbs": 3.9, "fat": 5.0},
    {"keys": ["iogurte"], "name": "Iogurte natural", "portion": 170, "kcal": 61, "protein": 3.5, "carbs": 4.7, "fat": 3.3},
    {"keys": ["laranja"], "name": "Laranja", "portion": 180, "kcal": 47, "protein": 0.9, "carbs": 11.8, "fat": 0.1},
    {"keys": ["banana"], "name": "Banana", "portion": 120, "kcal": 98, "protein": 1.3, "carbs": 23.4, "fat": 0.2},
    {"keys": ["maca"], "name": "Maçã", "portion": 180, "kcal": 56, "protein": 0.3, "carbs": 14.2, "fat": 0.2},
    {"keys": ["pao integral"], "name": "Pão integral", "portion": 30, "kcal": 240, "protein": 10.0, "carbs": 42.0, "fat": 3.5},
    {"keys": ["pao"], "name": "Pão de forma", "portion": 30, "kcal": 260, "protein": 9.0, "carbs": 50.0, "fat": 3.0},
    {"keys": ["arroz integral"], "name": "Arroz integral cozido", "portion": 140, "kcal": 124, "protein": 2.6, "carbs": 25.8, "fat": 1.0},
    {"keys": ["arroz"], "name": "Arroz branco cozido", "portion": 140, "kcal": 128, "protein": 2.5, "carbs": 28.0, "fat": 0.2},
    {"keys": ["frango", "peito de frango"], "name": "Peito de frango grelhado", "portion": 150, "kcal": 163, "protein": 31.0, "carbs": 0.0, "fat": 3.2},
    {"keys": ["carne", "patinho", "bife"], "name": "Carne bovina magra", "portion": 150, "kcal": 190, "protein": 27.0, "carbs": 0.0, "fat": 9.0},
    {"keys": ["ovo", "ovos"], "name": "Ovo de galinha", "portion": 50, "kcal": 143, "protein": 13.0, "carbs": 1.5, "fat": 9.5},
    {"keys": ["feijao"], "name": "Feijão carioca cozido", "portion": 140, "kcal": 76, "protein": 4.8, "carbs": 13.6, "fat": 0.5},
    {"keys": ["leite"], "name": "Leite integral", "portion": 200, "kcal": 64, "protein": 3.2, "carbs": 4.8, "fat": 3.5},
    {"keys": ["cafe"], "name": "Café preto s/ açúcar", "portion": 200, "kcal": 2, "protein": 0.1, "carbs": 0.3, "fat": 0.0},
    {"keys": ["queijo", "mussarela"], "name": "Queijo mussarela", "portion": 30, "kcal": 280, "protein": 22.0, "carbs": 3.0, "fat": 21.0},
    {"keys": ["aveia"], "name": "Aveia em flocos", "portion": 40, "kcal": 394, "protein": 13.9, "carbs": 66.6, "fat": 8.1},
    {"keys": ["batata doce"], "name": "Batata doce cozida", "portion": 150, "kcal": 77, "protein": 0.9, "carbs": 18.4, "fat": 0.1},
    {"keys": ["batata"], "name": "Batata inglesa cozida", "portion": 150, "kcal": 82, "protein": 1.9, "carbs": 18.1, "fat": 0.1},
    {"keys": ["whey", "proteina"], "name": "Whey protein", "portion": 30, "kcal": 380, "protein": 78.0, "carbs": 8.0, "fat": 4.0},
    {"keys": ["salada", "alface", "tomate"], "name": "Salada verde c/ tomate", "portion": 120, "kcal": 25, "protein": 1.2, "carbs": 4.6, "fat": 0.2},
    {"keys": ["macarrao", "espaguete", "massa"], "name": "Macarrão cozido", "portion": 160, "kcal": 158, "protein": 5.4, "carbs": 31.0, "fat": 0.7},
    {"keys": ["peixe", "tilapia", "salmao"], "name": "Peixe grelhado", "portion": 150, "kcal": 165, "protein": 26.0, "carbs": 0.0, "fat": 6.0},
    {"keys": ["tapioca"], "name": "Tapioca", "portion": 60, "kcal": 240, "protein": 0.4, "carbs": 58.0, "fat": 0.2},
    {"keys": ["cappuccino"], "name": "Cappuccino c/ leite", "portion": 240, "kcal": 65, "protein": 3.4, "carbs": 6.4, "fat": 2.8},
    {"keys": ["pizza"], "name": "Pizza mussarela", "portion": 120, "kcal": 260, "protein": 11.0, "carbs": 30.0, "fat": 10.0},
    {"keys": ["chocolate"], "name": "Chocolate ao leite", "portion": 30, "kcal": 535, "protein": 7.6, "carbs": 59.0, "fat": 30.0},
    {"keys": ["castanha", "nozes", "amendoa"], "name": "Castanhas/nozes", "portion": 30, "kcal": 600, "protein": 18.0, "carbs": 12.0, "fat": 54.0},
    {"keys": ["mel"], "name": "Mel", "portion": 20, "kcal": 304, "protein": 0.3, "carbs": 82.0, "fat": 0.0},
    {"keys": ["manteiga de amendoim"], "name": "Manteiga de amendoim", "portion": 30, "kcal": 590, "protein": 24.0, "carbs": 20.0, "fat": 48.0},
]

UNITS = [
    {"keys": ["grama", "gramas", "g"], "grams": 1},
    {"keys": ["colher de sopa", "colher"], "grams": 15},
    {"keys": ["colher de cha", "colherzinha"], "grams": 5},
    {"keys": ["copo", "copos"], "grams": 200},
    {"keys": ["xicara", "xicaras"], "grams": 200},
    {"keys": ["fatia", "fatias"], "grams": 30},
    {"keys": ["scoop", "scoops"], "grams": 30},
    {"keys": ["prato", "pratos"], "grams": 150},
]

NUM_WORDS = {
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5,
    "meio": 0.5, "meia": 0.5,
}

STOP = {"comi", "jantei", "almocei", "tomei", "bebi", "com", "e", "de", "no", "na", "o", "a", "um", "uma", "que"}


def norm(s: str) -> str:
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().strip().lower()


def _find_food(phrase: str):
    for food in FOODS:
        for key in food["keys"]:
            if norm(key) == norm(phrase):
                return food
    # tolera artigos: "o pao" -> "pao"
    stripped = re.sub(r"^(o|a|os|as|um|uma|de)\s+", "", norm(phrase))
    for food in FOODS:
        for key in food["keys"]:
            if norm(key) == stripped:
                return food
    return None


def parse_meal(text: str) -> MealParseResponse:
    tokens = [t for t in re.split(r"[,;()]+|\s+", text.lower()) if t]
    items: list[MealItem] = []
    unknown: list[str] = []
    i = 0
    while i < len(tokens):
        qty = None
        t0 = tokens[i]
        if re.fullmatch(r"\d+([.,]\d+)?", t0):
            qty = float(t0.replace(",", "."))
            i += 1
        elif norm(t0) in NUM_WORDS:
            qty = NUM_WORDS[norm(t0)]
            i += 1

        unit_grams = None
        if i < len(tokens) and tokens[i] == "de":
            i += 1
        if i < len(tokens):
            tok_unit = norm(tokens[i])
            for u in UNITS:
                if tok_unit in {norm(k) for k in u["keys"]}:
                    unit_grams = u["grams"]
                    i += 1
                    if i < len(tokens) and tokens[i] == "de":
                        i += 1
                    break

        matched = None
        consumed = 0
        for span in (3, 2, 1):
            if i + span > len(tokens):
                continue
            phrase = " ".join(tokens[i : i + span])
            f = _find_food(phrase)
            if f:
                matched, consumed = f, span
                break

        if matched:
            if unit_grams and qty is not None:
                grams = unit_grams * qty
            elif unit_grams:
                grams = float(unit_grams)
            else:
                grams = float(matched["portion"]) * (qty or 1)
            grams = round(grams)
            items.append(
                MealItem(
                    label=matched["name"],
                    grams=grams,
                    kcal=round(matched["kcal"] * grams / 100),
                    protein=round(matched["protein"] * grams / 100, 1),
                    carbs=round(matched["carbs"] * grams / 100, 1),
                    fat=round(matched["fat"] * grams / 100, 1),
                )
            )
            i += consumed
        else:
            tok = tokens[i]
            if norm(tok) not in STOP and len(tok) > 2:
                unknown.append(tok)
            i += 1

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
