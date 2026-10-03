/* Camada de dados: Supabase (se configurado/logado) > backend local > localStorage.
   Garmin/Suunto: garmin_activities/garmin_daily. Refeições: meals. Corpo: body_metrics. */
import { createClient } from "@supabase/supabase-js";
import { parseMealLocal, computeTotals, macrosOf } from "./foodParser";

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

const todayIso = () => new Date().toISOString().slice(0, 10);
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
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/parse-meal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    const { items, unknown } = parseMealLocal(text);
    const lite = items.map((p) => ({ label: p.label, grams: p.grams, ...macrosOf(p) }));
    const t = computeTotals(items);
    return { items: lite, unknown, totals: { label: "Total", grams: 0, ...t } };
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
    const sb = supabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from("meals")
          .insert({
            date: todayIso(),
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
        if (r.ok) return await r.json();
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
          body: JSON.stringify(m),
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
        let q = sb.from("garmin_activities").select("*").order("start", { ascending: false });
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
        let q = sb.from("garmin_daily").select("*").order("date", { ascending: true });
        if (start) q = q.gte("date", start);
        if (end) q = q.lte("date", end);
        const { data, error } = await q;
        if (!error) return data || [];
      } catch (e) {}
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

  async probeSupabase() {
    const sb = supabase();
    if (!sb) return false;
    try {
      const { error } = await sb.from("garmin_daily").select("date").limit(1);
      return !error;
    } catch (e) {
      return false;
    }
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
