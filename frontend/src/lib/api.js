/* Camada de API dupla: backend (se disponível) ou modo local (localStorage).
   Dados Garmin: Supabase (se configurado) > backend > vazio. */
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
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/meals`);
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    return loadLocal().meals;
  },

  async addMeal(text, items, time) {
    const todayIso = new Date().toISOString().slice(0, 10);
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
      date: todayIso,
      time: time || new Date().toTimeString().slice(0, 5),
      text,
      items,
      totals: computeTotals(items),
    };
    db.meals.unshift(entry);
    saveLocal(db);
    return entry;
  },

  async deleteMeal(id) {
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

  async listBody() {
    if (this.mode === "backend") {
      try {
        const r = await fetch(`${API_BASE || ""}/api/body`);
        if (r.ok) return await r.json();
      } catch (e) {}
    }
    return loadLocal().body;
  },

  async addBody(m) {
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
      date: new Date().toISOString().slice(0, 10),
      weight_kg: m.weight_kg,
      muscle_kg: m.muscle_kg ?? null,
      fat_pct: m.fat_pct ?? null,
      source: m.source || "manual",
    };
    db.body.push(entry);
    db.body.sort((a, b) => a.date.localeCompare(b.date));
    saveLocal(db);
    return entry;
  },
};
