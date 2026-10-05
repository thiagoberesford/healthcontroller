import React, { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, StatCard } from "./ui.jsx";
import { C, axisProps, tooltipStyle } from "../theme.js";
import { api } from "../lib/api.js";
import { dayMonth } from "../lib/garmin.js";

const HEIGHT_M = 1.78;

export default function BodyTab({ onSaved, refreshKey }) {
  const [weight, setWeight] = useState("");
  const [muscle, setMuscle] = useState("");
  const [fat, setFat] = useState("");
  const [data, setData] = useState(null);

  const load = () => {
    api.listBody().then((rows) =>
      setData(
        rows.map((b) => ({
          label: dayMonth(b.date),
          date: b.date,
          weight: b.weight,
          muscle: b.muscle,
          fat: b.body_fat,
          water: b.water,
          visceral: b.visceral_fat,
          bmi: b.weight ? +(b.weight / (HEIGHT_M * HEIGHT_M)).toFixed(1) : null,
          source: b.source,
        })),
      ),
    );
  };

  useEffect(load, [refreshKey]);

  const [formMsg, setFormMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const w = parseFloat(weight.replace(",", "."));
    if (!w || Number.isNaN(w)) {
      setFormMsg("Peso inválido — ex.: 97,5");
      return;
    }
    setFormMsg(null);
    await api.addBody({
      weight_kg: w,
      muscle_kg: muscle ? parseFloat(muscle.replace(",", ".")) : null,
      fat_pct: fat ? parseFloat(fat.replace(",", ".")) : null,
      source: "manual",
    });
    setWeight("");
    setMuscle("");
    setFat("");
    load();
    if (onSaved) onSaved();
  };

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  const latest = data && data.length ? data[data.length - 1] : null;
  const first = data && data.length ? data[0] : null;

  return (
    <div className="space-y-6">
      {data === null ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          A carregar medidas…
        </Card>
      ) : !latest ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          Sem medidas — adiciona a primeira pesagem abaixo.
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Peso atual"
            value={latest.weight ?? "—"}
            unit="kg"
            delta={`${(latest.weight - first.weight).toFixed(1)} kg`}
            deltaLabel="desde a primeira"
            color={C.teal}
          />
          <StatCard label="Massa muscular" value={latest.muscle ?? "—"} unit="kg" color={C.orange} />
          <StatCard label="Gordura" value={latest.fat ?? "—"} unit="%" color={C.red} />
          <StatCard label="IMC" value={latest.bmi ?? "—"} unit="" color={C.blue} />
        </div>
      )}

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
          Registrar medida (balança Mi Scale / manual)
        </h3>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
          <input className="rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="Peso (kg)" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <input className="rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="Músculo (kg) — opc." value={muscle} onChange={(e) => setMuscle(e.target.value)} />
          <input className="rounded-lg px-3 py-2 text-sm outline-none" style={inputStyle} placeholder="Gordura (%) — opc." value={fat} onChange={(e) => setFat(e.target.value)} />
          <button type="submit" className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: C.teal, color: "#04141a" }}>
            Adicionar
          </button>
        </form>
        {formMsg && <p className="mt-2 text-xs" style={{ color: C.red }}>{formMsg}</p>}
      </Card>

      {data && data.length > 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
              Peso {latest?.muscle ? "× Massa muscular" : "(últimas medidas)"}
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data}>
                <defs>
                  <linearGradient id="gW" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.teal} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={C.teal} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis yAxisId="l" {...axisProps} domain={["auto", "auto"]} />
                {latest?.muscle && (
                  <YAxis yAxisId="r" orientation="right" {...axisProps} domain={["auto", "auto"]} />
                )}
                <Tooltip contentStyle={tooltipStyle} />
                <Area yAxisId="l" type="monotone" dataKey="weight" stroke={C.teal} fill="url(#gW)" strokeWidth={2} name="Peso (kg)" />
                {latest?.muscle && (
                  <Line yAxisId="r" type="monotone" dataKey="muscle" stroke={C.orange} strokeWidth={2} dot={false} name="Músculo (kg)" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {latest?.fat && (
            <Card className="p-4">
              <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
                % Gordura {latest?.water ? "× % Água" : ""}
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} domain={["auto", "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="fat" stroke={C.red} fill={C.red} fillOpacity={0.15} strokeWidth={2} name="Gordura (%)" />
                  {latest?.water && (
                    <Area type="monotone" dataKey="water" stroke={C.blue} fill={C.blue} fillOpacity={0.08} strokeWidth={2} name="Água (%)" />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      )}

      {data && data.length > 0 && (
        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            Medidas ({data.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: C.muted }}>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Peso</th>
                  <th className="px-3 py-2">Músculo</th>
                  <th className="px-3 py-2">Gordura</th>
                  <th className="px-3 py-2">IMC</th>
                  <th className="px-3 py-2">Fonte</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((b) => (
                  <tr key={b.date} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td className="px-3 py-2" style={{ color: C.muted }}>{b.label}</td>
                    <td className="px-3 py-2" style={{ color: C.text }}>{b.weight ?? "—"} kg</td>
                    <td className="px-3 py-2" style={{ color: C.orange }}>{b.muscle ?? "—"}</td>
                    <td className="px-3 py-2" style={{ color: C.red }}>{b.fat ?? "—"}{b.fat ? "%" : ""}</td>
                    <td className="px-3 py-2" style={{ color: C.text }}>{b.bmi ?? "—"}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: C.muted }}>{b.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
