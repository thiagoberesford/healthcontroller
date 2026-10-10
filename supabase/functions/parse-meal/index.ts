// Edge Function: parser de refeições com LLM (Mistral) + lookup local + Open Food Facts.
// O site chama via supabase.functions.invoke (JWT do utilizador — as consultas
// ao Supabase respeitam o RLS; NUNCA service key).
// Requer o secret MISTRAL_API_KEY (dashboard: Edge Functions -> Secrets).
// Deploy (dashboard): Edge Functions -> "parse-meal" -> colar este ficheiro.

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OFF_UA = "HealthController/1.0 (uso pessoal; github.com/thiagoberesford/healthcontroller)";
const OFF_TIMEOUT_MS = 3000;
const MAX_OFF_CALLS = 3;

/* ---------- FatSecret (OAuth 1.0a HMAC-SHA1; CONSUMER_KEY/SECRET em secrets) ---------- */
const FS_CLIENT_ID =
  Deno.env.get("FATSECRET_CONSUMER_KEY") ?? Deno.env.get("FATSECRET_CLIENT_ID") ?? "";
const FS_CLIENT_SECRET =
  Deno.env.get("FATSECRET_CONSUMER_SECRET") ?? Deno.env.get("FATSECRET_CLIENT_SECRET") ?? "";
const fsDebug: string[] = [];
const offDebug: string[] = [];

/* percent-encoding RFC 3986 (encodeURIComponent deixa !'()* por codificar) */
const enc3986 = (s: string) =>
  encodeURIComponent(String(s)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

async function hmacSha1Base64(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* chamada assinada à REST API (OAuth 1.0a "signed request") */
async function fsCall(params: Record<string, string | number>): Promise<Record<string, unknown> | null> {
  if (!FS_CLIENT_ID || !FS_CLIENT_SECRET) {
    fsDebug.push("sem FATSECRET_CONSUMER_KEY/SECRET nos secrets");
    return null;
  }
  const url = "https://platform.fatsecret.com/rest/server.api";
  const p: Record<string, string> = {
    oauth_consumer_key: FS_CLIENT_ID,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    format: "json",
  };
  for (const [k, v] of Object.entries(params)) p[k] = String(v);
  const paramString = Object.keys(p).sort()
    .map((k) => `${enc3986(k)}=${enc3986(p[k])}`)
    .join("&");
  const baseStr = `POST&${enc3986(url)}&${enc3986(paramString)}`;
  const sig = await hmacSha1Base64(`${FS_CLIENT_SECRET}&`, baseStr);
  const body = new URLSearchParams({ ...p, oauth_signature: sig }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      fsDebug.push(`HTTP ${r.status}`);
      return null;
    }
    const doc = await r.json();
    if (doc?.error) {
      fsDebug.push(`API error: ${JSON.stringify(doc.error).slice(0, 80)}`);
      return null;
    }
    return doc;
  } catch (e) {
    clearTimeout(t);
    fsDebug.push(`erro: ${String(e).slice(0, 60)}`);
    return null;
  }
}

interface FsResult {
  kcal: number; protein: number; carbs: number; fat: number;
  brand: string; name: string; brandMatch: boolean;
}

async function fsSearch(term: string, brand: string | null): Promise<FsResult | null> {
  if (!FS_CLIENT_ID || !FS_CLIENT_SECRET) return null;
  const doc = await fsCall({
    method: "foods.search",
    search_expression: term,
    max_results: 20,
    region: "PT",
  });
  if (!doc) return null;
  const foods = (doc?.foods?.food ?? []) as Record<string, string>[];
  const norm = (x: unknown) =>
    String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const grab = (d: string, re: RegExp[]) => {
    for (const r of re) {
      const m = (d.match(r) ?? [])[1];
      if (m) return parseFloat(m);
    }
    return 0;
  };
  const brandNorm = norm(brand);
  // relevância: o candidato tem de partilhar pelo menos uma palavra
  // significativa (>=4 chars) com o termo — a busca difusa do FatSecret
  // devolve lixo ("hamburger vegan" -> "Herbes de Provence")
  const termWords = new Set(
    norm(term).split(/\s+/).filter((w) => w.length >= 4),
  );
  const cands: FsResult[] = [];
  for (const f of foods) {
    const d = f.food_description ?? "";
    if (!/Per 100g|Por 100g/i.test(d)) continue;
    const nameNorm = norm(`${f.food_name ?? ""} ${f.brand_name ?? ""}`);
    const relevant =
      (!!brand && norm(f.brand_name).includes(brandNorm)) ||
      nameNorm.split(/\s+/).some((w) => termWords.has(w));
    if (!relevant) continue;
    const kcal = grab(d, [
      /Calories: ([\d.]+)\s*kcal/i,
      /Calorias: ([\d.]+)\s*kcal/i,
      /Calorias: ([\d.]+)\s*Cal/i,
    ]);
    if (kcal <= 0) continue;
    cands.push({
      kcal: Math.round(kcal),
      protein: grab(d, [/Protein: ([\d.]+)g/i, /Prote[ií]nas?: ([\d.]+)g/i]),
      carbs: grab(d, [/Carbs: ([\d.]+)g/i, /Carboidratos: ([\d.]+)g/i, /Hidratos?: ([\d.]+)g/i]),
      fat: grab(d, [/Fat: ([\d.]+)g/i, /Gordura[s]? ?: ([\d.]+)g/i]),
      brand: String(f.brand_name ?? "").trim(),
      name: String(f.food_name ?? "").slice(0, 60),
      brandMatch: !!brand && norm(f.brand_name).includes(brandNorm),
    });
  }
  fsDebug.push(
    `search "${term}": ${foods.length} resultados, ${cands.length} relevantes com 100g`,
  );
  const best = cands.sort((a, b) =>
    (b.brandMatch ? 1 : 0) - (a.brandMatch ? 1 : 0) ||
    (b.brand ? 1 : 0) - (a.brand ? 1 : 0),
  )[0] ?? null;
  return best;
}

const SYSTEM = `És um parser nutricional rigoroso para português europeu. Extrais os alimentos de uma refeição descrita em linguagem natural.

REGRAS DE UNIDADES (a parte mais importante — NUNCA as convertes):
- NUNCA convertes unidades: o que vem em ml fica ml, o que vem em gramas fica g, o que vem em unidades (fatias, ovos, bananas) fica "unidade".
- NÃO convertes volume em peso: "um galão de 250ml" fica quantity=250, unit="ml". "100 gramas de arroz" fica quantity=100, unit="g".
- Quantidade sem unidade: deduz pelo tipo do alimento — líquidos (leite, café, sopa, sumo, galão, chá) em ml; sólidos em g; contáveis (ovos, bananas, fatias) em "unidade".
- Para unit="unidade", também calculas os gramas totais (quantity × peso unitário): fatia de queijo 15g | fatia de pão 30g | ovo 55g | colher de sopa 15g | banana 120g | maçã 180g.
  Exemplo: "3 fatias de queijo" → quantity=3, unit="unidade", grams=45. "2 ovos" → quantity=2, unit="unidade", grams=110.
- "tosta de queijo (3 fatias de queijo e duas de pão)" são DOIS itens: queijo (3 unidade, 45g) e pão (2 unidade, 60g).

REGRAS DE MARCA E PESQUISA:
- Se houver marca ("iogurte da Mimosa", "falafel da Sementes do Mundo do Continente"), extrais: brand="Mimosa"/"Sementes do Mundo", store_hint="Continente" quando mencionada a loja.
- product_search = o melhor termo de pesquisa em português para encontrar o produto numa base de alimentos (ex.: para "comi uns falaféis da Sementes do Mundo do Continente" → "falafel"). Sem marca, product_search pode ficar igual ao label.

VALORES NUTRICIONAIS (por 100 g/ml):
- kcal_100g, protein_100g, carbs_100g, fat_100g: valores por 100g segundo tabelas nutricionais (para líquidos, por 100ml — numericamente quase igual).
- ANTES de responder, verifica cada item: a unidade corresponde ao que foi escrito? as gramas correspondem à descrição?

EXEMPLOS:
- "comi um galão de 250ml e um tostas" → [{"label":"galão","quantity":250,"unit":"ml","grams":250,...}, ...]
- "uma bifa de 200 gramas e uma taça de sopa" → bife quantity=200 unit="g"; sopa quantity=300 unit="ml"
- "comi o iogurte natural da Mimosa" → [{"label":"iogurte natural","brand":"Mimosa","product_search":"iogurte natural mimosa","quantity":125,"unit":"g","grams":125,...}]

Responde APENAS com JSON válido, sem markdown:
{"items": [{"label": "…", "brand": null, "store_hint": null, "product_search": "…", "quantity": 250, "unit": "ml", "grams": 250, "kcal_100g": 43, "protein_100g": 2.4, "carbs_100g": 5, "fat_100g": 1.5}]}
Lista vazia se não houver alimentos.`;

// heurística de líquidos para validação de unidades
const LIQUID_RE =
  /(leite|café|galão|chá|sopa|caldo|sumo|suco|água|refresco|cerveja|vinho|bebida|iogurte líquido|néctar|leite)/i;

const ALLOWED_ORIGINS = [
  "https://thiagoberesford.github.io",
  "http://localhost:5173",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, req: Request, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

/* ---------- lookup na base foods (PostgREST com o JWT do user; RLS aplica) ---------- */

async function localFoodSearch(
  auth: string,
  term: string,
  brand: string | null,
): Promise<Record<string, unknown> | null> {
  if (!SUPABASE_URL || !term) return null;
  const q = new URLSearchParams({
    select: "id,name,brand,category,kcal,protein,carbs,fat,portion,source",
    name: `ilike.*${term}*`,
    limit: "10",
  });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/foods?${q}`, {
      headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    const rows: Record<string, unknown>[] = await r.json();
    if (!rows?.length) return null;
    const norm = (x: unknown) =>
      String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (brand) {
      const exact = rows.find((f) => norm(f.brand) === norm(brand)) ||
        rows.find((f) => norm(String(f.brand ?? "")).includes(norm(brand)));
      if (exact) return exact;
    }
    return rows.find((f) => !f.brand) ?? rows[0];
  } catch {
    return null;
  }
}

async function upsertFood(auth: string, f: Record<string, unknown>): Promise<void> {
  if (!SUPABASE_URL) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/foods?on_conflict=id`, {
      method: "POST",
      headers: {
        Authorization: auth,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(f),
    });
  } catch {
    /* nunca quebrar o parse por causa do upsert */
  }
}

/* ---------- Open Food Facts ---------- */

const offCache = new Map<string, Record<string, unknown> | null>();

interface OffProduct {
  product_name?: string;
  brands?: string;
  countries?: string;
  serving_size?: string;
  nutriments?: Record<string, number>;
}

async function offSearch(
  term: string,
  brand: string | null,
): Promise<{ kcal: number; protein: number; carbs: number; fat: number; brand: string; name: string; brandMatch: boolean } | null> {
  const key = `${term.toLowerCase().trim()}|${(brand ?? "").toLowerCase()}`;
  if (offCache.has(key)) return offCache.get(key) ?? null;

  const norm = (x: unknown) =>
    String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
  const url = (host: string, t: string) =>
    `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(t)}` +
    `&json=1&page_size=20&fields=product_name,brands,countries,serving_size,nutriments`;

  try {
    // 1ª tentativa: produto + marca no pt.; fallback: termo no pt., depois world
    const attempts: Array<[string, string]> = brand
      ? [["pt.openfoodfacts.org", `${term} ${brand}`], ["pt.openfoodfacts.org", term], ["world.openfoodfacts.org", term]]
      : [["pt.openfoodfacts.org", term]];
    let products: OffProduct[] = [];
    for (const [host, t] of attempts) {
      if (products.length === 0 && offDebug.length > 0) {
        await new Promise((r) => setTimeout(r, 400)); // respeitar rate limit da OFF
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
      let r = await fetch(url(host, t), { headers: { "User-Agent": OFF_UA }, signal: ctrl.signal });
      clearTimeout(timer);
      if (r.status === 503) {
        // 503 costuma ser transitorio: uma retry curta
        await new Promise((res) => setTimeout(res, 500));
        const ctrl2 = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), OFF_TIMEOUT_MS);
        r = await fetch(url(host, t), { headers: { "User-Agent": OFF_UA }, signal: ctrl2.signal });
        clearTimeout(timer2);
      }
      if (!r.ok) {
        offDebug.push(`"${t}" @${host.split(".")[0]}: HTTP ${r.status}`);
        continue;
      }
      const body = await r.json();
      products = ((body?.products ?? []) as OffProduct[]).filter(
        (p) => num(p.nutriments?.["energy-kcal_100g"]) > 0,
      );
      offDebug.push(`"${t}" @${host.split(".")[0]}: ${products.length} resultados`);
      if (products.length) break;
    }
    if (!products.length) {
      offCache.set(key, null);
      return null;
    }

    const firstTerm = norm(term).split(" ")[0] ?? "";
    const brandNorm = norm(brand);
    const best = products
      .map((p) => {
        const n = p.nutriments!;
        const pt = norm(p.countries).includes("portugal");
        const nameHit = norm(p.product_name).includes(firstTerm);
        const brandMatch = !!brand && norm(p.brands).includes(brandNorm);
        const complete =
          num(n["proteins_100g"]) > 0 && num(n["carbohydrates_100g"]) >= 0 && num(n["fat_100g"]) > 0;
        return {
          kcal: Math.round(num(n["energy-kcal_100g"])),
          protein: +num(n["proteins_100g"]).toFixed(1),
          carbs: +num(n["carbohydrates_100g"]).toFixed(1),
          fat: +num(n["fat_100g"]).toFixed(1),
          brand: String(p.brands ?? "").split(",")[0]?.trim() ?? "",
          name: String(p.product_name ?? "").slice(0, 60),
          brandMatch,
          score: (brandMatch ? 5 : 0) + (nameHit ? 2 : 0) + (pt ? 2 : 0) + (complete ? 1 : 0),
        };
      })
      .sort((a, b) => b.score - a.score)[0] ?? null;
    // com marca indicada mas sem produto dessa marca: devolver o genérico
    // com brandMatch=false (o caller marca needs_review para o user confirmar)
    offCache.set(key, best);
    return best;
  } catch {
    offCache.set(key, null);
    return null; // erros da OFF nunca quebram o parse
  }
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

/* ---------- main ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return json({ error: "não autenticado" }, req, 401);
  }
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) {
    return json({ error: "MISTRAL_API_KEY não configurado (Edge Function secrets)" }, req, 500);
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 500);
  } catch {
    return json({ error: "body inválido" }, req, 400);
  }
  if (!text.trim()) return json({ error: "texto em falta" }, req, 400);

  let mistral: Response;
  try {
    mistral = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
    });
  } catch (e) {
    return json({ error: `mistral indisponível: ${e}` }, req, 502);
  }
  if (!mistral.ok) {
    const detail = await mistral.text().catch(() => "");
    return json({ error: `mistral ${mistral.status}: ${detail.slice(0, 200)}` }, req, 502);
  }

  const data = await mistral.json();
  let content: string = data?.choices?.[0]?.message?.content ?? "";
  content = content.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();

  let raw: unknown[] = [];
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    raw = JSON.parse(content.slice(start, end + 1)).items ?? [];
  } catch {
    raw = [];
  }

  let offCalls = 0;
  const items = [];
  for (const it of (Array.isArray(raw) ? raw : []).slice(0, 20)) {
    const p = it as Record<string, unknown>;
    const label = String(p?.label ?? "").slice(0, 80);
    const brand = p?.brand ? String(p.brand).slice(0, 40) : null;
    const storeHint = p?.store_hint ? String(p.store_hint).slice(0, 40) : null;
    let unit = ["g", "ml", "unidade"].includes(String(p?.unit)) ? String(p.unit) : "g";
    let quantity = Math.max(0, Math.round(Number(p?.quantity) || 0));
    let grams = Math.max(0, Math.round(Number(p?.grams) || 0));
    if (!label || (quantity <= 0 && grams <= 0)) continue;
    if (unit === "unidade" && grams > 0 && quantity <= 0) quantity = 1;
    if (unit !== "unidade" && quantity > 0) grams = quantity;

    // ---- lookup: base local primeiro; OFF quando há marca ----
    let term = String(p?.product_search || label).slice(0, 60);
    // termo de pesquisa limpo: a marca nunca entra no termo (vem à parte);
    // "falafel Iglo" + brand="Iglo" -> termo "falafel"
    const normFn = (x: unknown) =>
      String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (brand) {
      const brandWords = new Set(normFn(brand).split(/\s+/).filter(Boolean));
      const cleaned = term.split(/\s+/).filter((w) => !brandWords.has(normFn(w))).join(" ").trim();
      if (cleaned) term = cleaned;
    }
    let origin = "estimate";
    let needsReview = false;
    let macros = {
      kcal_100: Math.max(0, Number(p?.kcal_100g) || 0),
      protein_100: Math.max(0, Number(p?.protein_100g) || 0),
      carbs_100: Math.max(0, Number(p?.carbs_100g) || 0),
      fat_100: Math.max(0, Number(p?.fat_100g) || 0),
    };
    let foodId: string | null = null;
    let foodName = label;

    const local = await localFoodSearch(auth, term, brand);
    if (local) {
      origin = "local";
      macros = {
        kcal_100: Number(local.kcal) || macros.kcal_100,
        protein_100: Number(local.protein) || 0,
        carbs_100: Number(local.carbs) || 0,
        fat_100: Number(local.fat) || 0,
      };
      foodId = String(local.id);
      foodName = local.brand ? `${local.name} (${local.brand})` : String(local.name);
    } else if (brand && offCalls < MAX_OFF_CALLS) {
      // só itens com marca vão à procura remota; FatSecret (PT) primeiro, OFF depois
      offCalls++;
      let remote: FsResult | null = null;
      let remoteSource: "fatsecret" | "openfoodfacts" = "fatsecret";
      remote = await fsSearch(term, brand);
      if (!remote) {
        const off = await offSearch(term, brand);
        if (off) {
          remote = {
            kcal: off.kcal, protein: off.protein, carbs: off.carbs, fat: off.fat,
            brand: off.brand, name: off.name, brandMatch: off.brandMatch,
          };
          remoteSource = "openfoodfacts";
        }
      }
      if (remote && remote.kcal > 0) {
        origin = remoteSource;
        macros = { kcal_100: remote.kcal, protein_100: remote.protein, carbs_100: remote.carbs, fat_100: remote.fat };
        foodName = remote.name || label;
        foodId = `off-${slug(`${remote.name} ${remote.brand}`)}`;
        needsReview = !remote.brandMatch; // produto genérico no lugar da marca pedida
        // enriquecer a base: próxima vez sai local (JWT do user; nunca service key)
        await upsertFood(auth, {
          id: foodId,
          name: (remote.name || label).slice(0, 60),
          brand: remote.brand || brand,
          category: storeHint ? `continente:${storeHint}` : "",
          kcal: remote.kcal,
          protein: remote.protein,
          carbs: remote.carbs,
          fat: remote.fat,
          portion: 100,
          source: remoteSource,
        });
      } else {
        needsReview = true; // marca indicada mas produto não encontrado
      }
    }

    // ---- validação de unidades pós-parse ----
    if (origin !== "estimate") {
      const looksLiquid = LIQUID_RE.test(foodName) || LIQUID_RE.test(label);
      if (unit === "g" && looksLiquid) unit = "ml";
      else if (unit === "ml" && !looksLiquid) {
        unit = "g";
        needsReview = true;
      }
    } else if (unit === "ml" && !LIQUID_RE.test(label)) {
      needsReview = true; // unidade suspeita sem match para validar
    }

    const g = unit === "unidade" ? grams : quantity;
    const scale = (v: number) => (g > 0 ? (v * g) / 100 : 0);
    items.push({
      label: foodName,
      brand,
      unit,
      quantity,
      grams: g,
      kcal: Math.round(scale(macros.kcal_100)),
      protein: +scale(macros.protein_100).toFixed(1),
      carbs: +scale(macros.carbs_100).toFixed(1),
      fat: +scale(macros.fat_100).toFixed(1),
      kcal_100: macros.kcal_100,
      protein_100: macros.protein_100,
      carbs_100: macros.carbs_100,
      fat_100: macros.fat_100,
      origin,
      needs_review: needsReview,
      food_id: foodId,
    });
  }

  return json({ items, _debug: { fatsecret: fsDebug, openfoodfacts: offDebug } }, req);
});
