// Edge Function: treinador conversacional (function calling + streaming).
// O site chama via fetch a /functions/v1/coach-chat com o JWT do utilizador —
// TODAS as consultas a dados usam esse JWT (RLS aplica-se; nunca service key).
// Requer o secret MISTRAL_API_KEY. SÓ LEITURA: nenhuma ferramenta escreve.
// Deploy (dashboard): Edge Functions -> New function -> "coach-chat" -> colar este ficheiro.

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MODEL = "mistral-small-latest";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

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

const SYSTEM = `És o treinador do Health Controller. Responde em português de Portugal, com frases curtas e os números reais das ferramentas. Nunca inventas dados; se faltarem dados, dizes claramente o que falta. Podes fazer 2-3 chamadas a ferramentas antes de responder.

Contexto do utilizador:
- Histórico de treinos: 7 anos de Garmin (arquivo congelado até 04/10/2026), depois Suunto em direto
- As calorias ativas do daily JÁ INCLUEM a energia dos treinos
- Balanço nutricional = kcal ingeridas − calorias ativas; meta de perda de peso: 1800 kcal/dia
- Sono/HRV/FC repouso vêm do daily; peso e composição do body_metrics
- Treinos planeados (Treinus) em planned_workouts
- Ritmo de corrida: se pedirem, calcula min/km a partir de duration_s e distance_km`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "query_activities",
      description:
        "Treinos feitos (corridas, caminhadas, força…). Devolve agregados (n.º, km, kcal, tempo) e a lista resumida. Usa para 'quantos km corri', 'treinos desta semana', etc.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
          end_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
          type: { type: "string", description: "running | walking | strength_training | … (opcional)" },
          limit: { type: "number", description: "máx. atividades (por defeito 50)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_daily",
      description:
        "Métricas diárias: sleep_hours, hrv, resting_hr, steps, active_kcal ou total_kcal. Devolve média/mín/máx e os valores do período.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", description: "sleep_hours | hrv | resting_hr | steps | active_kcal | total_kcal" },
          start_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
          end_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_body",
      description: "Peso e composição corporal (body_metrics). Sem datas = últimos 30 dias.",
      parameters: {
        type: "object",
        properties: {
          start_date: { type: "string" },
          end_date: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_meals",
      description:
        "Refeições e macros por dia, com o saldo nutricional (ingerido − calorias ativas do dia). Sem datas = últimos 7 dias.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD de um dia específico (opcional)" },
          days: { type: "number", description: "n.º de dias para trás (por defeito 7)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_hydration",
      description: "Água registada por dia (ml; meta 3000 ml).",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "n.º de dias para trás (por defeito 7)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_personal_records",
      description: "Melhores marcas oficiais (1 km, 1 milha, 5 km, 10 km, meia maratona, maratona).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_planned_workouts",
      description: "Treinos planeados (Treinus), atuais e futuros, com briefing.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "n.º de dias à frente (por defeito 14)" },
        },
      },
    },
  },
];

/* ---------- helpers PostgREST (JWT do user; RLS aplica) ---------- */

async function pg(auth: string, path: string): Promise<Record<string, unknown>[] | null> {
  if (!SUPABASE_URL) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

function summarizeActivities(rows: Record<string, unknown>[]) {
  const runKm = rows
    .filter((r) => ["running", "trail_running", "treadmill_running"].includes(String(r.type)))
    .reduce((s, r) => s + (Number(r.distance_km) || 0), 0);
  return {
    count: rows.length,
    total_km: +rows.reduce((s, r) => s + (Number(r.distance_km) || 0), 0).toFixed(1),
    running_km: +runKm.toFixed(1),
    total_time_min: Math.round(rows.reduce((s, r) => s + (Number(r.duration_s) || 0), 0) / 60),
    total_kcal: Math.round(rows.reduce((s, r) => s + (Number(r.kcal) || 0), 0)),
    activities: rows.slice(0, 20).map((r) => ({
      date: String(r.start || "").slice(0, 10),
      name: r.name,
      type: r.type,
      km: Number(r.distance_km) || 0,
      min: Math.round((Number(r.duration_s) || 0) / 60),
      kcal: r.kcal ?? null,
      avg_hr: r.avg_hr ?? null,
      source: r.source,
    })),
  };
}

function summarizeMetric(metric: string, rows: Record<string, unknown>[]) {
  const vals = rows
    .map((r) => ({ date: String(r.date).slice(0, 10), v: Number(r[metric]) }))
    .filter((x) => Number.isFinite(x.v) && x.v !== 0);
  if (!vals.length) return { count: 0 };
  const sum = vals.reduce((s, x) => s + x.v, 0);
  return {
    count: vals.length,
    avg: +(sum / vals.length).toFixed(1),
    min: Math.min(...vals.map((x) => x.v)),
    max: Math.max(...vals.map((x) => x.v)),
    values: vals.length > 60 ? vals.slice(-60) : vals,
  };
}

/* ---------- executores das ferramentas (SÓ LEITURA) ---------- */

const TOOL_RUNNERS: Record<string, (auth: string, args: Record<string, unknown>) => Promise<unknown>> = {
  async query_activities(auth, a) {
    const p = new URLSearchParams({
      select: "name,type,start,distance_km,duration_s,kcal,avg_hr,source",
      order: "start.desc",
      limit: String(Math.min(Number(a.limit) || 50, 200)),
    });
    if (a.start_date) p.set("start", `gte.${a.start_date} 00:00:00`);
    if (a.end_date) p.set("end", `lte.${a.end_date} 23:59:59`); // postgrest 'and' via &and=(...)
    let path = `activities?${p}`;
    if (a.start_date && a.end_date) {
      path = `activities?select=name,type,start,distance_km,duration_s,kcal,avg_hr,source` +
        `&and=(start.gte.${a.start_date} 00:00:00,start.lte.${a.end_date} 23:59:59)` +
        `&order=start.desc&limit=${Math.min(Number(a.limit) || 50, 200)}`;
    }
    if (a.type && !(a.start_date && a.end_date)) path += `&type=eq.${a.type}`;
    const rows = (await pg(auth, path)) ?? [];
    return a.type ? summarizeActivities(rows.filter((r) => r.type === a.type)) : summarizeActivities(rows);
  },

  async query_daily(auth, a) {
    const metric = String(a.metric || "");
    const allowed = ["sleep_hours", "hrv", "resting_hr", "steps", "active_kcal", "total_kcal"];
    if (!allowed.includes(metric)) return { error: `métrica inválida; usa uma de: ${allowed.join(", ")}` };
    const start = String(a.start_date || addDays(-30));
    const end = String(a.end_date || today());
    const rows = (await pg(
      auth,
      `daily?select=date,source,${metric}&date=gte.${start}&date=lte.${end}&order=date.asc&limit=1000`,
    )) ?? [];
    return summarizeMetric(metric, rows);
  },

  async query_body(auth, a) {
    const start = String(a.start_date || addDays(-30));
    const end = String(a.end_date || today());
    const rows = (await pg(
      auth,
      `body_metrics?select=date,weight,body_fat,muscle,water,bone_mass,visceral_fat,protein,bmi` +
        `&date=gte.${start}&date=lte.${end}&order=date.asc&limit=400`,
    )) ?? [];
    return { count: rows.length, measures: rows };
  },

  async query_meals(auth, a) {
    if (a.date) {
      const day = String(a.date);
      const meals = (await pg(auth, `meals?select=text,time,totals&date=eq.${day}&order=time.asc`)) ?? [];
      const daily = (await pg(auth, `daily?select=date,active_kcal&date=eq.${day}`)) ?? [];
      const inK = (meals as Record<string, unknown>[]).reduce(
        (s, m) => s + (Number((m.totals as Record<string, unknown>)?.kcal) || 0), 0,
      );
      return { date: day, meals, ingested_kcal: Math.round(inK), active_kcal: daily[0]?.active_kcal ?? null };
    }
    const days = Math.min(Number(a.days) || 7, 30);
    const start = addDays(-days + 1);
    const meals = (await pg(
      auth, `meals?select=date,time,text,totals&date=gte.${start}&order=date.asc&limit=400`,
    )) ?? [];
    const daily = (await pg(
      auth, `daily?select=date,active_kcal&date=gte.${start}&order=date.asc&limit=400`,
    )) ?? [];
    const activeMap = new Map(daily.map((d) => [String(d.date).slice(0, 10), Number(d.active_kcal) || 0]));
    const byDay: Record<string, { ingested: number; meals: number }> = {};
    for (const m of meals as Record<string, unknown>[]) {
      const d = String(m.date).slice(0, 10);
      byDay[d] ??= { ingested: 0, meals: 0 };
      byDay[d].ingested += Number((m.totals as Record<string, unknown>)?.kcal) || 0;
      byDay[d].meals += 1;
    }
    return Object.entries(byDay).map(([d, v]) => ({
      date: d,
      ingested_kcal: Math.round(v.ingested),
      meals: v.meals,
      active_kcal: activeMap.get(d) ?? null,
      balance_kcal: Math.round(v.ingested - (activeMap.get(d) ?? 0)),
    }));
  },

  async query_hydration(auth, a) {
    const days = Math.min(Number(a.days) || 7, 30);
    const rows = (await pg(
      auth, `hydration?select=date,ml&date=gte.${addDays(-days + 1)}&order=date.asc&limit=100`,
    )) ?? [];
    return { goal_ml: 3000, days: rows };
  },

  async get_personal_records(auth) {
    const rows = (await pg(auth, `personal_records?select=label,value_s,activity_key,date&order=value_s.asc`)) ?? [];
    return { records: rows };
  },

  async get_planned_workouts(auth, a) {
    const days = Math.min(Number(a.days) || 14, 60);
    const rows = (await pg(
      auth,
      `planned_workouts?select=date,name,data,push_status&source=eq.treinus&date=gte.${today()}` +
        `&date=lte.${addDays(days)}&order=date.asc`,
    )) ?? [];
    return {
      workouts: (rows as Record<string, unknown>[]).map((r) => ({
        date: String(r.date).slice(0, 10),
        name: r.name,
        time: (r.data as Record<string, unknown>)?.time_max ?? null,
        briefing: (r.data as Record<string, unknown>)?.briefing ?? null,
        on_watch: r.push_status === "watch",
      })),
    };
  },
};

/* ---------- Mistral com function calling + streaming ---------- */

async function mistralChat(key: string, messages: unknown[], stream: boolean): Promise<Response> {
  return fetch(MISTRAL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 800,
      stream,
      messages,
      ...(stream ? {} : { tools: TOOLS, tool_choice: "auto" })),
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "não autenticado" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }
  const key = Deno.env.get("MISTRAL_API_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "MISTRAL_API_KEY não configurado" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  let question = "";
  let history: unknown[] = [];
  try {
    const body = await req.json();
    question = String(body?.question ?? "").slice(0, 500);
    history = Array.isArray(body?.history) ? body.history.slice(-8) : [];
  } catch {
    /* body vazio */
  }
  if (!question.trim()) {
    return new Response(JSON.stringify({ error: "pergunta em falta" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }

  const messages: unknown[] = [
    { role: "system", content: SYSTEM },
    ...history,
    { role: "user", content: question },
  ];

  /* 1ª chamada: decidir ferramentas (até 2 rondas) */
  const usedTools: string[] = [];
  for (let round = 0; round < 2; round++) {
    const r = await mistralChat(key, messages, false);
    if (!r.ok) break;
    const doc = await r.json();
    const msg = doc?.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) break;
    messages.push(msg);
    for (const c of calls) {
      const name = String(c?.function?.name ?? "");
      usedTools.push(name);
      const runner = TOOL_RUNNERS[name];
      let result: unknown;
      if (!runner) {
        result = { error: `ferramenta desconhecida: ${name}` };
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(c?.function?.arguments || "{}");
        } catch {}
        result = await runner(auth, args);
      }
      messages.push({ role: "tool", name, content: JSON.stringify(result) });
    }
  }

  /* 2ª chamada: resposta final em streaming (SSE) */
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      if (usedTools.length) send({ type: "tools", names: usedTools });
      try {
        const r = await mistralChat(key, messages, true);
        if (!r.ok || !r.body) {
          send({ type: "error", error: `mistral ${r.status}` });
          controller.close();
          return;
        }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === " {
              const doc = JSON.parse(payload);
              const tk = doc?.choices?.[0]?.delta?.content ?? "";
              if (tk) send({ type: "token", v: tk });
            } catch {}
          }
        }
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", error: String(e) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...corsHeaders(req),
    },
  });
});
