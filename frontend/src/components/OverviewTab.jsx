import React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, Ring, StatCard } from "./ui.jsx";
import { C, axisProps, tooltipStyle, fmtTime } from "../theme.js";
import { daily, activities } from "../lib/mock.js";

export default function OverviewTab({ meals }) {
  const last = daily[daily.length - 1];
  const prevWeek = daily.slice(0, 7);
  const avg = (arr, key) =>
    +(arr.reduce((s, d) => s + d[key], 0) / arr.length).toFixed(0);

  const kcalInToday = meals
    .filter((m) => m.date === new Date().toISOString().slice(0, 10))
    .reduce((s, m) => s + (m.totals ? m.totals.kcal : m.kcal || 0), 0);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Ring value={last.steps} max={10000} label="Passos" unit="passos" color={C.blue} />
          <Ring value={last.activeCalories} max={800} label="Calorias ativas" unit="kcal" color={C.orange} />
          <Ring value={last.sleepHours} max={9} label="Sono" unit="horas" color={C.purple} />
          <Ring value={last.load} max={700} label="Carga treino" unit="load" color={C.teal} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="FC repouso" value={last.restingHr} unit="bpm" delta="-2 bpm" color={C.red} />
        <StatCard label="HRV (média 7d)" value={avg(prevWeek, "hrv")} unit="ms" delta="+4 ms" color={C.green} />
        <StatCard label="Gasto diário" value={last.caloriesBurned} unit="kcal" color={C.orange} />
        <StatCard label="Ingerido hoje" value={kcalInToday || 0} unit="kcal" color={C.teal} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            Carga de treino (14 dias)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="gLoad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.teal} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={C.teal} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="load" stroke={C.teal} fill="url(#gLoad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            Sono vs. FC repouso
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={daily}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis yAxisId="l" {...axisProps} domain={[4, 9]} />
              <YAxis yAxisId="r" orientation="right" {...axisProps} domain={[45, 70]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line yAxisId="l" type="monotone" dataKey="sleepHours" stroke={C.purple} strokeWidth={2} dot={false} />
              <Line yAxisId="r" type="monotone" dataKey="restingHr" stroke={C.red} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Atividades recentes
        </h3>
        <div className="space-y-2">
          {activities.slice(0, 5).map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg px-3 py-2"
              style={{ background: C.card2, border: `1px solid ${C.border}` }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                  style={{
                    background: C.card,
                    color:
                      a.type === "Corrida" ? C.blue : a.type === "Força" ? C.orange : C.muted,
                  }}
                >
                  {a.type}
                </span>
                <span className="text-sm" style={{ color: C.text }}>
                  {a.name}
                </span>
              </div>
              <div className="flex gap-4 text-xs" style={{ color: C.muted }}>
                <span>{a.date}</span>
                {a.km > 0 && <span>{a.km.toFixed(1)} km</span>}
                <span>{fmtTime(a.time)}</span>
                <span style={{ color: C.orange }}>{a.kcal} kcal</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
