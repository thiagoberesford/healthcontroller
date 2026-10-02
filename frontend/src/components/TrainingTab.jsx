import React, { useEffect, useMemo, useState } from "react";
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
import { api } from "../lib/api.js";

const PERIODS = [
  { id: "day", label: "Hoje", days: 1 },
  { id: "week", label: "7d", days: 7 },
  { id: "month", label: "30d", days: 30 },
  { id: "quarter", label: "90d", days: 90 },
  { id: "year", label: "1 ano", days: 365 },
  { id: "all", label: "Tudo", days: null },
];

const RUN_TYPES = new Set(["running", "treadmill_running", "trail_running"]);

const TYPE_LABEL = {
  running: "Corrida",
  treadmill_running: "Esteira",
  trail_running: "Trail",
  strength_training: "Força",
  indoor_cycling: "Bicicleta indoor",
  walking: "Caminhada",
  other: "Outro",
};
const TYPE_COLOR = {
  running: C.blue,
  treadmill_running: "#60a5fa",
  trail_running: C.teal,
  strength_training: C.orange,
  indoor_cycling: C.green,
  walking: C.muted,
  other: C.purple,
};

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
};

const fmtDate = (iso) => {
  const [y, m, day] = iso.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

const sumBy = (list, fn) => list.reduce((s, a) => s + (fn(a) || 0), 0);

const pctDelta = (curr, prev) => {
  if (!prev) return null;
  const pct = Math.round(((curr - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
};

export default function TrainingTab() {
  const [periodId, setPeriodId] = useState("month");
  const [acts, setActs] = useState(null);
  const [prevActs, setPrevActs] = useState([]);
  const [visible, setVisible] = useState(30);

  const period = PERIODS.find((p) => p.id === periodId);

  const { start, end } = useMemo(() => {
    if (!period.days) return { start: null, end: null };
    const today = new Date();
    return { start: addDays(dateKey(today), -(period.days - 1)), end: dateKey(today) };
  }, [period]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setActs(null);
      setVisible(30);
      const list = await api.listGarminActivities(start, end);
      if (!alive) return;
      setActs(list);
      if (start) {
        const prev = await api.listGarminActivities(
          addDays(start, -period.days),
          addDays(start, -1),
        );
        if (alive) setPrevActs(prev);
      } else if (alive) {
        setPrevActs([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [start, end, period]);

  const stats = useMemo(() => {
    if (!acts) return null;
    const runs = acts.filter((a) => RUN_TYPES.has(a.type));
    const km = +sumBy(runs, (a) => a.distance_km).toFixed(1);
    const kcal = Math.round(sumBy(acts, (a) => a.kcal));
    const time = sumBy(acts, (a) => a.duration_s);
    const kmPrev = prevActs.length
      ? +sumBy(prevActs.filter((a) => RUN_TYPES.has(a.type)), (a) => a.distance_km).toFixed(1)
      : 0;
    const kcalPrev = Math.round(sumBy(prevActs, (a) => a.kcal));
    return {
      sessions: acts.length,
      km,
      kcal,
      time,
      kmDelta: pctDelta(km, kmPrev),
      kcalDelta: pctDelta(kcal, kcalPrev),
    };
  }, [acts, prevActs]);

  /* Gráfico de km: bucket por dia (<=35d), semana (<=190d) ou mês (resto). */
  const chart = useMemo(() => {
    if (!acts) return { data: [], unit: "" };
    const days = period.days;
    const points = new Map();
    const add = (key, km) => points.set(key, +(points.get(key) || 0) + km);

    const runs = acts.filter((a) => RUN_TYPES.has(a.type));
    if (!days) {
      runs.forEach((a) => add(a.start.slice(0, 7), a.distance_km || 0));
      return { data: [...points.entries()].sort().map(([label, km]) => ({ label: `${label.slice(5, 7)}/${label.slice(2, 4)}`, km })), unit: "mês" };
    }
    if (days <= 35) {
      for (let i = 0; i < days; i++) points.set(addDays(end, -i), 0);
      runs.forEach((a) => add(a.start.slice(0, 10), a.distance_km || 0));
      return {
        data: [...points.entries()].sort().map(([label, km]) => ({
          label: `${label.slice(8, 10)}/${label.slice(5, 7)}`,
          km,
        })),
        unit: "dia",
      };
    }
    const byWeek = days <= 190;
    runs.forEach((a) => {
      const d = new Date(a.start.slice(0, 10) + "T12:00:00");
      if (byWeek) {
        const monday = addDays(dateKey(d), -((d.getDay() + 6) % 7));
        add(monday, a.distance_km || 0);
      } else {
        add(a.start.slice(0, 7), a.distance_km || 0);
      }
    });
    const entries = [...points.entries()].sort();
    return {
      data: entries.map(([label, km]) => ({
        label: byWeek
          ? `${label.slice(8, 10)}/${label.slice(5, 7)}`
          : `${label.slice(5, 7)}/${label.slice(2, 4)}`,
        km,
      })),
      unit: byWeek ? "semana" : "mês",
    };
  }, [acts, period, end]);

  const shown = acts ? acts.slice(0, visible) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: C.text }}>
          Treinos ({period.days ? period.label : "todo o histórico"})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriodId(p.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                background: p.id === periodId ? C.teal : C.card,
                color: p.id === periodId ? "#04141a" : C.muted,
                border: `1px solid ${p.id === periodId ? C.teal : C.border}`,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!stats ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          A carregar atividades…
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Sessões"
              value={stats.sessions}
              unit="treinos"
              color={C.teal}
            />
            <StatCard
              label="Volume corrida"
              value={stats.km}
              unit="km"
              delta={stats.kmDelta}
              deltaLabel="vs. período anterior"
              color={C.blue}
            />
            <StatCard
              label="Tempo total"
              value={fmtTime(stats.time)}
              color={C.purple}
            />
            <StatCard
              label="Gasto total"
              value={stats.kcal.toLocaleString("pt-BR")}
              unit="kcal"
              delta={stats.kcalDelta}
              deltaLabel="vs. período anterior"
              color={C.orange}
            />
          </div>

          <Card className="p-4">
            <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
              Km por {chart.unit}
            </h3>
            {chart.data.length === 0 ? (
              <div className="py-10 text-center text-xs" style={{ color: C.muted }}>
                Sem corridas neste período.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chart.data}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="label" {...axisProps} minTickGap={8} />
                  <YAxis {...axisProps} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => [`${v} km`, "corrida"]}
                  />
                  <Bar dataKey="km" radius={[4, 4, 0, 0]}>
                    {chart.data.map((d, i) => (
                      <Cell key={i} fill={d.km > 0 ? C.blue : C.border} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
              Histórico de sessões {stats.sessions > 0 && `(${stats.sessions})`}
            </h3>
            {shown.length === 0 ? (
              <div className="py-6 text-center text-xs" style={{ color: C.muted }}>
                Sem atividades neste período.
              </div>
            ) : (
              <div className="space-y-2">
                {shown.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5"
                    style={{ background: C.card2, border: `1px solid ${C.border}` }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: TYPE_COLOR[a.type] || C.muted }}
                      />
                      <div>
                        <div className="text-sm font-medium" style={{ color: C.text }}>
                          {a.name || TYPE_LABEL[a.type] || "Atividade"}
                        </div>
                        <div className="text-xs" style={{ color: C.muted }}>
                          {fmtDate(a.start)} · {TYPE_LABEL[a.type] || a.type} · FC méd{" "}
                          {a.avg_hr || "—"} bpm
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs" style={{ color: C.muted }}>
                      {a.distance_km > 0 && <span>{a.distance_km.toFixed(1)} km</span>}
                      <span>{fmtTime(a.duration_s)}</span>
                      <span style={{ color: C.orange }}>
                        {a.kcal ? Math.round(a.kcal).toLocaleString("pt-BR") : "—"} kcal
                      </span>
                    </div>
                  </div>
                ))}
                {acts.length > visible && (
                  <button
                    onClick={() => setVisible((v) => v + 30)}
                    className="w-full rounded-lg px-3 py-2 text-xs font-semibold"
                    style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
                  >
                    Mostrar mais ({acts.length - visible} restantes)
                  </button>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
