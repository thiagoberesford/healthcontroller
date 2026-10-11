/* Camada de dados: Supabase (se configurado/logado) > backend local > localStorage.
   Treinos/diários: activities/daily (multi-fonte). Refeições: meals. Corpo: body_metrics. */
import { createClient } from "@supabase/supabase-js";
import { computeTotals } from "./foodParser";

export const API_BASE = import.meta.env.VITE_API_BASE || null;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || null;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || null;

let sbClient = null;
const supabase = () => {
  if (!sbClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
    sbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return sbClient;
};

export const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

async function safeText(ctx) {
  try {
    const t = await ctx.text();
    return t ? t.slice(0, 200) : null;
  } catch {
    return null;
  }
}

export async function sbSignIn(email, password) {
  const sb = supabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function sbSignOut() {
  const sb = supabase();
  if (sb) await sb.auth.signOut();
}

export async function sbUser() {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}

export function onSbAuthChange(cb) {
  const sb = supabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) =>
    cb(session ? session.user : null),
  );
  return () => data.subscription.unsubscribe();
}

const STORE_KEY = "health-controller-v1";
const makeId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { meals: [], body: [] };
}

function saveLocal(db) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {}
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isoOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nowTime = () => new Date().toTimeString().slice(0, 5);

export const api = {
  mode: "local",

  async probe() {
    if (!API_BASE && !import.meta.env.DEV) {
      this.mode = "local";
      return false;
    }
    const base = API_BASE || "";
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) });
      this.mode = r.ok ? "backend" : "local";
    } catch (e) {
      this.mode = "local";
    }
    return this.mode === "backend";
  },

  // ---------------- nutrição ----------------

  async parseMeal(text) {
    const { parseMealLocal, macrosOf, computeTotals, matchFoodLabel } = await import("./foodParser");
    const foods = await this.listFoods();

    // NL = sempre o LLM; determinista é só fallback
    const det = parseMealLocal(text, foods);
    const wrap = (items, unknown) => {
      const lite = items.map((p) => ({
        label: p.label,
        grams: p.grams,
        ...macrosOf(p),
        ...(p.unit ? { unit: p.unit } : {}),
        ...(p.quantity ? { quantity: p.quantity } : {}),
        ...(p.origin ? { origin: p.origin } : {}),
        ...(p.needs_review ? { needs_review: true } : {}),
        ...(p.kcal_100 != null ? { kcal_100: p.kcal_100 } : {}),
        ...(p.protein_100 != null ? { protein_100: p.protein_100 } : {}),
        ...(p.carbs_100 != null ? { carbs_100: p.carbs_100 } : {}),
        ...(p.fat_100 != null ? { fat_100: p.fat_100 } : {}),
        ...(p.estimated ? { estimated: true } : {}),
      }));
      const t = lite.length
        ? computeTotals(lite)
        : { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      return { items: lite, unknown, totals: { label: "Total", grams: 0, ...t } };
    };

    // 1) LLM (edge function Mistral) — item a item ancorado à base
    const sb = supabase();
    if (sb) {
      try {
        const { data, error } = await sb.functions.invoke("parse-meal", { body: { text } });
        if (error) {
          // deixar o erro chegar ao utilizador (não engolir)
          return {
            ...wrap(det.items, det.unknown),
            llmError: (error.context ? await safeText(error.context) : null) || error.message || "chamada falhou",
          };
        }
        if (data?.items?.length) {
          // o parser na Edge Function já resolveu unidades, base local e OFF
          const items = data.items.map((it) => ({
            label: it.label,
            grams: it.grams,
            unit: it.unit || "g",
            quantity: it.quantity || it.grams,
            kcal: it.kcal,
            protein: it.protein,
            carbs: it.carbs,
            fat: it.fat,
            kcal_100: it.kcal_100,
            protein_100: it.protein_100,
            carbs_100: it.carbs_100,
            fat_100: it.fat_100,
            origin: it.origin || "estimate",
            needs_review: !!it.needs_review,
            estimated: (it.origin || "estimate") === "estimate",
          }));
          return wrap(items, data.unknown || []);
        }
      } catch (e) {}
    }

    // 2) fallback: backend local (dev) ou o que o determinista apanhou
    if (this.mode === "backend" && !det.items.length) {
      try {
        const r = await fetch(`${API_BASE || ""}/api/parse-meal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    return wrap(det.items, det.unknown);
  },

  _foodsCache: null,

  async listFoods() {
    if (this._foodsCache) return this._foodsCache;
    const sb = supabase();
    if (sb) {
      try {
        // o PostgREST corta em 1000 linhas — paginar até trazer tudo
        const PAGE = 1000;
        let from = 0;
        const all = [];
        for (let guard = 0; guard < 10; guard++) {
          const { data, error } = await sb
            .from("foods")
            .select("name,brand,category,kcal,protein,carbs,fat,portion")
            .order("id")
            .range(from, from + PAGE - 1);
          if (error || !data || !data.length) break;
          all.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        if (all.length) {
          this._foodsCache = all;
          return all;
        }
      } catch (e) {}
    }
    return [];
  },

  /* Alimento personalizado — fica na tabela foods (source='custom')
     e passa a aparecer no autocomplete. */
  async addFood(f) {
    const sb = supabase();
    if (!sb) return null;
    const id = `custom|${f.name}`.toLowerCase().slice(0, 110);
    const row = {
      id,
      name: f.name,
      brand: f.brand || "Meu registo",
      category: f.category || "personalizado",
      kcal: f.kcal,
      protein: f.protein || 0,
      carbs: f.carbs || 0,
      fat: f.fat || 0,
      portion: f.portion || 100,
      source: "custom",
    };
    try {
      const { data, error } = await sb.from("foods").upsert(row).select().single();
      if (error) return null;
      this._foodsCache = null;
      return data;
    } catch (e) {
      return null;
    }
  },

  async listMeals() {
    const sb = supabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from("meals")
          .select("id,date,time,text,items,totals")
          .order("date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500);
        if (!error) return data || [];
      } catch (e) {}
    }
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/meals`);
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    return loadLocal().meals;
  },

  async addMeal(text, items, time) {
    const totals = items ? computeTotals(items) : null;
    /* refeições registadas depois da meia-noite (até às 05:00)
       pertencem ao dia anterior — o dia do utilizador termina ao deitar */
    const now = new Date();
    let date;
    if (now.getHours() < 5) {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      date = isoOf(y);
    } else {
      date = todayIso();
    }
    const sb = supabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from("meals")
          .insert({
            date,
            time: time || nowTime(),
            text,
            items: items || [],
            totals,
          })
          .select()
          .single();
        if (!error) return data;
      } catch (e) {}
    }
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/meals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    const db = loadLocal();
    const entry = {
      id: makeId(),
      date: todayIso(),
      time: time || nowTime(),
      text,
      items,
      totals,
    };
    db.meals.unshift(entry);
    saveLocal(db);
    return entry;
  },

  async deleteMeal(id) {
    const sb = supabase();
    if (sb) {
      try {
        const { error } = await sb.from("meals").delete().eq("id", id);
        if (!error) return;
      } catch (e) {}
    }
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/meals/${id}`, { method: "DELETE" });
        if (r.ok) return;
      } catch (e) {}
    }
    const db = loadLocal();
    db.meals = db.meals.filter((m) => m.id !== id);
    saveLocal(db);
  },

  // ---------------- corpo ----------------

  async listBody() {
    const sb = supabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from("body_metrics")
          .select("*")
          .order("date", { ascending: true });
        if (!error) return data || [];
      } catch (e) {}
    }
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/body`);
        if (r.ok) {
          const rows = await r.json();
          return rows.map((b) => ({
            date: b.date,
            weight: b.weight_kg,
            muscle: b.muscle_kg,
            body_fat: b.fat_pct,
            source: b.source || "manual",
          }));
        }
      } catch (e) {}
    }
    return loadLocal().body.map((b) => ({
      date: b.date,
      weight: b.weight_kg,
      muscle: b.muscle_kg,
      body_fat: b.fat_pct,
      source: b.source || "manual",
    }));
  },

  async addBody(m) {
    const row = {
      date: todayIso(),
      weight: m.weight_kg,
      muscle: m.muscle_kg ?? null,
      body_fat: m.fat_pct ?? null,
      source: m.source || "manual",
    };
    const sb = supabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from("body_metrics")
          .upsert(row)
          .select()
          .single();
        if (!error) return data;
      } catch (e) {}
    }
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/body`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: row.date, ...m }),
        });
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    const db = loadLocal();
    const entry = {
      date: row.date,
      weight_kg: row.weight,
      muscle_kg: row.muscle,
      fat_pct: row.body_fat,
      source: row.source,
    };
    db.body.push(entry);
    db.body.sort((a, b) => a.date.localeCompare(b.date));
    saveLocal(db);
    return entry;
  },

  // ---------------- treinos/diários (Garmin + Suunto) ----------------

  async listGarminActivities(start, end) {
    const sb = supabase();
    if (sb) {
      try {
        let q = sb.from("activities").select("*").order("start", { ascending: false });
        if (start) q = q.gte("start", `${start} 00:00:00`);
        if (end) q = q.lte("start", `${end} 23:59:59`);
        const { data, error } = await q;
        if (!error) return data || [];
      } catch (e) {}
    }
    if (this.mode === "backend") {
      try {
        const q = start && end ? `?start=${start}&end=${end}` : "";
        const r = await fetch(`${API_BASE || ""}/api/garmin/activities${q}`);
        if (r.ok) return (await r.json()).activities;
      } catch (e) {}
    }
    return [];
  },

  async listGarminDaily(start, end) {
    const sb = supabase();
    if (sb) {
      try {
        let q = sb.from("daily").select("*").order("date", { ascending: true });
        if (start) q = q.gte("date", start);
        if (end) q = q.lte("date", end);
        const { data, error } = await q;
        if (error) throw error;
        /* Um dia pode ter duas fontes (garmin + suunto); merge por campo:
           suunto ganha quando tem valor, garmin preenche o que falta
           (ex.: suunto tem os passos, garmin o sono daquela manhã). */
        const byDate = new Map();
        for (const d of data || []) {
          const prev = byDate.get(d.date);
          if (!prev) {
            byDate.set(d.date, { ...d });
            continue;
          }
          const [a, b] = prev.source === "suunto" ? [prev, d] : [d, prev];
          const merged = { ...a };
          for (const k of Object.keys(b)) {
            if (b[k] != null && merged[k] == null) merged[k] = b[k];
          }
          byDate.set(d.date, merged);
        }
        return [...byDate.values()];
      } catch (e) {
        return [];
      }
    }
    if (this.mode === "backend") {
      try {
        const q = start && end ? `?start=${start}&end=${end}` : "";
        const r = await fetch(`${API_BASE || ""}/api/garmin/daily${q}`);
        if (r.ok) return (await r.json()).daily;
      } catch (e) {}
    }
    return [];
  },

  /* Treinos planeados (Treinus -> SuuntoPlus Guides). */
  /* Ténis: registo de pares; "atual" é o par em uso. */
  async listShoes() {
    const sb = supabase();
    if (!sb) return [];
    try {
      const { data, error } = await sb
        .from("shoes")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  },

  async addShoe({ name, target_km = 700, start_km = 0, start_date = null }) {
    const sb = supabase();
    if (!sb || !name?.trim()) return null;
    const id = `shoe|${name.trim()}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);
    try {
      const { data, error } = await sb
        .from("shoes")
        .upsert({
          id,
          name: name.trim(),
          target_km,
          start_km,
          start_date,
        })
        .select()
        .single();
      if (error) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  /* define o par em uso (retira o "atual" aos restantes) */
  async setCurrentShoe(id) {
    const sb = supabase();
    if (!sb) return false;
    try {
      const shoes = await this.listShoes();
      for (const s of shoes) {
        if (s.is_current && s.id !== id) {
          await sb.from("shoes").update({ is_current: false }).eq("id", s.id);
        }
      }
      const { error } = await sb.from("shoes").update({ is_current: true, retired: false }).eq("id", id);
      return !error;
    } catch (e) {
      return false;
    }
  },

  async updateShoe(id, patch) {
    const sb = supabase();
    if (!sb) return null;
    try {
      const { data, error } = await sb.from("shoes").update(patch).eq("id", id).select().single();
      if (error) return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  /* Atribuição de ténis por treino (uma linha por treino). */
  async listShoeAssignments() {
    const sb = supabase();
    if (!sb) return [];
    try {
      const { data, error } = await sb
        .from("shoe_assignments")
        .select("source,source_key,shoe_id")
        .order("assigned_at", { ascending: true });
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  },

  async setShoeAssignment(source, sourceKey, shoeId) {
    const sb = supabase();
    if (!sb || !shoeId) return false;
    try {
      const { error } = await sb
        .from("shoe_assignments")
        .upsert({ source, source_key: sourceKey, shoe_id: shoeId }, {
          onConflict: "source,source_key",
        });
      return !error;
    } catch (e) {
      return false;
    }
  },

  async removeShoeAssignment(source, sourceKey) {
    const sb = supabase();
    if (!sb) return false;
    try {
      const { error } = await sb
        .from("shoe_assignments")
        .delete()
        .eq("source", source)
        .eq("source_key", sourceKey);
      return !error;
    } catch (e) {
      return false;
    }
  },

  /* foto do par: ficheiro próprio do utilizador -> bucket 'shoes' */
  async uploadShoePhoto(shoeId, file) {
    const sb = supabase();
    if (!sb || !file) return null;
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 4);
      const path = `${shoeId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from("shoes").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) return null;
      const { data } = sb.storage.from("shoes").getPublicUrl(path);
      const saved = await this.updateShoe(shoeId, { photo_url: data.publicUrl });
      return saved;
    } catch (e) {
      return null;
    }
  },

  async listPlannedWorkouts() {
    const sb = supabase();
    if (!sb) return [];
    try {
      const { data, error } = await sb
        .from("planned_workouts")
        .select("id,date,name,source,data,push_status")
        .eq("source", "treinus")
        .order("date", { ascending: true });
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  },

  /* Hidratação diária (Visão geral, meta 3L). */
  async getHydration(date) {
    const sb = supabase();
    if (!sb) return null;
    try {
      const { data, error } = await sb
        .from("hydration")
        .select("ml")
        .eq("date", date)
        .maybeSingle();
      if (error) return null;
      return data ? data.ml : 0;
    } catch (e) {
      return null;
    }
  },

  async listHydration(start) {
    const sb = supabase();
    if (!sb) return [];
    try {
      let q = sb.from("hydration").select("date,ml").order("date", { ascending: true });
      if (start) q = q.gte("date", start);
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    } catch (e) {
      return [];
    }
  },

  async addWater(date, ml) {
    const sb = supabase();
    if (!sb) return null;
    try {
      const { data: cur } = await sb
        .from("hydration")
        .select("ml")
        .eq("date", date)
        .maybeSingle();
      const total = Math.max(0, (cur?.ml || 0) + ml);
      const { error } = await sb
        .from("hydration")
        .upsert({ date, ml: total }, { onConflict: "date" });
      if (error) return null;
      return total;
    } catch (e) {
      return null;
    }
  },

  /* Push de guia para o relógio: cria pedido na fila; o worker no Mac
     processa (LaunchAgent a cada 5 min) e marca push_status='watch'. */
  async pushGuideToWatch(date) {
    const sb = supabase();
    if (!sb) return false;
    try {
      const { error } = await sb.from("guide_push_queue").insert({ date });
      return !error;
    } catch (e) {
      return false;
    }
  },

  /* Coach chat: streaming SSE; onEvent recebe {type:"tools"|"token"|"done"|"error"} */
  async coachChat(question, history, onEvent) {
    const sb = supabase();
    if (!sb) return onEvent({ type: "error", error: "Supabase indisponível" });
    try {
      const { data } = await sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return onEvent({ type: "error", error: "sessão expirada" });
      const r = await fetch(`${SUPABASE_URL}/functions/v1/coach-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question, history: history.slice(-8) }),
      });
      if (!r.ok || !r.body) {
        const detail = await r.text().catch(() => "");
        return onEvent({ type: "error", error: `coach-chat ${r.status}: ${detail.slice(0, 120)}` });
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice(5).trim()));
          } catch {}
        }
      }
    } catch (e) {
      onEvent({ type: "error", error: String(e).slice(0, 120) });
    }
  },

  async probeSupabase() {
    const sb = supabase();
    if (!sb) return false;
    try {
      const { error } = await sb.from("daily").select("date").limit(1);
      return !error;
    } catch (e) {
      return false;
    }
  },

  async getActivityDetail(source, sourceKey) {
    const sb = supabase();
    if (!sb || !sourceKey) return null;
    try {
      const { data, error } = await sb
        .from("activity_details")
        .select("data")
        .eq("source", source)
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (error) return null;
      return data ? data.data : null;
    } catch (e) {
      return null;
    }
  },

  async getActivity(source, sourceKey) {
    const sb = supabase();
    if (!sb || !sourceKey) return null;
    try {
      const { data, error } = await sb
        .from("activities")
        .select("*")
        .eq("source", source)
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (error) return null;
      return data || null;
    } catch (e) {
      return null;
    }
  },

  async listPersonalRecords() {
    const sb = supabase();
    if (!sb) return [];
    try {
      const { data, error } = await sb
        .from("personal_records")
        .select("*")
        .order("value_s", { ascending: true });
      if (!error) return data || [];
    } catch (e) {}
    return [];
  },

  // ---------------- migração única localStorage -> Supabase ----------------

  async migrateLocalToSupabase() {
    const sb = supabase();
    if (!sb) return;
    try {
      if (localStorage.getItem("hc-sb-migrated")) return;
      const db = loadLocal();
      const { count: mealsCount } = await sb
        .from("meals")
        .select("id", { count: "exact", head: true });
      if (!mealsCount && db.meals.length) {
        for (const m of db.meals) {
          await sb.from("meals").insert({
            date: m.date,
            time: m.time,
            text: m.text,
            items: m.items || [],
            totals: m.totals || null,
          });
        }
      }
      const { count: bodyCount } = await sb
        .from("body_metrics")
        .select("date", { count: "exact", head: true });
      if (!bodyCount && db.body.length) {
        for (const b of db.body) {
          await sb.from("body_metrics").upsert({
            date: b.date,
            weight: b.weight_kg,
            muscle: b.muscle_kg ?? null,
            body_fat: b.fat_pct ?? null,
            source: b.source || "manual",
          });
        }
      }
      localStorage.setItem("hc-sb-migrated", "1");
    } catch (e) {}
  },
};
