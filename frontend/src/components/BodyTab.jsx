import React, { useState } from "react";
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
import { bodyMeasurements } from "../lib/mock.js";
import { api } from "../lib/api.js";

export default function BodyTab({ onSaved }) {
  const [weight, setWeight] = useState("");
  const [muscle, setMuscle] = useState("");
  const [fat, setFat] = useState("");

  const data = bodyMeasurements;
  const latest = data[data.length - 1];
  const first = data[0];

  const submit = async (e) => {
    e.preventDefault();
    const w = parseFloat(weight.replace(",", "."));
    if (!w) return;
    await api.addBody({
      weight_kg: w,
      muscle_kg: muscle ? parseFloat(muscle.replace(",", ".")) : null,
      fat_pct: fat ? parseFloat(fat.replace(",", ".")) : null,
      source: "manual",
    });
    setWeight("");
    setMuscle("");
    setFat("");
    if (onSaved) onSaved();
  };

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Peso atual" value={latest.weight} unit="kg" delta={`${(latest.weight - first.weight).toFixed(1)} kg`} color={C.teal} />
        <StatCard label="Massa muscular" value={latest.muscle} unit="kg" delta={`+${(latest.muscle - first.muscle).toFixed(1)} kg`} color={C.orange} />
        <StatCard label="Gordura" value={latest.fat} unit="%" delta={`${(latest.fat - first.fat).toFixed(1)} pp`} color={C.red} />
        <StatCard label="IMC" value={latest.bmi} unit="" color={C.blue} />
      </div>

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
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            Peso × Massa muscular
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
              <YAxis yAxisId="l" {...axisProps} domain={[78, 84]} />
              <YAxis yAxisId="r" orientation="right" {...axisProps} domain={[33, 36]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area yAxisId="l" type="monotone" dataKey="weight" stroke={C.teal} fill="url(#gW)" strokeWidth={2} name="Peso (kg)" />
              <Line yAxisId="r" type="monotone" dataKey="muscle" stroke={C.orange} strokeWidth={2} dot={false} name="Músculo (kg)" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            % Gordura × % Água
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="fat" stroke={C.red} fill={C.red} fillOpacity={0.15} strokeWidth={2} name="Gordura (%)" />
              <Area type="monotone" dataKey="water" stroke={C.blue} fill={C.blue} fillOpacity={0.08} strokeWidth={2} name="Água (%)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Medidas
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
                <th className="px-3 py-2">Visceral</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((b) => (
                <tr key={b.date} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td className="px-3 py-2" style={{ color: C.muted }}>{b.label}</td>
                  <td className="px-3 py-2" style={{ color: C.text }}>{b.weight} kg</td>
                  <td className="px-3 py-2" style={{ color: C.orange }}>{b.muscle} kg</td>
                  <td className="px-3 py-2" style={{ color: C.red }}>{b.fat}%</td>
                  <td className="px-3 py-2" style={{ color: C.text }}>{b.bmi}</td>
                  <td className="px-3 py-2" style={{ color: C.muted }}>{b.visceral}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
