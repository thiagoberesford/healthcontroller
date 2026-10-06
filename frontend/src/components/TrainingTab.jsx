import React, { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, StatCard } from "./ui.jsx";
import { C, axisProps, tooltipStyle, fmtTime } from "../theme.js";
import { api, SUPABASE_ENABLED } from "../lib/api.js";
import { RUN_TYPES, TYPE_LABEL, TYPE_COLOR, fmtDate, fmtKcal, fmtRecord, dayMonth } from "../lib/garmin.js";
import ActivityDetail from "./ActivityDetail.jsx";

const PERIODS = [
  { id: "day", label: "Hoje", days: 1 },
  { id: "week", label: "7d", days: 7 },
  { id: "month", label: "30d", days: 30 },
  { id: "quarter", label: "90d", days: 90 },
  { id: "year", label: "1 ano", days: 365 },
  { id: "all", label: "Tudo", days: null },
];

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
};

const sumBy = (list, fn) => list.reduce((s, a) => s + (fn(a) || 0), 0);

const pctDelta = (curr, prev) => {
  if (!prev) return null;
  const pct = Math.round(((curr - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
};

export default function TrainingTab({ refreshKey }) {
  const [periodId, setPeriodId] = useState("month");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [acts, setActs] = useState(null);
  const [prevActs, setPrevActs] = useState([]);
  const [visible, setVisible] = useState(30);
  const [prs, setPrs] = useState([]);
  const [vo2, setVo2] = useState([]);
  const [planned, setPlanned] = useState([]);
  const [openGuide, setOpenGuide] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.listPersonalRecords().then(setPrs);
    api.listPlannedWorkouts().then(setPlanned);
  }, [refreshKey]);

  const period = PERIODS.find((p) => p.id === periodId);

  const { start, end, days } = useMemo(() => {
    if (periodId === "custom") {
      const [a, b] =
        custom.start <= custom.end ? [custom.start, custom.end] : [custom.end, custom.start];
      if (!a || !b) return { start: null, end: null, days: null, incomplete: true };
      const span = Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
      return { start: a, end: b, days: span };
    }
    if (!period.days) return { start: null, end: null, days: null };
    const today = new Date();
    return {
      start: addDays(dateKey(today), -(period.days - 1)),
      end: dateKey(today),
      days: period.days,
    };
  }, [periodId, custom, period]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setVisible(30);
      if (periodId === "custom" && (!custom.start || !custom.end)) {
        setActs([]);
        setPrevActs([]);
        return;
      }
      setActs(null);
      const list = await api.listGarminActivities(start, end);
      if (!alive) return;
      setActs(list);
      const daily = await api.listGarminDaily(start, end);
      if (!alive) return;
      setVo2(
        daily
          .filter((d) => d.vo2max)
          .map((d) => ({ label: dayMonth(d.date), vo2: d.vo2max, date: d.date })),
      );
      if (start && days) {
        const prev = await api.listGarminActivities(
          addDays(start, -days),
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
  }, [periodId, custom, start, end, days, refreshKey]);

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
  }, [acts, days, end]);

  const shown = acts ? acts.slice(0, visible) : [];

  const selectPeriod = (id) => {
    if (id === "custom" && !custom.start && !custom.end && start && end) {
      setCustom({ start, end });
    }
    setPeriodId(id);
  };

  const openPr = async (p) => {
    if (!p.activity_key) return;
    const act = await api.getActivity(p.source, String(p.activity_key));
    if (act) setSelected(act);
  };

  const title =
    periodId === "custom"
      ? `Treinos (${custom.start ? fmtDate(custom.start) : "…"} – ${custom.end ? fmtDate(custom.end) : "…"})`
      : `Treinos (${period.days ? period.label : "todo o histórico"})`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: C.text }}>
          {title}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => selectPeriod(p.id)}
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
          <button
            onClick={() => selectPeriod("custom")}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              background: periodId === "custom" ? C.teal : C.card,
              color: periodId === "custom" ? "#04141a" : C.muted,
              border: `1px solid ${periodId === "custom" ? C.teal : C.border}`,
            }}
          >
            Personalizado
          </button>
        </div>
      </div>

      {periodId === "custom" && (
        <div className="flex flex-wrap items-center gap-4">
          {[
            { key: "start", label: "De" },
            { key: "end", label: "Até" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
              {label}
              <input
                type="date"
                value={custom[key]}
                min="2019-06-26"
                onChange={(e) => setCustom((c) => ({ ...c, [key]: e.target.value }))}
                className="rounded-lg px-2.5 py-1.5 text-xs"
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  color: C.text,
                  accentColor: C.teal,
                }}
              />
            </label>
          ))}
          <span className="text-xs" style={{ color: C.muted }}>
            Ex.: 01/01/2021 → 01/01/2023
          </span>
        </div>
      )}

      {!stats ? (
        <Card className="p-8 text-center text-sm" style={{ color: C.muted }}>
          A carregar atividades…
        </Card>
      ) : (
        <>
          <PlannedCard planned={planned} openGuide={openGuide} setOpenGuide={setOpenGuide} />
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

          {prs.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 px-1 text-sm font-semibold" style={{ color: C.text }}>
                Melhores marcas <span style={{ color: C.muted, fontWeight: 400 }}>· oficiais Garmin</span>
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {prs.map((p) => (
                  <div
                    key={p.label}
                    onClick={() => openPr(p)}
                    className="cursor-pointer rounded-xl p-3 transition-colors hover:brightness-125"
                    style={{ background: C.card2, border: `1px solid ${C.border}` }}
                    title={p.activity_key ? "Ver atividade do recorde" : ""}
                  >
                    <div className="text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>
                      {p.label}
                    </div>
                    <div className="mt-1 text-lg font-bold" style={{ color: C.teal }}>
                      {fmtRecord(p.value_s)}
                    </div>
                    <div className="text-[10px]" style={{ color: C.muted }}>
                      {p.date ? fmtDate(p.date) : ""}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

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

          {vo2.length >= 2 && (
            <Card className="p-4">
              <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
                Evolução do VO₂ máx <span style={{ color: C.muted, fontWeight: 400 }}>({vo2.length} medições)</span>
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={vo2}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="label" {...axisProps} minTickGap={14} />
                  <YAxis {...axisProps} domain={["dataMin - 2", "dataMax + 2"]} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => [`${v} ml/kg/min`, "VO₂"]}
                  />
                  <Line type="monotone" dataKey="vo2" stroke={C.blue} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card className="p-4">
            <h3 className="mb-3 px-2 text-sm font-semibold" style={{ color: C.text }}>
              Histórico de sessões {stats.sessions > 0 && `(${stats.sessions})`}
            </h3>
            {shown.length === 0 ? (
              <div className="py-6 text-center text-xs" style={{ color: C.muted }}>
                {periodId === "custom" && (!custom.start || !custom.end)
                  ? "Selecione as duas datas (De / Até) para filtrar."
                  : !SUPABASE_ENABLED && api.mode !== "backend"
                  ? "Sem fonte de dados — ligue o backend (uvicorn) ou configure o Supabase."
                  : "Sem atividades neste período."}
              </div>
            ) : (
              <div className="space-y-2">
                {shown.map((a) => (
                  <div
                    key={a.source_key || a.id}
                    onClick={() => setSelected(a)}
                    className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:brightness-125"
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
                          {a.source === "suunto" && (
                            <span
                              className="ml-2 rounded-md px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase"
                              style={{ background: C.card, color: C.orange }}
                            >
                              Suunto
                            </span>
                          )}
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
                        {fmtKcal(a.kcal)} kcal
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
      {selected && <ActivityDetail activity={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* Treinos planeados vindos do Treinus (API direta) — briefing do treinador. */
function PlannedCard({ planned, openGuide, setOpenGuide }) {
  const today = dateKey(new Date());
  const upcoming = planned.filter((p) => p.date >= today);
  const [pushing, setPushing] = useState({});
  if (!upcoming.length) return null;

  const push = async (pdate) => {
    setPushing((s) => ({ ...s, [pdate]: "queued" }));
    const ok = await api.pushGuideToWatch(pdate);
    setPushing((s) => ({ ...s, [pdate]: ok ? "queued" : "error" }));
  };

  const pushBadge = (p) => {
    const st = p.push_status || pushing[p.date];
    if (st === "watch")
      return (
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.teal, color: "#04141a" }}>
          no relógio
        </span>
      );
    if (st === "queued")
      return (
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>
          a enviar…
        </span>
      );
    if (st === "error")
      return (
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.red, color: "#fff" }}>
          erro
        </span>
      );
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          push(p.date);
        }}
        className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors"
        style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
        title="Enviar esta guia para o relógio (worker no Mac, ~5 min)"
      >
        → relógio
      </button>
    );
  };

  return (
    <Card className="p-4">
      <h3 className="mb-2 text-xs font-semibold" style={{ color: C.text }}>
        Plano · Treinus
      </h3>
      <div style={{ borderTop: `1px solid ${C.border}` }}>
        {upcoming.map((p) => {
          const open = openGuide === p.id;
          const briefing = p.data?.briefing;
          return (
            <div key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <button
                onClick={() => setOpenGuide(open ? null : p.id)}
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="text-sm font-medium" style={{ color: C.text }}>
                  {p.name}
                </span>
                {p.data?.done && (
                  <span className="ml-2 text-xs" style={{ color: C.green }}>
                    feito
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: C.muted }}>
                    {p.data?.time_max ? `~${p.data.time_max}` : ""}
                  </span>
                  {pushBadge(p)}
                </span>
              </button>
              {open && briefing && (
                <pre
                  className="mb-3 whitespace-pre-wrap rounded-lg p-3 text-xs"
                  style={{ background: C.card2, color: C.text, border: `1px solid ${C.border}` }}
                >
                  {briefing}
                </pre>
              )}
              {open && !briefing && p.data?.steps?.length > 0 && (
                <ul className="space-y-1 pb-3">
                  {p.data.steps.map((s, i) => (
                    <li key={i} className="flex flex-wrap gap-2 text-xs">
                      <span style={{ color: C.teal }}>{s.title}</span>
                      {s.text && <span style={{ color: C.text }}>{s.text}</span>}
                      {s.duration_s && (
                        <span style={{ color: C.muted }}>{fmtTime(s.duration_s)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
