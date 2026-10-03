/* Parser de refeição em linguagem natural (pt-PT).
   Base: foods do Supabase (1.5k+ produtos portugueses) via buildIndex;
   fallback para a lista FOODS embutida se nada for passado. */

export const FOODS = [
  { keys: ["iogurte grego", "grego"], name: "Iogurte grego", portion: 170, kcal: 97, protein: 9.0, carbs: 3.9, fat: 5.0 },
  { keys: ["iogurte"], name: "Iogurte natural", portion: 170, kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  { keys: ["laranja"], name: "Laranja", portion: 180, kcal: 47, protein: 0.9, carbs: 11.8, fat: 0.1 },
  { keys: ["banana"], name: "Banana", portion: 120, kcal: 98, protein: 1.3, carbs: 23.4, fat: 0.2 },
  { keys: ["maçã", "maca"], name: "Maçã", portion: 180, kcal: 56, protein: 0.3, carbs: 14.2, fat: 0.2 },
  { keys: ["pão integral", "pao integral"], name: "Pão integral", portion: 30, kcal: 240, protein: 10.0, carbs: 42.0, fat: 3.5 },
  { keys: ["pão", "pao"], name: "Pão de forma", portion: 30, kcal: 260, protein: 9.0, carbs: 50.0, fat: 3.0 },
  { keys: ["arroz"], name: "Arroz branco cozido", portion: 140, kcal: 128, protein: 2.5, carbs: 28.0, fat: 0.2 },
  { keys: ["frango", "peito de frango"], name: "Peito de frango grelhado", portion: 150, kcal: 163, protein: 31.0, carbs: 0.0, fat: 3.2 },
  { keys: ["bife", "carne"], name: "Carne bovina magra", portion: 150, kcal: 190, protein: 27.0, carbs: 0.0, fat: 9.0 },
  { keys: ["ovo", "ovos"], name: "Ovo de galinha", portion: 50, kcal: 143, protein: 13.0, carbs: 1.5, fat: 9.5 },
  { keys: ["leite"], name: "Leite integral", portion: 200, kcal: 64, protein: 3.2, carbs: 4.8, fat: 3.5 },
  { keys: ["café", "cafe"], name: "Café preto s/ açúcar", portion: 200, kcal: 2, protein: 0.1, carbs: 0.3, fat: 0.0 },
  { keys: ["queijo"], name: "Queijo flamengo", portion: 30, kcal: 330, protein: 24.0, carbs: 1.0, fat: 26.0 },
  { keys: ["aveia"], name: "Aveia em flocos", portion: 40, kcal: 394, protein: 13.9, carbs: 66.6, fat: 8.1 },
  { keys: ["batata doce"], name: "Batata doce cozida", portion: 150, kcal: 77, protein: 0.9, carbs: 18.4, fat: 0.1 },
  { keys: ["whey", "proteina"], name: "Whey protein", portion: 30, kcal: 380, protein: 78.0, carbs: 8.0, fat: 4.0 },
  { keys: ["salada", "alface", "tomate"], name: "Salada verde c/ tomate", portion: 120, kcal: 25, protein: 1.2, carbs: 4.6, fat: 0.2 },
  { keys: ["massa", "espaguete"], name: "Massa cozida", portion: 160, kcal: 158, protein: 5.4, carbs: 31.0, fat: 0.7 },
  { keys: ["pizza"], name: "Pizza", portion: 120, kcal: 260, protein: 11.0, carbs: 30.0, fat: 10.0 },
  { keys: ["chocolate"], name: "Chocolate ao leite", portion: 30, kcal: 535, protein: 7.6, carbs: 59.0, fat: 30.0 },
  { keys: ["mel"], name: "Mel", portion: 20, kcal: 304, protein: 0.3, carbs: 82.0, fat: 0.0 },
];

const UNITS = [
  { keys: ["grama", "gramas", "g"], grams: 1 },
  { keys: ["colher"], grams: 15 }, // fallback genérico
  { keys: ["colheres", "colherzinha", "colherzinhas"], grams: 15 },
  { keys: ["copo", "copos"], grams: 200 },
  { keys: ["xicara"], grams: 200 },
  { keys: ["fatia", "fatias"], grams: 30 },
  { keys: ["scoops", "scoop"], grams: 30 },
  { keys: ["prato", "pratos"], grams: 150 },
];

/* unidades multi-palavra: "colher(es) de sopa" (15g), "colher(es) de chá" (5g) */
function multiWordUnit(tokens, i) {
  const t = stem(norm(tokens[i]));
  if (t !== "colher" && t !== "colhere") return null;
  const next1 = tokens[i + 1];
  const next2 = tokens[i + 2];
  if (next1 === "de" && next2) {
    const n = norm(next2);
    if (n === "sopa") return { grams: 15, consumed: 3 };
    if (n === "cha" || n === "chá") return { grams: 5, consumed: 3 };
    if (next1 === "de") return { grams: 15, consumed: 2 }; // "colher de arroz"
  }
  return { grams: 15, consumed: 1 };
}

const NUM_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  meio: 0.5, meia: 0.5,
};

const STOP = new Set([
  "comi", "jantei", "almoei", "almocei", "tomei", "bebi", "com", "e", "de", "do", "da",
  "no", "na", "o", "a", "os", "as", "um", "uma", "que", "sabor", "sabores",
  "como", "repete", "repetir", "ex", "exemplo", "tenta", "por",
]);

export function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos ANTES de limpar pontuação (\w JS é ascii-only)
    .replace(/[^\w\s]/g, " ")
    .trim();
}

const stem = (t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

/* tokens ignoráveis dentro do nome do produto (iguais a STOP, "de", etc.) */
const nameTokens = (s) =>
  norm(s).split(/\s+/).map(stem).filter((t) => t && !STOP.has(t) && t.length > 1);

const tokMatch = (q, f) =>
  q === f || (q.length >= 4 && f.length >= 4 && Math.abs(q.length - f.length) <= 2 && (f.startsWith(q) || q.startsWith(f)));

/* ---------- índice invertido com pesos (TF-IDF-ish) ---------- */
let INDEX = null;

export function buildIndex(foods) {
  const list = foods && foods.length ? foods : FOODS.map((f) => ({ ...f, brand: "" }));
  const df = new Map();
  const entries = list.map((f) => {
    const toks = new Set([...nameTokens(f.name), ...nameTokens(f.brand)]);
    const brandToks = new Set(nameTokens(f.brand));
    for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
    return { f, toks, brandToks };
  });
  const N = entries.length || 1;
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));
  INDEX = { entries, idf, df, N };
  return INDEX;
}

/* idf "efetivo" de um token da query: o melhor token da base que casa
   (tokens desconhecidos ficam com o idf máximo — pesam contra o match) */
function queryIdf(q) {
  let best = 0;
  for (const t of INDEX.df.keys()) {
    if (tokMatch(q, t)) best = Math.max(best, INDEX.idf(t));
  }
  return best || Math.log(1 + INDEX.N);
}

function scorePhrase(queryToks) {
  let best = null;
  let bestScore = 0;
  let bestMatchedIdf = 0;
  let bestMatched = 0;
  let bestHead = false;
  for (const { f, toks, brandToks } of INDEX.entries) {
    let score = 0;
    let matched = 0;
    let matchedIdf = 0;
    let head = false;
    for (const q of queryToks) {
      for (const t of toks) {
        if (tokMatch(q, t)) {
          const w = INDEX.idf(t) * (brandToks.has(t) ? 1.3 : 1);
          score += w;
          matchedIdf += INDEX.idf(t);
          matched++;
          if (q === queryToks[0]) head = true;
          break;
        }
      }
    }
    if (matched) score += (matched / toks.size) * 0.8;
    if (head) score *= 1.5; // o head da query é prioridade
    if (score > bestScore) {
      bestScore = score;
      best = f;
      bestMatchedIdf = matchedIdf;
      bestMatched = matched;
      bestHead = head;
    }
  }
  return { food: best, score: bestScore, matchedIdf: bestMatchedIdf, matched: bestMatched, head: bestHead };
}

/* tira 'sem X' (negação) e calcula o candidato do segmento */
function bestCandidate(queryToksRaw) {
  const raw = queryToksRaw.filter(Boolean);
  const queryToks = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "sem") {
      i++;
      continue;
    }
    queryToks.push(raw[i]);
  }
  if (!queryToks.length) return null;
  const total = queryToks.reduce((s, q) => s + queryIdf(q), 0) || 1;
  const { food, matchedIdf, head } = scorePhrase(queryToks);
  if (!food || !head) return null;
  return { food, waste: (total - matchedIdf) / total };
}

function parseSegment(segment) {
  const tokens = segment.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { items: [], unknown: [] };
  const { qty, unitGrams, rest } = parseQtyUnit(tokens);
  const queryToks = toQueryToks(rest);
  if (!queryToks.length) return { items: [], unknown: [] };

  const cand = bestCandidate(queryToks);
  const asItem = (food) => {
    let grams;
    if (unitGrams && qty !== null) grams = unitGrams * qty;
    else if (unitGrams) grams = unitGrams;
    else grams = (food.portion || 100) * (qty || 1);
    return {
      items: [{ food, grams: Math.round(grams), label: food.brand && food.brand !== "Meu registo" ? `${food.name} (${food.brand})` : food.name }],
      unknown: [],
    };
  };

  // match "limpo": o head casou e sobra pouco peso informativo -> 1 alimento
  if (cand && cand.waste <= 0.3) return asItem(cand.food);

  // senão: dividir em " com " / " e " e tentar cada parte
  if (/\s(?:com|e)\s/.test(segment)) {
    const parts = segment.split(/\s+com\s+|\s+e\s+/);
    const out = { items: [], unknown: [] };
    for (const p of parts) {
      const r = parseSegment(p.trim());
      out.items.push(...r.items);
      out.unknown.push(...r.unknown);
    }
    if (out.items.length) return out;
  }

  // sem separadores: aceita o melhor match com head casado (parcial)
  if (cand) return asItem(cand.food);
  return { items: [], unknown: rest.filter((t) => !STOP.has(norm(t)) && t.length > 2) };
}

/* extrai qty/unidade do início dos tokens; devolve {qty, grams, rest} */
function parseQtyUnit(tokens) {
  let i = 0;
  let qty = null;
  let unitGrams = null;
  const t0 = tokens[i];
  if (t0 && /^\d+([.,]\d+)?(g|gr|kg|ml)$/.test(t0)) {
    // quantidade fundida: "200g", "1kg", "150ml"
    const n = parseFloat(t0.replace(",", "."));
    const unit = t0.replace(/[\d.,]+/, "");
    qty = 1;
    unitGrams = unit === "kg" ? n * 1000 : n;
    i++;
  } else if (t0 && /^\d+([.,]\d+)?$/.test(t0)) {
    qty = parseFloat(t0.replace(",", "."));
    i++;
  } else if (t0 && NUM_WORDS[norm(t0)] !== undefined) {
    qty = NUM_WORDS[norm(t0)];
    i++;
  }
  if (tokens[i] === "de") i++;
  if (tokens[i]) {
    const t = stem(norm(tokens[i]));
    if (t === "colher" || t === "colhere" || t === "colherzinha" || t === "colherzinhas") {
      const u = multiWordUnit(tokens, i);
      unitGrams = u.grams;
      i += u.consumed;
      if (tokens[i] === "de") i++;
    } else {
      const unit = UNITS.find((u) => u.keys.some((k) => stem(norm(k)) === t));
      if (unit) {
        unitGrams = unit.grams;
        i++;
        if (tokens[i] === "de") i++;
      }
    }
  }
  return { qty, unitGrams, rest: tokens.slice(i) };
}

const toQueryToks = (tokens) =>
  tokens.map((t) => stem(norm(t))).filter((t) => t && !STOP.has(t) && t.length > 1);

let _lastFoodsRef = null;

/* Ancorar um rótulo (ex.: vindo do LLM) ao alimento real da base.
   Mais tolerante que o parser (aceita até ~45% de peso residual). */
export function matchFoodLabel(label, foods) {
  if (!INDEX || foods !== _lastFoodsRef) {
    buildIndex(foods);
    _lastFoodsRef = foods || null;
  }
  const queryToks = toQueryToks(String(label || "").split(/\s+/));
  if (!queryToks.length) return null;
  const cand = bestCandidate(queryToks);
  return cand && cand.waste <= 0.45 ? cand.food : null;
}

export function parseMealLocal(text, foods) {
  // só reconstrói o índice se a base mudou (evita rebuild de 2k alimentos a cada chamada)
  if (!INDEX || foods !== _lastFoodsRef) {
    buildIndex(foods);
    _lastFoodsRef = foods || null;
  }
  const segments = text
    .toLowerCase()
    .split(/[,;()]+/)
    .flatMap((s) => (s.trim() ? [s.trim()] : []))
    .filter(Boolean);
  const items = [];
  const unknown = [];
  for (const seg of segments) {
    const r = parseSegment(seg);
    items.push(...r.items);
    unknown.push(...r.unknown);
  }
  return { items, unknown };
}

/* aceita {food, grams} (do matcher) ou items já com macros (lite) */
export const macrosOf = (p) =>
  p.food
    ? {
        kcal: Math.round((p.food.kcal * p.grams) / 100),
        protein: +((p.food.protein * p.grams) / 100).toFixed(1),
        carbs: +((p.food.carbs * p.grams) / 100).toFixed(1),
        fat: +((p.food.fat * p.grams) / 100).toFixed(1),
      }
    : {
        kcal: Math.round(p.kcal || 0),
        protein: +(p.protein || 0).toFixed(1),
        carbs: +(p.carbs || 0).toFixed(1),
        fat: +(p.fat || 0).toFixed(1),
      };

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
