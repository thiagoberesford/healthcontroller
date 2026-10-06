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
import MetricDetail from "./MetricDetail.jsx";

/* métricas detalháveis: key = coluna em daily */
const METRICS = {
  steps: { key: "steps", title: "Passos", unit: "passos", color: C.blue },
  activeCalories: { key: "active_kcal", title: "Calorias ativas", unit: "kcal", color: C.orange },
  sleepHours: { key: "sleep_hours", title: "Sono", unit: "horas", color: C.purple, decimals: true },
  hrv: { key: "hrv", title: "HRV noite", unit: "ms", color: C.teal },
};
import { TYPE_LABEL, TYPE_COLOR, fmtDate, fmtKcal } from "../lib/garmin.js";

export default function OverviewTab({ meals, refreshKey }) {
  const [daily, setDaily] = useState(null);
  const [recent, setRecent] = useState([]);
  const [detail, setDetail] = useState(null);

  /* dados "ao vivo": carregar + refrescar a cada 60s e quando o
     separador volta a ficar visível (o sync do Mac corre à hora) */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const today = new Date();
      const start = addDays(dateKey(today), -90);
      const list = await api.listGarminDaily(start, dateKey(today));
      const mapped = list
        .filter((d) => d.steps || d.sleep_hours || d.hrv || d.vo2max)
        .map((d) => ({
          label: dayMonth(d.date),
          date: d.date,
          steps: d.steps,
          activeCalories: d.active_kcal,
          sleepHours: d.sleep_hours,
          restingHr: d.resting_hr,
          hrv: d.hrv,
          vo2max: d.vo2max,
          intenseMin: d.intense_min,
          caloriesBurned: d.total_kcal,
        }));
      if (!alive) return;
      setDaily(mapped.slice(-14));
      const acts = await api.listGarminActivities();
      if (alive) setRecent(acts.slice(0, 5));
    };
    load();
    const interval = setInterval(load, 60_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshKey]);

  const last = daily && daily.length ? daily[daily.length - 1] : null;
  const series = daily || [];
  // o sono de "hoje" só fica registado amanhã: o card mostra a última
  // noite completa (registo mais recente com horas de sono)
  const sleepLast = [...series].reverse().find((d) => d.sleepHours);
  const lastVo2 = [...series].reverse().find((d) => d.vo2max);
  const prevVo2 = lastVo2
    ? series.filter((d) => d.vo2max && d.date < lastVo2.date).slice(-30)
    : [];
  const vo2Prev = prevVo2.length
    ? +(prevVo2.reduce((s, d) => s + d.vo2max, 0) / prevVo2.length).toFixed(0)
    : null;
  const prevWeek = series.slice(-7);
  const avg = (arr, key) => {
    const vals = arr.filter((d) => d[key]);
    return vals.length ? +(vals.reduce((s, d) => s + d[key], 0) / vals.length).toFixed(0) : "—";
  };

  return (
    <div className="space-y-6">
      {daily === null ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          A carregar dados do Supabase… (se não aparecer, verifique VITE_SUPABASE_URL/ANON_KEY)
        </Card>
      ) : !last ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          Sem dados diários no Supabase — corra o import do snapshot.
        </Card>
      ) : (
      <Card className="p-6">
        <p className="mb-4 text-right text-[11px]" style={{ color: C.muted }}>
          dados de {fmtDate(last.date)}
        </p>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            { m: METRICS.steps, value: last.steps || 0, max: 10000, unit: "passos" },
            { m: METRICS.activeCalories, value: last.activeCalories || 0, max: 800, unit: "kcal" },
            { m: METRICS.sleepHours, value: sleepLast?.sleepHours || 0, max: 9, unit: "horas", date: sleepLast?.date },
            { m: METRICS.hrv, value: last.hrv || 0, max: 90, unit: "ms" },
          ].map(({ m, ...ringProps }) => (
            <div
              key={m.key}
              onClick={() => setDetail(m)}
              className="cursor-pointer rounded-xl transition-transform hover:scale-105"
              title={`Ver evolução de ${m.title}`}
            >
              <Ring {...ringProps} label={m.key === "sleep_hours" && sleepLast ? `${m.title} ${dayMonth(sleepLast.date)}` : m.title} color={m.color} />
            </div>
          ))}
        </div>
      </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="FC repouso" value={last?.restingHr ?? "—"} unit="bpm" color={C.red} />
        <StatCard label="HRV (média 7d)" value={avg(prevWeek, "hrv")} unit="ms" color={C.green} />
        <StatCard
          label={lastVo2 ? `VO₂ máx · ${dayMonth(lastVo2.date)}` : "VO₂ máx"}
          value={lastVo2?.vo2max ?? "—"}
          unit="ml/kg/min"
          delta={
            lastVo2 && vo2Prev
              ? `${lastVo2.vo2max >= vo2Prev ? "+" : ""}${lastVo2.vo2max - vo2Prev} vs. 30d`
              : null
          }
          deltaLabel="anteriores"
          color={C.blue}
        />
        <StatCard label="Gasto diário" value={last?.caloriesBurned ?? "—"} unit="kcal" color={C.orange} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          className="cursor-pointer p-4 transition-colors hover:brightness-110"
          onClick={() => setDetail(METRICS.steps)}
          title="Ver evolução de Passos"
        >
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

        <Card
          className="cursor-pointer p-4 transition-colors hover:brightness-110"
          onClick={() => setDetail(METRICS.sleepHours)}
          title="Ver evolução de Sono"
        >
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
      {detail && <MetricDetail metric={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}