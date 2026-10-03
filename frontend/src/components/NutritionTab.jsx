import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, Ring } from "./ui.jsx";
import { C, axisProps, tooltipStyle } from "../theme.js";
import { api } from "../lib/api.js";
import { addDays, dateKey, dayMonth } from "../lib/garmin.js";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function NutritionTab({ meals, addMeal, removeMeal }) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState(null);
  const [burnedToday, setBurnedToday] = useState(null);

  const [foods, setFoods] = useState([]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState([]);
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ name: "", kcal: "", protein: "", carbs: "", fat: "", portion: "" });
  const [customMsg, setCustomMsg] = useState(null);

  const loadFoods = () => api.listFoods().then(setFoods);

  useEffect(() => {
    loadFoods();
    (async () => {
      const today = dateKey(new Date());
      const d = await api.listGarminDaily(today, today);
      setBurnedToday(d.length ? d[0].total_kcal : 0);
    })();
  }, []);

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
                <div className="space-y-1">
                  {preview.items.map((it, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span style={{ color: C.text }}>
                        {it.estimated && (
                          <span title="estimado pelo LLM — sem produto exato na base" style={{ color: C.orange }}>≈ </span>
                        )}
                        {it.label} <span style={{ color: C.muted }}>({it.grams}g)</span>
                      </span>
                      <span style={{ color: C.muted }}>{it.kcal} kcal · P{it.protein} C{it.carbs} G{it.fat}</span>
                    </div>
                  ))}
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
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Ring value={todayTotals.kcal} max={2800} label="Ingerido" unit="kcal" color={C.teal} />
          <Ring value={todayTotals.protein} max={160} label="Proteína" unit="g" color={C.orange} />
          <Ring value={todayTotals.carbs} max={320} label="Carboidrato" unit="g" color={C.blue} />
          <Ring value={todayTotals.fat} max={80} label="Gordura" unit="g" color={C.purple} />
        </div>
        <p className="mt-4 text-center text-xs" style={{ color: C.muted }}>
          Balanço de hoje:{" "}
          <span style={{ color: todayTotals.kcal - (burnedToday || 0) < 0 ? C.green : C.red }}>
            {(todayTotals.kcal - (burnedToday || 0)).toLocaleString("pt-BR")} kcal
          </span>{" "}
          (ingeridas {todayTotals.kcal} − queimadas {burnedToday ?? "…"})
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Macros por dia (14d)
        </h3>
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
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Refeições registradas
        </h3>
        <div className="space-y-2">
          {meals.length === 0 && (
            <p className="text-sm" style={{ color: C.muted }}>Nenhuma refeição ainda — usa o campo acima ✨</p>
          )}
          {meals.slice(0, 12).map((m) => {
            const t = m.totals || m;
            return (
              <div key={m.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
                <div>
                  <div className="text-sm" style={{ color: C.text }}>{m.text}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{m.date} {m.time} · P{t.protein} C{t.carbs} G{t.fat}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold" style={{ color: C.orange }}>{t.kcal} kcal</span>
                  <button onClick={async () => { await api.deleteMeal(m.id); if (removeMeal) removeMeal(m.id); }} className="text-xs" style={{ color: C.red }}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
