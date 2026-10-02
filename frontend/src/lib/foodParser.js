/* Parser de refeição em linguagem natural (pt-BR) — versão local (sem backend).
   Espelha backend/app/services/food_db.py. */

export const FOODS = [
  { keys: ["iogurte grego", "grego"], name: "Iogurte grego", portion: 170, kcal: 97, protein: 9.0, carbs: 3.9, fat: 5.0 },
  { keys: ["iogurte"], name: "Iogurte natural", portion: 170, kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  { keys: ["laranja"], name: "Laranja", portion: 180, kcal: 47, protein: 0.9, carbs: 11.8, fat: 0.1 },
  { keys: ["banana"], name: "Banana", portion: 120, kcal: 98, protein: 1.3, carbs: 23.4, fat: 0.2 },
  { keys: ["maçã", "maca"], name: "Maçã", portion: 180, kcal: 56, protein: 0.3, carbs: 14.2, fat: 0.2 },
  { keys: ["pão integral", "pao integral"], name: "Pão integral", portion: 30, kcal: 240, protein: 10.0, carbs: 42.0, fat: 3.5 },
  { keys: ["pão", "pao"], name: "Pão de forma", portion: 30, kcal: 260, protein: 9.0, carbs: 50.0, fat: 3.0 },
  { keys: ["arroz integral"], name: "Arroz integral cozido", portion: 140, kcal: 124, protein: 2.6, carbs: 25.8, fat: 1.0 },
  { keys: ["arroz"], name: "Arroz branco cozido", portion: 140, kcal: 128, protein: 2.5, carbs: 28.0, fat: 0.2 },
  { keys: ["frango", "peito de frango"], name: "Peito de frango grelhado", portion: 150, kcal: 163, protein: 31.0, carbs: 0.0, fat: 3.2 },
  { keys: ["carne", "patinho", "maminha", "bife"], name: "Carne bovina magra", portion: 150, kcal: 190, protein: 27.0, carbs: 0.0, fat: 9.0 },
  { keys: ["ovo", "ovos"], name: "Ovo de galinha", portion: 50, kcal: 143, protein: 13.0, carbs: 1.5, fat: 9.5 },
  { keys: ["feijão", "feijao"], name: "Feijão carioca cozido", portion: 140, kcal: 76, protein: 4.8, carbs: 13.6, fat: 0.5 },
  { keys: ["leite"], name: "Leite integral", portion: 200, kcal: 64, protein: 3.2, carbs: 4.8, fat: 3.5 },
  { keys: ["café", "cafe"], name: "Café preto s/ açúcar", portion: 200, kcal: 2, protein: 0.1, carbs: 0.3, fat: 0.0 },
  { keys: ["queijo", "mussarela"], name: "Queijo mussarela", portion: 30, kcal: 280, protein: 22.0, carbs: 3.0, fat: 21.0 },
  { keys: ["aveia"], name: "Aveia em flocos", portion: 40, kcal: 394, protein: 13.9, carbs: 66.6, fat: 8.1 },
  { keys: ["batata doce"], name: "Batata doce cozida", portion: 150, kcal: 77, protein: 0.9, carbs: 18.4, fat: 0.1 },
  { keys: ["batata"], name: "Batata inglesa cozida", portion: 150, kcal: 82, protein: 1.9, carbs: 18.1, fat: 0.1 },
  { keys: ["whey", "proteína", "proteina"], name: "Whey protein", portion: 30, kcal: 380, protein: 78.0, carbs: 8.0, fat: 4.0 },
  { keys: ["salada", "alface", "tomate"], name: "Salada verde c/ tomate", portion: 120, kcal: 25, protein: 1.2, carbs: 4.6, fat: 0.2 },
  { keys: ["macarrão", "macarrao", "espaguete", "massa"], name: "Macarrão cozido", portion: 160, kcal: 158, protein: 5.4, carbs: 31.0, fat: 0.7 },
  { keys: ["peixe", "tilápia", "tilapia", "salmão", "salmao"], name: "Peixe grelhado", portion: 150, kcal: 165, protein: 26.0, carbs: 0.0, fat: 6.0 },
  { keys: ["tapioca"], name: "Tapioca", portion: 60, kcal: 240, protein: 0.4, carbs: 58.0, fat: 0.2 },
  { keys: ["cappuccino"], name: "Cappuccino c/ leite", portion: 240, kcal: 65, protein: 3.4, carbs: 6.4, fat: 2.8 },
  { keys: ["pizza"], name: "Pizza mussarela", portion: 120, kcal: 260, protein: 11.0, carbs: 30.0, fat: 10.0 },
  { keys: ["chocolate"], name: "Chocolate ao leite", portion: 30, kcal: 535, protein: 7.6, carbs: 59.0, fat: 30.0 },
  { keys: ["castanha", "castanhas", "nozes", "amêndoa", "amendoa"], name: "Castanhas/nozes", portion: 30, kcal: 600, protein: 18.0, carbs: 12.0, fat: 54.0 },
  { keys: ["mel"], name: "Mel", portion: 20, kcal: 304, protein: 0.3, carbs: 82.0, fat: 0.0 },
  { keys: ["manteiga de amendoim", "manteiga de amêndoa", "pasta de amendoim"], name: "Manteiga de amendoim", portion: 30, kcal: 590, protein: 24.0, carbs: 20.0, fat: 48.0 },
];

const UNITS = [
  { keys: ["grama", "gramas", "g"], grams: 1 },
  { keys: ["colher de sopa", "colher"], grams: 15 },
  { keys: ["colher de chá", "colherzinha"], grams: 5 },
  { keys: ["copo", "copos"], grams: 200 },
  { keys: ["xicara", "xícara", "xicaras", "xícaras"], grams: 200 },
  { keys: ["fatia", "fatias"], grams: 30 },
  { keys: ["scoops", "scoop"], grams: 30 },
  { keys: ["prato", "pratos"], grams: 150 },
];

const NUM_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
  meio: 0.5, meia: 0.5,
};

const STOP = new Set(["comi", "jantei", "almocei", "tomei", "bebi", "com", "e", "de", "no", "na", "o", "a", "um", "uma", "que"]);

export function norm(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findFood(phrase) {
  const p = norm(phrase);
  for (const f of FOODS) if (f.keys.some((k) => norm(k) === p)) return f;
  const stripped = p.replace(/^(o|a|os|as|um|uma|de)\s+/, "");
  for (const f of FOODS) if (f.keys.some((k) => norm(k) === stripped)) return f;
  return null;
}

export function parseMealLocal(text) {
  const tokens = text.toLowerCase().split(/[,;()]+|\s+/).map((t) => t.trim()).filter(Boolean);
  const items = [];
  const unknown = [];
  let i = 0;

  while (i < tokens.length) {
    let qty = null;
    const t0 = tokens[i];
    if (t0 && /^\d+([.,]\d+)?$/.test(t0)) {
      qty = parseFloat(t0.replace(",", "."));
      i++;
    } else if (t0 && NUM_WORDS[norm(t0)] !== undefined) {
      qty = NUM_WORDS[norm(t0)];
      i++;
    }

    let unitGrams = null;
    if (tokens[i] === "de") i++;
    if (tokens[i]) {
      const tokUnit = norm(tokens[i]);
      const unit = UNITS.find((u) => u.keys.some((k) => norm(k) === tokUnit));
      if (unit) {
        unitGrams = unit.grams;
        i++;
        if (tokens[i] === "de") i++;
      }
    }

    let matched = null;
    let consumed = 0;
    for (let span = 3; span >= 1 && !matched; span--) {
      const phrase = tokens.slice(i, i + span).join(" ");
      if (!phrase) continue;
      const f = findFood(phrase);
      if (f) {
        matched = f;
        consumed = span;
      }
    }

    if (matched) {
      let grams;
      if (unitGrams && qty !== null) grams = unitGrams * qty;
      else if (unitGrams) grams = unitGrams;
      else grams = matched.portion * (qty || 1);
      items.push({ food: matched, grams: Math.round(grams), label: matched.name });
      i += consumed;
    } else {
      const tok = tokens[i];
      if (tok && !STOP.has(tok) && tok.length > 2) unknown.push(tok);
      i++;
    }
  }
  return { items, unknown };
}

export const macrosOf = (p) => ({
  kcal: Math.round((p.food.kcal * p.grams) / 100),
  protein: +((p.food.protein * p.grams) / 100).toFixed(1),
  carbs: +((p.food.carbs * p.grams) / 100).toFixed(1),
  fat: +((p.food.fat * p.grams) / 100).toFixed(1),
});

export function computeTotals(items) {
  return items.reduce(
    (acc, p) => {
      const m = macrosOf(p);
      return {
        kcal: acc.kcal + m.kcal,
        protein: +(acc.protein + m.protein).toFixed(1),
        carbs: +(acc.carbs + m.carbs).toFixed(1),
        fat: +(acc.fat + m.fat).toFixed(1),
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
