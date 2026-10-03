import React, { useEffect, useState } from "react";
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
import { api } from "../lib/api.js";
import { addDays, dateKey, dayMonth } from "../lib/garmin.js";
import { TYPE_LABEL, TYPE_COLOR, fmtDate, fmtKcal } from "../lib/garmin.js";

export default function OverviewTab({ meals }) {
  const [daily, setDaily] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    (async () => {
      const today = new Date();
      const start = addDays(dateKey(today), -13);
      const list = await api.listGarminDaily(start, dateKey(today));
      setDaily(list.map((d) => ({
        label: dayMonth(d.date),
        steps: d.steps,
        activeCalories: d.active_kcal,
        sleepHours: d.sleep_hours,
        restingHr: d.resting_hr,
        hrv: d.hrv,
        intenseMin: d.intense_min,
        caloriesBurned: d.total_kcal,
      })));
      const acts = await api.listGarminActivities();
      setRecent(acts.slice(0, 5));
    })();
  }, []);

  const last = daily && daily.length ? daily[daily.length - 1] : null;
  const prevWeek = daily ? daily.slice(0, 7) : [];
  const avg = (arr, key) =>
    arr.length
      ? +(arr.reduce((s, d) => s + (d[key] || 0), 0) / arr.filter((d) => d[key]).length).toFixed(0)
      : "—";

  const kcalInToday = meals
    .filter((m) => m.date === new Date().toISOString().slice(0, 10))
    .reduce((s, m) => s + (m.totals ? m.totals.kcal : m.kcal || 0), 0);

  return (
    <div className="space-y-6">
      {!last ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          A carregar dados do Supabase… (se não aparecer, verifique VITE_SUPABASE_URL/ANON_KEY)
        </Card>
      ) : (
      <Card className="p-6">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Ring value={last.steps || 0} max={10000} label="Passos" unit="passos" color={C.blue} />
          <Ring value={last.activeCalories || 0} max={800} label="Calorias ativas" unit="kcal" color={C.orange} />
          <Ring value={last.sleepHours || 0} max={9} label="Sono" unit="horas" color={C.purple} />
          <Ring value={last.hrv || 0} max={90} label="HRV noite" unit="ms" color={C.teal} />
        </div>
      </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="FC repouso" value={last?.restingHr ?? "—"} unit="bpm" color={C.red} />
        <StatCard label="HRV (média 7d)" value={avg(prevWeek, "hrv")} unit="ms" color={C.green} />
        <StatCard label="Gasto diário" value={last?.caloriesBurned ?? "—"} unit="kcal" color={C.orange} />
        <StatCard label="Ingerido hoje" value={kcalInToday || 0} unit="kcal" color={C.teal} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            Passos (14 dias)
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily || []}>
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
              <Area type="monotone" dataKey="steps" stroke={C.teal} fill="url(#gLoad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
            Sono vs. FC repouso
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={daily || []}>
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
          {recent.length === 0 ? (
            <div className="py-4 text-center text-xs" style={{ color: C.muted }}>
              Sem atividades no Supabase — corra o import (backend/scripts/import_supabase.py).
            </div>
          ) : (
            recent.map((a) => (
              <div
                key={a.source_key || a.id}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: C.card2, border: `1px solid ${C.border}` }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      background: C.card,
                      color: TYPE_COLOR[a.type] || C.muted,
                    }}
                  >
                    {TYPE_LABEL[a.type] || a.type}
                  </span>
                  <span className="text-sm" style={{ color: C.text }}>
                    {a.name}
                  </span>
                </div>
                <div className="flex gap-4 text-xs" style={{ color: C.muted }}>
                  <span>{fmtDate(a.start)}</span>
                  {a.distance_km > 0 && <span>{a.distance_km.toFixed(1)} km</span>}
                  <span>{fmtTime(a.duration_s)}</span>
                  <span style={{ color: C.orange }}>{fmtKcal(a.kcal)} kcal</span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
