import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { C, axisProps, tooltipStyle } from "../theme.js";
import { api } from "../lib/api.js";
import { addDays, dateKey, dayMonth } from "../lib/garmin.js";

const PERIODS = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "year", label: "1 ano", days: 365 },
  { id: "all", label: "Tudo", days: null },
];

export default function MetricDetail({ metric, onClose }) {
  const [periodId, setPeriodId] = useState("30d");
  const [series, setSeries] = useState(null);
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
    })();
    return () => {
      alive = false;
    };
  }, [periodId, metric.key]);

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
    v == null ? "—" : metric.decimals ? v.toFixed(1) : Math.round(v).toLocaleString("pt-BR");

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(5,8,12,.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="mx-auto max-w-4xl rounded-2xl p-5 sm:p-6"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: C.text }}>
              {metric.title}
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              {period.label} · {stats ? `${stats.count} dias com dados` : "a carregar…"}
            </p>
          </div>
          <div className="flex items-center gap-3">
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

        {stats && (
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

        {series === null ? (
          <p className="py-10 text-center text-sm" style={{ color: C.muted }}>
            A carregar…
          </p>
        ) : series.length < 2 ? (
          <p className="py-10 text-center text-sm" style={{ color: C.muted }}>
            Sem dados suficientes neste período.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="gMetric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={metric.color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={metric.color} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} minTickGap={16} />
              <YAxis {...axisProps} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [`${fmt(v)} ${metric.unit}`, metric.title]}
              />
              {stats && <ReferenceLine y={stats.avg} stroke={C.muted} strokeDasharray="4 4" />}
              <Area
                type="monotone"
                dataKey="value"
                stroke={metric.color}
                strokeWidth={2}
                fill="url(#gMetric)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
