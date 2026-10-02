import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, StatCard } from "./ui.jsx";
import { C, axisProps, tooltipStyle, fmtTime } from "../theme.js";
import { daily, activities } from "../lib/mock.js";

const typeColor = {
  Corrida: C.blue,
  "Força": C.orange,
  "Trail": C.green,
  "Descanso": C.muted,
};

export default function TrainingTab() {
  const weekKm = activities
    .filter((a) => a.type === "Corrida")
    .reduce((s, a) => s + a.km, 0);
  const weekKcal = activities.reduce((s, a) => s + a.kcal, 0);
  const sessions = activities.filter((a) => a.type !== "Descanso").length;

  const kmByDay = daily.map((d) => ({
    label: d.label,
    km: activities.find((a) => a.date === d.label)?.km || 0,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Treinos (14d)" value={sessions} unit="sessões" color={C.teal} />
        <StatCard label="Volume corrida" value={weekKm.toFixed(1)} unit="km" delta="+8%" color={C.blue} />
        <StatCard label="Gasto total" value={weekKcal} unit="kcal" color={C.orange} />
        <StatCard label="Carga média" value={Math.round(daily.reduce((s, d) => s + d.load, 0) / daily.length)} unit="load" color={C.purple} />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Km por dia
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={kmByDay}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="km" radius={[4, 4, 0, 0]}>
              {kmByDay.map((d, i) => (
                <Cell key={i} fill={d.km > 0 ? C.blue : C.border} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
          Histórico de sessões
        </h3>
        <div className="space-y-2">
          {activities.map((a, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg px-3 py-2.5"
              style={{ background: C.card2, border: `1px solid ${C.border}` }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: typeColor[a.type] || C.muted }}
                />
                <div>
                  <div className="text-sm font-medium" style={{ color: C.text }}>
                    {a.name}
                  </div>
                  <div className="text-xs" style={{ color: C.muted }}>
                    {a.date} · FC méd {a.hr || "—"} bpm
                  </div>
                </div>
              </div>
              <div className="flex gap-4 text-xs" style={{ color: C.muted }}>
                {a.km > 0 && <span>{a.km.toFixed(1)} km</span>}
                <span>{fmtTime(a.time)}</span>
                <span style={{ color: C.orange }}>{a.kcal} kcal</span>
                <span style={{ color: C.teal }}>load {a.load}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
