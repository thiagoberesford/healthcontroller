import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { C, axisProps, tooltipStyle, tickInterval } from "../theme.js";
import { api } from "../lib/api.js";
import { addDays, dateKey, dayMonth } from "../lib/garmin.js";

const PERIODS = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "year", label: "1 ano", days: 365 },
  { id: "all", label: "Tudo", days: null },
];

/* métricas comparáveis (C1) */
const CMP = {
  sleep: { key: "sleep_hours", label: "Sono", color: C.purple, unit: "h", decimals: true },
  hrv: { key: "hrv", label: "HRV", color: C.teal, unit: "ms" },
  resting_hr: { key: "resting_hr", label: "FC repouso", color: C.red, unit: "bpm" },
  weight: { key: "weight", label: "Peso", color: C.orange, unit: "kg", decimals: true },
  load7: { key: "load7", label: "Carga semanal", color: C.blue, unit: "TSS" },
  balance: { key: "balance", label: "Balanço calórico", color: C.green, unit: "kcal" },
  steps: { key: "steps", label: "Passos", color: C.blue, unit: "" },
  active: { key: "active_kcal", label: "Calorias ativas", color: C.orange, unit: "kcal" },
};
const PRESETS = [
  { id: "hrv_load", label: "HRV vs. carga", a: "hrv", b: "load7" },
  { id: "bal_weight", label: "Balanço vs. peso", a: "balance", b: "weight" },
];

/* carrega uma série por chave (data -> valor) */
async function loadMetric(key, start, end) {
  if (["sleep_hours", "hrv", "resting_hr", "steps", "active_kcal"].includes(key)) {
    const daily = await api.listGarminDaily(start, end);
    const m = {};
    for (const d of daily) if (d[key] != null) m[d.date] = d[key];
    return m;
  }
  if (key === "weight") {
    const rows = await api.listBody();
    const m = {};
    for (const r of rows) {
      if (r.weight && r.date >= start && r.date <= end) m[r.date.slice(0, 10)] = r.weight;
    }
    return m;
  }
  if (key === "load7") {
    const rows = await api.listTrainingLoad(start, end);
    const m = {};
    let win = [];
    for (const r of rows) {
      win.push(r.tss || 0);
      if (win.length > 7) win.shift();
      m[r.date] = win.reduce((s, v) => s + v, 0);
    }
    return m;
  }
  if (key === "balance") {
    const [daily, meals] = await Promise.all([
      api.listGarminDaily(start, end),
      api.listMeals(),
    ]);
    const inK = {};
    for (const mm of meals || []) {
      const d = String(mm.date).slice(0, 10);
      inK[d] = (inK[d] || 0) + ((mm.totals || mm).kcal || 0);
    }
    const m = {};
    for (const d of daily) {
      const din = inK[d.date] || 0;
      const dout = d.active_kcal || 0;
      if (din || dout) m[d.date] = Math.round(din - dout);
    }
    return m;
  }
  return {};
}

export default function MetricDetail({ metric, onClose }) {
  const [periodId, setPeriodId] = useState("30d");
  const [series, setSeries] = useState(null);
  const [cmpKey, setCmpKey] = useState(null); // chave da 2.ª métrica
  const [cmpSeries, setCmpSeries] = useState(null);
  const period = PERIODS.find((p) => p.id === periodId);

  useEffect(() => {
    let alive = true;
    (async () => {
      setSeries(null);
      const today = new Date();
      const end = dateKey(today);
      const start = period.days ? addDays(end, -(period.days - 1)) : "2019-06-26";
      const daily = await api.listGarminDaily(start, end);
      if (!alive) return;
      setSeries(
        daily
          .filter((d) => d[metric.key])
          .map((d) => ({ label: dayMonth(d.date), value: d[metric.key] })),
      );
      if (cmpKey) {
        const cmpMap = await loadMetric(cmpKey, start, end);
        if (!alive) return;
        const dailyMap = {};
        for (const d of daily) dailyMap[d.date] = true;
        setCmpSeries(
          Object.entries(cmpMap)
            .filter(([d]) => dailyMap[d] || true)
            .sort()
            .map(([d, v]) => ({ label: dayMonth(d), value: v })),
        );
      } else {
        setCmpSeries(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [periodId, metric.key, cmpKey]);

  const stats = useMemo(() => {
    if (!series || !series.length) return null;
    const vals = series.map((s) => s.value);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return {
      avg: metric.decimals ? +avg.toFixed(1) : Math.round(avg),
      max: metric.decimals ? +Math.max(...vals).toFixed(1) : Math.max(...vals),
      min: metric.decimals ? +Math.min(...vals).toFixed(1) : Math.min(...vals),
      current: series[series.length - 1].value,
      count: series.length,
    };
  }, [series, metric.decimals]);

  const fmt = (v) =>
    v == null ? "—" : metric.decimals ? v.toFixed(1) : Math.round(v).toLocaleString("pt-PT");

  const cmp = cmpKey ? CMP[cmpKey] : null;

  /* conjunto combinado por ordem temporal para o gráfico duplo */
  const combined = useMemo(() => {
    if (!cmpSeries || !cmp) return null;
    const aMap = {};
    (series || []).forEach((s) => (aMap[s.label] = s.value));
    const out = [];
    const seen = new Set();
    [...(series || []).map((s) => s.label), ...cmpSeries.map((s) => s.label)].forEach((l) => {
      if (seen.has(l)) return;
      seen.add(l);
      out.push({ label: l, a: aMap[l] ?? null });
    });
    const bMap = {};
    cmpSeries.forEach((s) => (bMap[s.label] = s.value));
    out.forEach((r) => (r.b = bMap[r.label] ?? null));
    return out;
  }, [series, cmpSeries, cmp]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(5,8,12,.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:max-h-[92vh] max-sm:overflow-y-auto max-sm:rounded-b-none mx-auto max-w-4xl rounded-2xl p-5 sm:p-6"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full sm:hidden" style={{ background: C.border }} />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: C.text }}>
              {metric.title}
              {cmp ? ` vs. ${cmp.label}` : ""}
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              {period.label} · {stats ? `${stats.count} dias com dados` : "a carregar…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriodId(p.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                  style={{
                    background: p.id === periodId ? C.teal : C.card2,
                    color: p.id === periodId ? "#04141a" : C.muted,
                    border: `1px solid ${p.id === periodId ? C.teal : C.border}`,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
            >
              Fechar
            </button>
          </div>
        </div>

        {/* C1: comparação de métricas */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: C.muted }}>Comparar com:</span>
          <select
            className="rounded-lg px-2 py-1 text-xs outline-none"
            value={cmpKey ?? ""}
            onChange={(e) => setCmpKey(e.target.value || null)}
            style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
          >
            <option value="">—</option>
            {Object.entries(CMP)
              .filter(([k]) => k !== metric.key)
              .map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
          </select>
          <span className="ml-2 text-xs" style={{ color: C.muted }}>Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setCmpKey(p.b)}
              className="rounded-lg px-2 py-1 text-[10px] font-semibold"
              style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
              title={`${CMP[p.a].label} vs. ${CMP[p.b].label}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {stats && !cmp && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Atual", value: fmt(stats.current) },
              { label: "Média", value: fmt(stats.avg) },
              { label: "Máx", value: fmt(stats.max) },
              { label: "Mín", value: fmt(stats.min) },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl p-3"
                style={{ background: C.card2, border: `1px solid ${C.border}` }}
              >
                <div className="text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>
                  {s.label}
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold" style={{ color: metric.color }}>
                    {s.value}
                  </span>
                  <span className="text-[10px]" style={{ color: C.muted }}>
                    {metric.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {cmp && combined ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={combined}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} interval={tickInterval(combined.length)} />
              <YAxis yAxisId="l" {...axisProps} stroke={metric.color} />
              <YAxis yAxisId="r" orientation="right" {...axisProps} stroke={cmp.color} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line yAxisId="l" type="monotone" dataKey="a" stroke={metric.color} strokeWidth={2} dot={false} name={metric.title} connectNulls />
              <Line yAxisId="r" type="monotone" dataKey="b" stroke={cmp.color} strokeWidth={2} dot={false} name={cmp.label} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : series && series.length > 1 ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="gM" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metric.color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={metric.color} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} interval={tickInterval(series.length)} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              {metric.key === "hrv" && stats && (
                <ReferenceLine y={stats.avg} stroke={C.muted} strokeDasharray="4 4" />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={metric.color}
                strokeWidth={2}
                fill="url(#gM)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm" style={{ color: C.muted }}>
            Sem dados suficientes.
          </p>
        )}
      </div>
    </div>
  );
}
