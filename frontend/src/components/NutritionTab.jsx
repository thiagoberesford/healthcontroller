import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, Ring } from "./ui.jsx";
import { C, axisProps, tooltipStyle } from "../theme.js";
import { api } from "../lib/api.js";
import { addDays, dateKey, dayMonth, fmtDate } from "../lib/garmin.js";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function NutritionTab({ meals, refreshKey, addMeal, removeMeal }) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState([]);
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ name: "", kcal: "", protein: "", carbs: "", fat: "", portion: "" });
  const [customMsg, setCustomMsg] = useState(null);
  const [chartMode, setChartMode] = useState("macros");
  const [openDays, setOpenDays] = useState(() => new Set([todayIso()]));
  const [foods, setFoods] = useState([]);
  const [hydration, setHydration] = useState([]);
  const [daily14, setDaily14] = useState([]);
  const [weight, setWeight] = useState(null);
  const [actsSince, setActsSince] = useState([]);

  const loadFoods = () => api.listFoods().then(setFoods);

  useEffect(() => {
    api.listHydration(addDays(dateKey(new Date()), -13)).then(setHydration);
    api.listGarminDaily(SUUNTO_START, dateKey(new Date())).then(setDaily14);
    api.listGarminActivities(SUUNTO_START, dateKey(new Date())).then(setActsSince);
    api.listBody().then((rows) => {
      const withWeight = (rows || []).filter((r) => r.weight).slice(-1);
      if (withWeight.length) setWeight(withWeight[0].weight);
    });
  }, [refreshKey]);

  useEffect(() => {
    loadFoods();
  }, [refreshKey]);

  const normQ = (s) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const suggestions = useMemo(() => {
    const q = normQ(query.trim());
    if (!q) return foods.slice(0, 20);
    const terms = q.split(/\s+/).filter(Boolean);
    return foods
      .filter((f) => {
        const hay = normQ(`${f.name} ${f.brand}`);
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 30);
  }, [query, foods]);

  const addPending = (f) => {
    setPending((p) => [...p, { food: f, grams: f.portion || 100 }]);
    setQuery("");
  };

  const setGrams = (i, grams) => {
    const g = Math.max(0, Math.round(parseFloat(grams) || 0));
    setPending((p) => p.map((x, j) => (j === i ? { ...x, grams: g } : x)));
  };

  const macrosOfItem = (f, g) => ({
    kcal: Math.round((f.kcal * g) / 100),
    protein: +((f.protein * g) / 100).toFixed(1),
    carbs: +((f.carbs * g) / 100).toFixed(1),
    fat: +((f.fat * g) / 100).toFixed(1),
  });

  const pendingTotals = pending.reduce(
    (acc, p) => {
      const m = macrosOfItem(p.food, p.grams);
      return {
        kcal: acc.kcal + m.kcal,
        protein: +(acc.protein + m.protein).toFixed(1),
        carbs: +(acc.carbs + m.carbs).toFixed(1),
        fat: +(acc.fat + m.fat).toFixed(1),
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const confirmPending = async () => {
    if (!pending.length) return;
    const items = pending.map((p) => ({
      label: p.food.brand && p.food.brand !== "Meu registo" ? `${p.food.name} (${p.food.brand})` : p.food.name,
      grams: p.grams,
      ...macrosOfItem(p.food, p.grams),
    }));
    const text = items.map((i) => `${i.label} ${i.grams}g`).join(", ");
    await api.addMeal(text, items);
    if (addMeal) addMeal();
    setPending([]);
  };

  const saveCustom = async () => {
    const kcal = parseFloat(custom.kcal.replace(",", "."));
    if (!custom.name.trim() || !kcal) {
      setCustomMsg("Preenche pelo menos o nome e as kcal/100g.");
      return;
    }
    const f = {
      name: custom.name.trim(),
      kcal,
      protein: parseFloat((custom.protein || "0").replace(",", ".")) || 0,
      carbs: parseFloat((custom.carbs || "0").replace(",", ".")) || 0,
      fat: parseFloat((custom.fat || "0").replace(",", ".")) || 0,
      portion: parseFloat((custom.portion || "100").replace(",", ".")) || 100,
    };
    const saved = await api.addFood(f);
    if (!saved) {
      setCustomMsg("Não foi possível guardar (Supabase?).");
      return;
    }
    await loadFoods();
    addPending({ ...f, brand: "Meu registo" });
    setCustom({ name: "", kcal: "", protein: "", carbs: "", fat: "", portion: "" });
    setShowCustom(false);
    setCustomMsg(null);
  };

  const analyze = async () => {
    if (!input.trim()) return setPreview(null);
    setPreview(await api.parseMeal(input));
  };

  const confirm = async () => {
    if (!preview || !preview.items.length) return;
    await api.addMeal(input, preview.items);
    if (addMeal) addMeal();
    setInput("");
    setPreview(null);
  };

  const todayMeals = meals.filter((m) => m.date === todayIso());
  const todayTotals = todayMeals.reduce(
    (acc, m) => {
      const t = m.totals || m;
      return {
        kcal: acc.kcal + (t.kcal || 0),
        protein: +(acc.protein + (t.protein || 0)).toFixed(1),
        carbs: +(acc.carbs + (t.carbs || 0)).toFixed(1),
        fat: +(acc.fat + (t.fat || 0)).toFixed(1),
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const macroByDay = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }, (_, i) => {
      const dayIso = addDays(dateKey(today), -(13 - i));
      const dayMeals = meals.filter((m) => m.date === dayIso);
      const t = dayMeals.reduce(
        (acc, m) => {
          const x = m.totals || m;
          return {
            kcal: acc.kcal + (x.kcal || 0),
            protein: +(acc.protein + (x.protein || 0)).toFixed(1),
            carbs: +(acc.carbs + (x.carbs || 0)).toFixed(1),
            fat: +(acc.fat + (x.fat || 0)).toFixed(1),
          };
        },
        { kcal: 0, protein: 0, carbs: 0, fat: 0 }
      );
      return { label: dayMonth(dayIso), ...t };
    });
  }, [meals]);

  const waterByDay = useMemo(() => {
    const map = new Map(hydration.map((h) => [h.date, h.ml]));
    return Array.from({ length: 14 }, (_, i) => {
      const dayIso = addDays(dateKey(new Date()), -(13 - i));
      return { label: dayMonth(dayIso), water: map.get(dayIso) || 0 };
    });
  }, [hydration]);

  /* metas de perda de peso: ~1800 kcal/dia; proteína 1,6 g/kg
     (Morton et al. 2017: 1,6-2,2 g/kg em défice calórico);
     gordura ~0,7 g/kg (piso hormonal); carbo = restante */
  const GOAL_KCAL = 1800;
  const goals = useMemo(() => {
    const w = weight || 97;
    const protein = Math.round(w * 1.6);
    const fat = Math.round(w * 0.7);
    const carbs = Math.max(50, Math.round((GOAL_KCAL - protein * 4 - fat * 9) / 4));
    return { kcal: GOAL_KCAL, protein, carbs, fat };
  }, [weight]);

  /* balanço apenas desde o início do regime Suunto (05/10/2026) */
  const SUUNTO_START = "2026-10-05";

  /* saldos (hoje e gráfico) usam TODOS active_kcal — as ativas do Suunto
     já incluem a energia dos treinos; somar activities.kcal seria double counting */
  const burnedToday = useMemo(() => {
    const today = dateKey(new Date());
    return daily14.find((d) => d.date === today)?.active_kcal ?? null;
  }, [daily14]);

  const workoutKcalByDay = useMemo(() => {
    const m = new Map();
    for (const a of actsSince || []) {
      const d = String(a.start || "").slice(0, 10);
      m.set(d, (m.get(d) || 0) + (a.kcal || 0));
    }
    return m;
  }, [actsSince]);

  const balanceByDay = useMemo(() => {
    const dailyMap = new Map(daily14.map((d) => [d.date, d.active_kcal || 0]));
    const today = dateKey(new Date());
    const days = Math.round(
      (new Date(today) - new Date(SUUNTO_START)) / 86400000,
    ) + 1;
    return Array.from({ length: Math.max(1, days) }, (_, i) => {
      const dayIso = addDays(SUUNTO_START, i);
      const dayMeals = meals.filter((m) => m.date === dayIso);
      const inKcal = Math.round(
        dayMeals.reduce((s, m) => s + (m.totals || m).kcal || 0, 0),
      );
      const outKcal = dailyMap.get(dayIso) || 0;
      return {
        label: dayMonth(dayIso),
        in: inKcal,
        out: outKcal,
        net: inKcal - outKcal,
        workout: Math.round(workoutKcalByDay.get(dayIso) || 0),
      };
    });
  }, [meals, daily14, workoutKcalByDay]);

  const mealsByDay = useMemo(() => {
    const groups = [];
    const byDate = new Map();
    const sorted = [...meals].sort((a, b) =>
      `${b.date}${b.time || ""}`.localeCompare(`${a.date}${a.time || ""}`),
    );
    for (const m of sorted) {
      let g = byDate.get(m.date);
      if (!g) {
        g = { date: m.date, meals: [] };
        byDate.set(m.date, g);
        groups.push(g);
      }
      g.meals.push(m);
    }
    return groups;
  }, [meals]);

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
          🍽️ Adicionar alimentos
        </h3>

        <div className="relative">
          <input
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            placeholder="Procurar alimento (ex: iogurte continente, pão, frango…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            style={inputStyle}
          />
          {focused && suggestions.length > 0 && (
            <div
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg"
              style={{ background: C.card, border: `1px solid ${C.border}` }}
            >
              {suggestions.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addPending(f);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:brightness-125"
                  style={{ borderTop: i ? `1px solid ${C.border}` : "none" }}
                >
                  <span>
                    <span style={{ color: C.text }}>{f.name}</span>{" "}
                    {f.brand && f.brand !== "Meu registo" && (
                      <span style={{ color: C.muted }}>· {f.brand}</span>
                    )}
                  </span>
                  <span className="ml-3 shrink-0 text-xs" style={{ color: C.muted }}>
                    {Math.round(f.kcal)} kcal/100g
                  </span>
                </button>
              ))}
              <div className="px-3 py-1.5 text-center text-[10px]" style={{ color: C.muted }}>
                {query ? `${suggestions.length} resultados` : `mostrando 20 de ${foods.length} — escreve para filtrar`}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setShowCustom((v) => !v)}
          className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          {showCustom ? "Cancelar" : "+ Alimento novo (guardar na minha base)"}
        </button>

        {showCustom && (
          <div className="mt-3 grid gap-2 rounded-lg p-3 sm:grid-cols-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            <input className="rounded-lg px-3 py-2 text-sm outline-none sm:col-span-3" placeholder="Nome do alimento" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} style={inputStyle} />
            <input className="rounded-lg px-3 py-2 text-sm outline-none" placeholder="kcal /100g" value={custom.kcal} onChange={(e) => setCustom({ ...custom, kcal: e.target.value })} style={inputStyle} />
            <input className="rounded-lg px-3 py-2 text-sm outline-none" placeholder="Proteína g/100g" value={custom.protein} onChange={(e) => setCustom({ ...custom, protein: e.target.value })} style={inputStyle} />
            <input className="rounded-lg px-3 py-2 text-sm outline-none" placeholder="Carbo g/100g" value={custom.carbs} onChange={(e) => setCustom({ ...custom, carbs: e.target.value })} style={inputStyle} />
            <input className="rounded-lg px-3 py-2 text-sm outline-none" placeholder="Gordura g/100g" value={custom.fat} onChange={(e) => setCustom({ ...custom, fat: e.target.value })} style={inputStyle} />
            <input className="rounded-lg px-3 py-2 text-sm outline-none" placeholder="Porção padrão (g)" value={custom.portion} onChange={(e) => setCustom({ ...custom, portion: e.target.value })} style={inputStyle} />
            <button onClick={saveCustom} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: C.teal, color: "#04141a" }}>
              Guardar alimento
            </button>
            {customMsg && <p className="text-xs sm:col-span-3" style={{ color: C.red }}>{customMsg}</p>}
          </div>
        )}

        {pending.length > 0 && (
          <div className="mt-4 rounded-lg p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            <div className="space-y-2">
              {pending.map((p, i) => {
                const m = macrosOfItem(p.food, p.grams);
                return (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span style={{ color: C.text }}>
                      {p.food.name}
                      {p.food.brand && p.food.brand !== "Meu registo" && (
                        <span style={{ color: C.muted }}> ({p.food.brand})</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <input
                        type="number"
                        className="w-20 rounded-lg px-2 py-1 text-xs outline-none"
                        value={p.grams}
                        onChange={(e) => setGrams(i, e.target.value)}
                        style={inputStyle}
                      />
                      <span className="text-xs" style={{ color: C.muted }}>
                        {m.kcal} kcal · P{m.protein} C{m.carbs} G{m.fat}
                      </span>
                      <button onClick={() => setPending((list) => list.filter((_, j) => j !== i))} className="text-xs" style={{ color: C.red }}>
                        ✕
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: C.border }}>
              <span className="text-xs" style={{ color: C.muted }}>
                Total: <b style={{ color: C.text }}>{pendingTotals.kcal} kcal</b> · P{pendingTotals.protein} C{pendingTotals.carbs} G{pendingTotals.fat}
              </span>
              <button onClick={confirmPending} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: C.green, color: "#052e12" }}>
                Confirmar refeição ({pending.length})
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
          🍽️ Registrar refeição em linguagem natural
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            placeholder="Ex: comi um iogurte, uma laranja e duas fatias de pão integral"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
            style={inputStyle}
          />
          <button onClick={analyze} className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: C.orange, color: "#1a0a02" }}>
            Analisar
          </button>
        </div>

        {preview && (
          <div className="mt-4 rounded-lg p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            {preview.items.length ? (
              <>
                <div className="space-y-2">
                  {preview.items.map((it, i) => {
                    const updItem = (patch) => {
                      const items = preview.items.map((x, j) => (j === i ? { ...x, ...patch } : x));
                      const totals = items.reduce(
                        (acc, x) => ({
                          kcal: acc.kcal + (x.kcal || 0),
                          protein: +(acc.protein + (x.protein || 0)).toFixed(1),
                          carbs: +(acc.carbs + (x.carbs || 0)).toFixed(1),
                          fat: +(acc.fat + (x.fat || 0)).toFixed(1),
                        }),
                        { kcal: 0, protein: 0, carbs: 0, fat: 0 },
                      );
                      setPreview({ ...preview, items, totals: { label: "Total", ...totals } });
                    };
                    const setQty = (unit, rawQty) => {
                      const qty = Math.max(0, Math.round(parseFloat(rawQty) || 0));
                      let grams;
                      if (unit === "unidade") {
                        // escalar os gramas proporcionalmente ao nº de unidades
                        const oldQty = it.quantity || 1;
                        grams = it.unit === "unidade" && it.grams ? Math.round((it.grams * qty) / oldQty) : it.grams || qty;
                      } else {
                        grams = qty;
                      }
                      const s = (v) => (grams > 0 ? (v * grams) / 100 : 0);
                      updItem({
                        unit,
                        quantity: qty,
                        grams,
                        kcal: Math.round(s(it.kcal_100 || 0)),
                        protein: +s(it.protein_100 || 0).toFixed(1),
                        carbs: +s(it.carbs_100 || 0).toFixed(1),
                        fat: +s(it.fat_100 || 0).toFixed(1),
                      });
                    };
                    return (
                      <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span style={{ color: C.text }}>
                          {(it.origin === "openfoodfacts" || it.origin === "fatsecret") && (
                            <span
                              title={
                                it.origin === "fatsecret"
                                  ? "valores reais do FatSecret"
                                  : "valores reais do Open Food Facts"
                              }
                              style={{ color: C.green }}
                            >
                              {it.origin === "fatsecret" ? "FS" : "OFF"}{" "}
                            </span>
                          )}
                          {it.estimated && (
                            <span title="estimado pelo LLM — sem produto na base" style={{ color: C.orange }}>≈ </span>
                          )}
                          {it.needs_review && <span title="unidade ou quantidade incerta — confirma" style={{ color: C.orange }}>⚠ </span>}
                          {it.label}
                        </span>
                        <span className="flex items-center gap-2">
                          <input
                            type="number"
                            className="w-16 rounded-lg px-2 py-1 text-xs outline-none"
                            value={it.unit === "unidade" ? it.quantity : it.grams}
                            onChange={(e) => setQty(it.unit || "g", e.target.value)}
                            style={inputStyle}
                          />
                          <select
                            className="rounded-lg px-1.5 py-1 text-xs outline-none"
                            value={it.unit || "g"}
                            onChange={(e) => setQty(e.target.value, it.unit === "unidade" ? it.quantity : it.grams)}
                            style={inputStyle}
                          >
                            <option value="g">g</option>
                            <option value="ml">ml</option>
                            <option value="unidade">un.</option>
                          </select>
                          <span className="text-xs" style={{ color: C.muted }}>
                            {it.kcal} kcal · P{it.protein} C{it.carbs} G{it.fat}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: C.border }}>
                  <span className="text-sm font-semibold" style={{ color: C.text }}>Total</span>
                  <span className="text-sm font-bold" style={{ color: C.orange }}>
                    {(preview.totals || {}).kcal || 0} kcal · P{(preview.totals || {}).protein || 0} C{(preview.totals || {}).carbs || 0} G{(preview.totals || {}).fat || 0}
                  </span>
                </div>
                {preview.unknown?.length > 0 && (
                  <p className="mt-2 text-xs" style={{ color: C.muted }}>
                    Não reconhecido: {preview.unknown.join(", ")}
                  </p>
                )}
                {preview.llmError && (
                  <p className="mt-1 text-xs" style={{ color: C.orange }}>
                    LLM indisponível: {preview.llmError}
                  </p>
                )}
                <button onClick={confirm} className="mt-3 w-full rounded-lg py-2 text-sm font-semibold" style={{ background: C.green, color: "#052e12" }}>
                  Confirmar refeição
                </button>
              </>
            ) : (
              <p className="text-sm" style={{ color: C.muted }}>Nenhum alimento reconhecido. Tenta: "1 iogurte, 1 banana, 2 fatias de pão integral".</p>
            )}
            {!preview.items.length && preview.unknown?.length > 0 && (
              <p className="mt-2 text-xs" style={{ color: C.muted }}>
                Não reconhecido: {preview.unknown.join(", ")}
              </p>
            )}
            {!preview.items.length && preview.llmError && (
              <p className="mt-1 text-xs" style={{ color: C.orange }}>
                LLM indisponível: {preview.llmError}
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <p className="mb-3 text-center text-xs" style={{ color: C.muted }}>
          Metas de perda de peso: {goals.kcal} kcal · P{goals.protein}g · C{goals.carbs}g · G{goals.fat}g
          {weight ? ` (peso atual ${weight} kg)` : ""}
        </p>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Ring value={todayTotals.kcal} max={goals.kcal} label={`Ingerido (${goals.kcal})`} unit="kcal" color={C.teal} />
          <Ring value={todayTotals.protein} max={goals.protein} label={`Proteína (${goals.protein}g)`} unit="g" color={C.orange} />
          <Ring value={todayTotals.carbs} max={goals.carbs} label={`Carboidrato (${goals.carbs}g)`} unit="g" color={C.blue} />
          <Ring value={todayTotals.fat} max={goals.fat} label={`Gordura (${goals.fat}g)`} unit="g" color={C.purple} />
        </div>
        <p className="mt-4 text-center text-xs" style={{ color: C.muted }}>
          Balanço de hoje (ingeridas − ativas):{" "}
          <span style={{ color: todayTotals.kcal - (burnedToday || 0) < 0 ? C.green : C.red }}>
            {(todayTotals.kcal - (burnedToday || 0)).toLocaleString("pt-BR")} kcal
          </span>{" "}
          · vs. meta {goals.kcal}:{" "}
          <span style={{ color: todayTotals.kcal <= goals.kcal ? C.green : C.orange }}>
            {(todayTotals.kcal - goals.kcal >= 0 ? "+" : "") + (todayTotals.kcal - goals.kcal).toLocaleString("pt-BR")}
          </span>
        </p>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2 px-2">
          <h3 className="text-sm font-semibold" style={{ color: C.text }}>
            {chartMode === "macros"
              ? "Macros por dia (14d)"
              : chartMode === "water"
                ? "Hidratação (14d)"
                : "Balanço diário (desde 05/10)"}
          </h3>
          <div className="flex gap-1.5">
            {[
              { id: "macros", label: "Macros" },
              { id: "water", label: "Hidratação" },
              { id: "balance", label: "Balanço" },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setChartMode(m.id)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: chartMode === m.id ? C.teal : C.card,
                  color: chartMode === m.id ? "#04141a" : C.muted,
                  border: `1px solid ${chartMode === m.id ? C.teal : C.border}`,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {chartMode === "macros" ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={macroByDay}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="protein" stackId="m" fill={C.orange} name="Proteína (g)" />
              <Bar dataKey="carbs" stackId="m" fill={C.blue} name="Carbo (g)" />
              <Bar dataKey="fat" stackId="m" fill={C.purple} name="Gordura (g)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : chartMode === "water" ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={waterByDay}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} unit=" ml" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} ml`, "Água"]} />
              <ReferenceLine
                y={3000}
                stroke={C.teal}
                strokeDasharray="4 4"
                label={{ value: "meta 3L", position: "insideTopRight", fontSize: 10, fill: C.teal }}
              />
              <Bar dataKey="water" fill={C.blue} name="Água (ml)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={balanceByDay}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} unit=" kcal" />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload || {};
                  return (
                    <div className="rounded-lg p-2 text-xs" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                      <div className="mb-1 font-semibold" style={{ color: C.text }}>{d.label}</div>
                      <div style={{ color: C.teal }}>Ingeridas: {d.in.toLocaleString("pt-BR")} kcal</div>
                      <div style={{ color: C.orange }}>Ativas: {d.out.toLocaleString("pt-BR")} kcal</div>
                      {d.workout > 0 && (
                        <div style={{ color: C.muted }}>
                          treino: {d.workout.toLocaleString("pt-BR")} kcal (já incl. nas ativas)
                        </div>
                      )}
                      <div style={{ color: C.purple }}>Líquido: {d.net.toLocaleString("pt-BR")} kcal</div>
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={C.muted} strokeDasharray="2 2" />
              <Bar dataKey="in" fill={C.teal} name="Ingeridas (kcal)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="out" fill={C.orange} name="Ativas queimadas (kcal)" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="net" stroke={C.purple} strokeWidth={2} dot={{ r: 2 }} name="Líquido (in − out)" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Refeições registradas
        </h3>
        <div className="space-y-2">
          {meals.length === 0 && (
            <p className="text-sm" style={{ color: C.muted }}>Nenhuma refeição ainda — usa o campo acima ✨</p>
          )}
          {mealsByDay.map((g) => {
            const dayKcal = Math.round(
              g.meals.reduce((s, m) => s + (m.totals || m).kcal, 0),
            );
            const open = openDays.has(g.date);
            return (
              <div key={g.date} className="mb-3">
                <button
                  onClick={() =>
                    setOpenDays((s) => {
                      const n = new Set(s);
                      if (n.has(g.date)) n.delete(g.date);
                      else n.add(g.date);
                      return n;
                    })
                  }
                  className="mb-1 flex w-full items-center justify-between px-3 py-1 rounded-lg transition-colors"
                  style={{ background: C.card2, border: `1px solid ${C.border}` }}
                  title={open ? "Fechar o dia" : "Ver as refeições do dia"}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.teal }}>
                    <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
                    {fmtDate(g.date)}
                  </span>
                  <span className="text-xs" style={{ color: C.muted }}>
                    {dayKcal.toLocaleString("pt-BR")} kcal · {g.meals.length} refeiç{g.meals.length === 1 ? "ão" : "ões"}
                  </span>
                </button>
                {open && g.meals.map((m) => {
                  const t = m.totals || m;
                  return (
                    <div
                      key={m.id}
                      className="mb-1 flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ background: C.card2, border: `1px solid ${C.border}` }}
                    >
                      <div>
                        <div className="text-sm" style={{ color: C.text }}>{m.text}</div>
                        <div className="text-xs" style={{ color: C.muted }}>
                          {m.time} · P{t.protein} C{t.carbs} G{t.fat}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold" style={{ color: C.orange }}>{t.kcal} kcal</span>
                        <button
                          onClick={async () => { await api.deleteMeal(m.id); if (removeMeal) removeMeal(m.id); }}
                          className="text-xs"
                          style={{ color: C.red }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
