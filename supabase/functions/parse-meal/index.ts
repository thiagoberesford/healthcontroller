// Edge Function: parser de refeições com LLM (Mistral).
// O site chama via supabase.functions.invoke (JWT do utilizador).
// Requer o secret MISTRAL_API_KEY (dashboard: Edge Functions -> Secrets).
// Deploy (dashboard): Edge Functions -> New function -> "parse-meal" -> colar este ficheiro.

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

const SYSTEM = `És um parser nutricional rigoroso para português europeu. Extrais os alimentos de uma refeição descrita em linguagem natural.

REGRAS DE QUANTIDADE (a parte mais importante):
- Quando a quantidade vem em UNIDADES (fatias, ovos, colheres), MULTIPLICA o peso unitário:
  fatia de queijo ~15g | fatia de pão ~30g | ovo ~55g | colher de sopa ~15g | colher de chá ~5g | banana ~120g | maçã ~180g
  Exemplo: "3 fatias de queijo" = 3 x 15g = 45g. "duas fatias de pão" = 2 x 30g = 60g.
- Quando a descrição já traz gramas/mililitros, usa-os EXATAMENTE ("250ml" -> 250g).
- Porções líquidas/típicas: café 30-40ml, galão 250ml (leite ~200ml + café ~50ml), iogurte 125g, copo de leite 200-250ml, sopa 300ml, bife/peito de frango 150g.
- Parentesis especificam componentes: "tosta de queijo (3 fatias de queijo e duas de pão)" sao DOIS itens: queijo 45g e pão 60g.

OUTRAS REGRAS:
- Cada alimento/bebida é um item separado (inclui guarnições).
- Se houver marca ("iogurte Continente"), inclui-a no label: "produto (marca)".
- kcal_100g, protein_100g, carbs_100g, fat_100g: valores por 100g segundo tabelas nutricionais.
- ANTES de responder, verifica cada item: as gramas correspondem mesmo à descrição?

Responde APENAS com JSON válido, sem markdown:
{"items": [{"label": "…", "grams": 45, "kcal_100g": 350, "protein_100g": 25, "carbs_100g": 1, "fat_100g": 27}]}
Lista vazia se não houver alimentos.`;

// só estas origens podem chamar a função (produção + dev local)
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
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

  let items: unknown[] = [];
  try {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    items = JSON.parse(content.slice(start, end + 1)).items ?? [];
  } catch {
    items = [];
  }

  const clean = (Array.isArray(items) ? items : []).slice(0, 20).map((it: Record<string, unknown>) => ({
    label: String(it?.label ?? "").slice(0, 80),
    grams: Math.max(0, Math.round(Number(it?.grams) || 0)),
    kcal_100g: Math.max(0, Number(it?.kcal_100g) || 0),
    protein_100g: Math.max(0, Number(it?.protein_100g) || 0),
    carbs_100g: Math.max(0, Number(it?.carbs_100g) || 0),
    fat_100g: Math.max(0, Number(it?.fat_100g) || 0),
  })).filter((it) => it.label && it.grams > 0);

  return json({ items: clean }, req);
});
