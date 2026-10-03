// Edge Function: parser de refeições com LLM (Mistral).
// O site chama via supabase.functions.invoke (JWT do utilizador).
// Requer o secret MISTRAL_API_KEY (dashboard: Edge Functions -> Secrets).
// Deploy (dashboard): Edge Functions -> New function -> "parse-meal" -> colar este ficheiro.

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";

const SYSTEM = `És um parser nutricional para português europeu. Recebes a descrição de uma refeição e devolves os alimentos.

Regras:
- Extrais CADA alimento/bebida mencionado (inclui guarnições: "com manteiga" são 2 itens).
- Estima as gramas por porções típicas portuguesas (iogurte 125g, fatia de pão 30g, café 40ml, copo de leite 200ml, bife 150g, colher de sopa 15g, sopa 300ml).
- Se houver marca ("iogurte Continente"), usa "produto (marca)" no label.
- Valores por 100g: kcal_100g, protein_100g, carbs_100g, fat_100g — estimas com base em tabelas nutricionais.
- Responde APENAS com JSON válido, sem markdown nem explicações:
{"items": [{"label": "…", "grams": 125, "kcal_100g": 70, "protein_100g": 7, "carbs_100g": 4, "fat_100g": 0.5}]}
- Lista vazia se não houver alimentos.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return json({ error: "não autenticado" }, 401);
  }
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) {
    return json({ error: "MISTRAL_API_KEY não configurado (Edge Function secrets)" }, 500);
  }

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 500);
  } catch {
    return json({ error: "body inválido" }, 400);
  }
  if (!text.trim()) return json({ error: "texto em falta" }, 400);

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
    return json({ error: `mistral indisponível: ${e}` }, 502);
  }
  if (!mistral.ok) {
    const detail = await mistral.text().catch(() => "");
    return json({ error: `mistral ${mistral.status}: ${detail.slice(0, 200)}` }, 502);
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

  return json({ items: clean });
});
