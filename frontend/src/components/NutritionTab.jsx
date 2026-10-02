import React, { useMemo, useState } from "react";
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
import { daily, todayIso } from "../lib/mock.js";
import { api } from "../lib/api.js";

export default function NutritionTab({ meals, addMeal, removeMeal }) {
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState(null);

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

  const todayMeals = meals.filter((m) => m.date === todayIso);
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

  const burnedToday = daily[daily.length - 1].caloriesBurned;

  const macroByDay = useMemo(
    () =>
      daily.map((d) => {
        const dayMeals = meals.filter((m) => m.date === d.label);
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
        return { label: d.label, ...t, queimadas: d.caloriesBurned };
      }),
    [meals]
  );

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div className="space-y-6">
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
                      <span style={{ color: C.text }}>{it.label} <span style={{ color: C.muted }}>({it.grams}g)</span></span>
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
                <button onClick={confirm} className="mt-3 w-full rounded-lg py-2 text-sm font-semibold" style={{ background: C.green, color: "#052e12" }}>
                  Confirmar refeição
                </button>
              </>
            ) : (
              <p className="text-sm" style={{ color: C.muted }}>Nenhum alimento reconhecido. Tenta: "1 iogurte, 1 banana, 2 fatias de pão integral".</p>
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
          Balanço de hoje: <span style={{ color: todayTotals.kcal - burnedToday < 0 ? C.green : C.red }}>
            {(todayTotals.kcal - burnedToday).toLocaleString("pt-BR")} kcal
          </span>{" "}
          (ingeridas {todayTotals.kcal} − queimadas {burnedToday})
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
