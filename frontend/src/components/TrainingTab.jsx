import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
import { Card, StatCard, Skeleton } from "./ui.jsx";
import { C, axisProps, tooltipStyle, fmtTime } from "../theme.js";
import { api, SUPABASE_ENABLED } from "../lib/api.js";
import { RUN_TYPES, TYPE_LABEL, TYPE_COLOR, fmtDate, fmtKcal, fmtRecord, dayMonth } from "../lib/garmin.js";
import ActivityDetail from "./ActivityDetail.jsx";
import ShoeAssignModal from "./ShoeAssignModal.jsx";

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

/* B1: calendário mensal — plano Treinus vs. treinos feitos */
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function CalendarView({ planned, onOpenActivity }) {
  const [monthOffset, setMonthOffset] = useState(0); // 0 = mês atual
  const [acts, setActs] = useState(null);
  const [dayModal, setDayModal] = useState(null);

  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const startIso = dateKey(first);
  const endIso = dateKey(last);

  useEffect(() => {
    setActs(null);
    api.listGarminActivities(startIso, endIso).then(setActs);
  }, [startIso, endIso]);

  const firstWeekday = (first.getDay() + 6) % 7; // seg=0
  const days = last.getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);

  const actsByDay = {};
  for (const a of acts || []) {
    const d = String(a.start).slice(0, 10);
    (actsByDay[d] ??= []).push(a);
  }
  const planByDay = {};
  for (const p of planned) {
    if (p.date >= startIso && p.date <= endIso) planByDay[p.date] = p;
  }

  const cellInfo = (d) => {
    const iso = `${startIso.slice(0, 8)}${String(d).padStart(2, "0")}`;
    const dayActs = actsByDay[iso] || [];
    const plan = planByDay[iso];
    const hasRun = dayActs.some((a) => RUN_TYPES.has(a.type));
    if (plan && hasRun) return { state: "cumprido", dayActs, plan };
    if (plan && dayActs.length) return { state: "feito", dayActs, plan };
    if (plan) return { state: "planeado", dayActs, plan };
    if (dayActs.length) return { state: "feito", dayActs, plan: null };
    return { state: "vazio", dayActs, plan: null };
  };

  const stateStyle = {
    cumprido: { bg: "rgba(74,222,128,.14)", border: C.green, dot: C.green },
    feito: { bg: "rgba(251,146,60,.12)", border: C.orange, dot: C.orange },
    planeado: { bg: "rgba(0,180,179,.08)", border: C.teal, dot: C.teal },
    vazio: { bg: "transparent", border: C.border, dot: null },
  };

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setMonthOffset((m) => m - 1)}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold capitalize" style={{ color: C.text }}>
          {MONTHS[first.getMonth()]} {first.getFullYear()}
        </h3>
        <button
          onClick={() => setMonthOffset((m) => m + 1)}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-[10px] font-semibold" style={{ color: C.muted }}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const info = cellInfo(d);
          const st = stateStyle[info.state];
          const iso = `${startIso.slice(0, 8)}${String(d).padStart(2, "0")}`;
          const isToday = iso === dateKey(new Date());
          return (
            <button
              key={iso}
              onClick={() => (info.dayActs.length || info.plan) && setDayModal(iso)}
              className="flex h-16 flex-col items-center justify-start rounded-lg pt-1 text-xs transition-colors"
              style={{
                background: st.bg,
                border: `1px solid ${isToday ? C.teal : st.border}`,
              }}
            >
              <span style={{ color: C.text, fontWeight: isToday ? 700 : 400 }}>{d}</span>
              <div className="mt-1 flex flex-col items-center gap-0.5">
                {info.state === "cumprido" && (
                  <span className="text-[9px]" style={{ color: C.green }}>✓ plano</span>
                )}
                {info.state === "planeado" && (
                  <span className="text-[9px]" style={{ color: C.teal }}>plano</span>
                )}
                {info.dayActs.length > 0 && (
                  <span className="text-[9px]" style={{ color: C.orange }}>
                    {info.dayActs.length} treino{info.dayActs.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px]" style={{ color: C.muted }}>
        <span><span style={{ color: C.green }}>✓</span> plano cumprido</span>
        <span><span style={{ color: C.teal }}>●</span> planeado</span>
        <span><span style={{ color: C.orange }}>●</span> treino sem plano</span>
      </div>

      {dayModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.6)" }}
          onClick={() => setDayModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl p-5"
            style={{ background: C.card, border: `1px solid ${C.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
              {dayModal}
            </h3>
            {planByDay[dayModal] && (
              <pre
                className="mb-3 whitespace-pre-wrap rounded-lg p-3 text-xs"
                style={{ background: C.card2, color: C.text, border: `1px solid ${C.border}` }}
              >
                {planByDay[dayModal].data?.briefing}
              </pre>
            )}
            <div className="space-y-1">
              {(actsByDay[dayModal] || []).map((a) => (
                <button
                  key={a.source_key}
                  onClick={() => { setDayModal(null); onOpenActivity(a); }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm"
                  style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
                >
                  {a.name} · {a.distance_km ? `${a.distance_km} km · ` : ""}{a.duration_s ? `${Math.round(a.duration_s / 60)} min` : ""}
                </button>
              ))}
            </div>
            <div className="mt-3 text-right">
              <button
                onClick={() => setDayModal(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
              >
                fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* Calendário lateral do mês: treinos feitos (qualquer tipo) + plano Treinus */
function SideCalendar({ planned, onOpenActivity }) {
  const [monthOffset, setMonthOffset] = useState(0); // 0 = mês atual
  const [acts, setActs] = useState(null);
  const [dayModal, setDayModal] = useState(null);

  const base = new Date();
  const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const startIso = dateKey(first);
  const endIso = dateKey(last);

  useEffect(() => {
    setActs(null);
    api.listGarminActivities(startIso, endIso).then(setActs);
  }, [startIso, endIso]);

  const firstWeekday = (first.getDay() + 6) % 7; // seg=0
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(d);

  const actsByDay = {};
  const activeDays = new Set();
  let km = 0;
  let hours = 0;
  for (const a of acts || []) {
    const iso = String(a.start).slice(0, 10);
    (actsByDay[iso] ??= []).push(a);
    activeDays.add(iso);
    km += a.distance_km || 0;
    hours += (a.duration_s || 0) / 3600;
  }
  const planByDay = {};
  for (const p of planned) {
    if (p.date >= startIso && p.date <= endIso) planByDay[p.date] = p;
  }

  const isoOf = (d) => `${startIso.slice(0, 8)}${String(d).padStart(2, "0")}`;
  const todayIso = dateKey(new Date());
  const monthLabel = `${MONTHS[first.getMonth()].slice(0, 3).toUpperCase()} ${first.getFullYear()}`;

  return (
    <Card className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setMonthOffset((m) => m - 1)}
          className="rounded-lg px-2.5 py-1 text-sm font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold" style={{ color: C.text }}>
          {monthLabel}
        </h3>
        <button
          onClick={() => setMonthOffset((m) => m + 1)}
          className="rounded-lg px-2.5 py-1 text-sm font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          ›
        </button>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl py-2 text-center" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
        <div>
          <p className="text-sm font-bold" style={{ color: C.teal }}>{activeDays.size}</p>
          <p className="text-[10px]" style={{ color: C.muted }}>dias ativos</p>
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: C.text }}>{km.toFixed(0)}</p>
          <p className="text-[10px]" style={{ color: C.muted }}>km</p>
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: C.text }}>{hours.toFixed(1)}</p>
          <p className="text-[10px]" style={{ color: C.muted }}>horas</p>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-7 content-center gap-2.5 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-0.5 text-[11px] font-semibold" style={{ color: C.muted }}>
            {w.slice(0, 3)}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const iso = isoOf(d);
          const dayActs = actsByDay[iso] || [];
          const plan = planByDay[iso];
          const isToday = iso === todayIso;
          let bg = C.card2;
          let border = C.border;
          let color = C.muted;
          if (dayActs.length && plan) {
            bg = C.green; border = C.green; color = "#04141a";
          } else if (dayActs.length) {
            bg = C.orange; border = C.orange; color = "#04141a";
          } else if (plan) {
            border = C.teal; color = C.teal;
          }
          return (
            <button
              key={iso}
              onClick={() => (dayActs.length || plan) && setDayModal(iso)}
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold transition-transform hover:scale-105"
              style={{
                background: bg,
                border: `1.5px solid ${isToday ? C.text : border}`,
                color: isToday && !dayActs.length && !plan ? C.text : color,
              }}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: C.muted }}>
        <span><span style={{ color: C.orange }}>●</span> treino feito</span>
        <span><span style={{ color: C.teal }}>○</span> planeado</span>
        <span><span style={{ color: C.green }}>●</span> plano cumprido</span>
      </div>

      {dayModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: "rgba(0,0,0,.6)" }}
          onClick={() => setDayModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl p-5"
            style={{ background: C.card, border: `1px solid ${C.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
              {fmtDate(dayModal)}
            </h3>
            {planByDay[dayModal] && (
              <div className="mb-3 rounded-lg p-3 text-xs" style={{ background: C.card2, border: `1px solid ${C.teal}`, color: C.text }}>
                <span style={{ color: C.teal }}>Plano: </span>
                {planByDay[dayModal].name || "Treinus"}
              </div>
            )}
            <div className="space-y-1">
              {(actsByDay[dayModal] || []).map((a) => (
                <button
                  key={a.source_key}
                  onClick={() => {
                    setDayModal(null);
                    onOpenActivity(a);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm"
                  style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TYPE_COLOR[a.type] || C.muted }} />
                  <span className="min-w-0 flex-1 truncate">{a.name || TYPE_LABEL[a.type] || "Atividade"}</span>
                  <span className="shrink-0 text-xs" style={{ color: C.muted }}>
                    {a.distance_km ? `${a.distance_km.toFixed(1)} km · ` : ""}
                    {a.duration_s ? fmtTime(a.duration_s) : ""}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 text-right">
              <button
                onClick={() => setDayModal(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
              >
                fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

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
  const [shoes, setShoes] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [showShoeModal, setShowShoeModal] = useState(false);
  const [viewMode, setViewMode] = useState("lista"); // lista | calendario | relatorio
  const [showRoutes, setShowRoutes] = useState(false);
  const [reportYear, setReportYear] = useState(new Date().getFullYear());

  useEffect(() => {
    api.listPersonalRecords().then(setPrs);
    api.listPlannedWorkouts().then(setPlanned);
    api.listShoes().then(setShoes);
    api.listShoeAssignments().then(setAssignments);
  }, [refreshKey]);

  /* corridas novas sem ténis atribuído -> popup de confirmação */
  const unshodRuns = useMemo(() => {
    if (!acts || !shoes.length) return [];
    return acts
      .filter((a) => RUN_TYPES.has(a.type) && String(a.start).slice(0, 10) >= "2026-10-05")
      .filter(
        (a) => !assignments.some((x) => x.source === a.source && x.source_key === a.source_key),
      )
      .map((a) => ({
        source: a.source,
        source_key: a.source_key,
        date: String(a.start).slice(0, 10),
        km: a.distance_km,
      }));
  }, [acts, assignments, shoes]);

  useEffect(() => {
    if (unshodRuns.length && shoes.some((s) => !s.retired)) setShowShoeModal(true);
  }, [unshodRuns.length, shoes]);

  /* enquanto houver treinos futuros por enviar, rebuscar o estado
     (o worker marca push_status='watch' em até ~5 min) */
  useEffect(() => {
    const today = dateKey(new Date());
    const pending = planned.some(
      (p) => p.date >= today && !p.push_status,
    );
    if (!pending) return;
    const t = setInterval(() => api.listPlannedWorkouts().then(setPlanned), 30_000);
    return () => clearInterval(t);
  }, [planned]);

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
          <button
            onClick={() => setViewMode(viewMode === "lista" ? "calendario" : "lista")}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: viewMode === "calendario" ? C.teal : C.card,
              color: viewMode === "calendario" ? "#04141a" : C.muted,
              border: `1px solid ${viewMode === "calendario" ? C.teal : C.border}`,
            }}
          >
            Calendário
          </button>
          <button
            onClick={() => setShowRoutes(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}
          >
            Mapa de percursos
          </button>
          <button
            onClick={() => setViewMode(viewMode === "relatorio" ? "lista" : "relatorio")}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: viewMode === "relatorio" ? C.teal : C.card,
              color: viewMode === "relatorio" ? "#04141a" : C.muted,
              border: `1px solid ${viewMode === "relatorio" ? C.teal : C.border}`,
            }}
          >
            Relatório
          </button>
        </div>
      </div>

      {viewMode === "calendario" && (
        <CalendarView planned={planned} onOpenActivity={setSelected} />
      )}

      {viewMode === "relatorio" && (
        <AnnualReport
          year={reportYear}
          onYearChange={setReportYear}
          prs={prs}
          shoes={shoes}
          assignments={assignments}
        />
      )}

      {showRoutes && <RoutesHeatmap onClose={() => setShowRoutes(false)} />}

      {viewMode === "lista" && periodId === "custom" && (
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

      {viewMode === "lista" && !stats ? (
        <Skeleton lines={4} />
      ) : viewMode === "lista" ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="min-w-0 space-y-4">
              <PlannedCard planned={planned} openGuide={openGuide} setOpenGuide={setOpenGuide} />
              <GymCard refreshKey={refreshKey} />
            </div>
            <SideCalendar planned={planned} onOpenActivity={setSelected} />
          </div>
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
              value={stats.kcal.toLocaleString("pt-PT")}
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
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      const idx = chart.data.indexOf(d);
                      const prev = idx > 0 ? chart.data[idx - 1] : null;
                      const delta = prev ? +(d.km - prev.km).toFixed(1) : null;
                      return (
                        <div className="rounded-lg p-2 text-xs" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                          <div style={{ color: C.text }}>{d.label}</div>
                          <div style={{ color: C.teal }}>{d.km} km</div>
                          {prev && (
                            <div style={{ color: delta > 0 ? C.green : delta < 0 ? C.red : C.muted }}>
                              {delta > 0 ? "+" : ""}{delta} vs. {prev.label}
                            </div>
                          )}
                        </div>
                      );
                    }}
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
                    className="flex min-w-0 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-3 transition-colors hover:brightness-125"
                    style={{ background: C.card2, border: `1px solid ${C.border}` }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: TYPE_COLOR[a.type] || C.muted }}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium" style={{ color: C.text }}>
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
                        <div className="truncate text-xs" style={{ color: C.muted }}>
                          {fmtDate(a.start)} · {TYPE_LABEL[a.type] || a.type} · FC méd{" "}
                          {a.avg_hr || "—"} bpm
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-x-4 text-xs" style={{ color: C.muted }}>
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
      ) : null}
      {selected && <ActivityDetail activity={selected} onClose={() => setSelected(null)} />}

      {unshodRuns.length > 0 && !selected && (
        <button
          onClick={() => setShowShoeModal(true)}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{ background: "rgba(0,180,179,.12)", border: `1px solid ${C.teal}`, color: C.teal }}
        >
          🏃 {unshodRuns.length} corrida{unshodRuns.length === 1 ? "" : "s"} sem ténis — atribuir
        </button>
      )}
      {showShoeModal && shoes.length > 0 && (
        <ShoeAssignModal
          runs={unshodRuns}
          shoes={shoes}
          onClose={() => setShowShoeModal(false)}
          onDone={() => {
            setShowShoeModal(false);
            api.listShoeAssignments().then(setAssignments);
          }}
        />
      )}
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

/* Ginásio · Plano ABC: guias cronometradas por treino (mesma fila do Treinus) */
const GYM_PLAN = [
  { key: "A", title: "Peito/Tríceps/Core", exercises: ["Supino máquina", "Supino inclinado halteres", "Crossover", "Tríceps corda", "Tríceps testa", "Abdominais na máquina", "Prancha"] },
  { key: "B", title: "Costas/Bíceps", exercises: ["Puxada frontal", "Remada máquina", "Remada baixa", "Pulldown", "Bíceps barra", "Bíceps alterno", "Martelo"] },
  { key: "C", title: "Pernas/Ombros", exercises: ["Agachamento", "Leg press", "Extensora", "Flexora", "Elevação lateral", "Desenvolvimento máquina", "Abdominal no solo"] },
];

function GymCard({ refreshKey }) {
  const [queue, setQueue] = useState({});
  const [pushing, setPushing] = useState({});
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.listGymQueue().then((q) => alive && setQueue(q));
    load();
    const t = setInterval(load, 30_000); // badge "no relógio" auto-refresh
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  const push = async (key) => {
    setPushing((s) => ({ ...s, [key]: "pending" }));
    const ok = await api.pushGymGuide(key);
    setPushing((s) => ({ ...s, [key]: ok ? "pending" : "error" }));
  };

  const badge = (w) => {
    const st = queue[w.key] || pushing[w.key];
    if (st === "done")
      return (
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.teal, color: "#04141a" }}>
          no relógio
        </span>
      );
    if (st === "pending")
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
        onClick={() => push(w.key)}
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
        Ginásio · Plano ABC
      </h3>
      <div style={{ borderTop: `1px solid ${C.border}` }}>
        {GYM_PLAN.map((w) => {
          const isOpen = open === w.key;
          return (
            <div key={w.key} style={{ borderBottom: `1px solid ${C.border}` }}>
              <button
                onClick={() => setOpen(isOpen ? null : w.key)}
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
              >
                <span className="text-sm font-medium" style={{ color: C.text }}>
                  Treino {w.key} — {w.title}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs" style={{ color: C.muted }}>~53 min</span>
                  {badge(w)}
                </span>
              </button>
              {isOpen && (
                <ul className="space-y-1 pb-3">
                  {w.exercises.map((ex) => (
                    <li key={ex} className="flex gap-2 text-xs">
                      <span style={{ color: C.teal }}>3×</span>
                      <span style={{ color: C.text }}>{ex}</span>
                      <span style={{ color: C.muted }}>45s / 75s descanso</span>
                    </li>
                  ))}
                  <li className="flex gap-2 text-xs">
                    <span style={{ color: C.teal }}>1×</span>
                    <span style={{ color: C.text }}>Bike</span>
                    <span style={{ color: C.muted }}>20 min</span>
                  </li>
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* C2: mapa de percursos — todas as rotas num só mapa, em chunks */
const isLightTheme = () => document.documentElement.classList.contains("light");

function RoutesHeatmap({ onClose }) {
  const [period, setPeriod] = useState("90d");
  const [type, setType] = useState("run");
  const [progress, setProgress] = useState(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const divRef = useRef(null);

  useEffect(() => {
    if (!divRef.current) return;
    const map = L.map(divRef.current, { preferCanvas: true }).setView([41.55, -8.42], 11);
    L.tileLayer(
      isLightTheme()
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
        : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { attribution: "© OpenStreetMap contributors" },
    ).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => map.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const g = layerRef.current;
      if (!g) return;
      g.clearLayers();
      setProgress({ done: 0, total: 0 });
      const today = dateKey(new Date());
      const days = period === "30d" ? 30 : period === "90d" ? 90 : period === "year" ? 365 : null;
      const start = days ? addDays(today, -(days - 1)) : "2019-06-26";
      const acts = await api.listGarminActivities(start, today);
      const sel = acts.filter((a) =>
        type === "run" ? RUN_TYPES.has(a.type) : type === "walk" ? a.type === "walking" : true,
      );
      const keys = sel.map((a) => [a.source, a.source_key]);
      setProgress({ done: 0, total: keys.length });
      let done = 0;
      for (let i = 0; i < keys.length; i += 40) {
        if (cancelled) return;
        const rows = await api.listPolylines(keys.slice(i, i + 40));
        for (const r of rows) {
          if (r.polyline?.length > 1) {
            L.polyline(r.polyline, { color: C.teal, weight: 2, opacity: 0.25 }).addTo(g);
          }
        }
        done += Math.min(40, keys.length - i);
        setProgress({ done, total: keys.length });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, type]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4"
      style={{ background: "rgba(5,8,12,.6)" }}
      onClick={onClose}
    >
      <div
        className="mx-auto max-w-4xl rounded-2xl p-4"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: C.text }}>
            Mapa de percursos
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {[["30d", "30d"], ["90d", "90d"], ["year", "1 ano"], ["all", "Tudo"]].map(([id, l]) => (
              <button
                key={id}
                onClick={() => setPeriod(id)}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold"
                style={{
                  background: period === id ? C.teal : C.card2,
                  color: period === id ? "#04141a" : C.muted,
                  border: `1px solid ${period === id ? C.teal : C.border}`,
                }}
              >
                {l}
              </button>
            ))}
            {[
              ["run", "Corridas"],
              ["walk", "Caminhadas"],
              ["all", "Tudo"],
            ].map(([id, l]) => (
              <button
                key={id}
                onClick={() => setType(id)}
                className="rounded-lg px-2.5 py-1 text-xs font-semibold"
                style={{
                  background: type === id ? C.blue : C.card2,
                  color: type === id ? "#04141a" : C.muted,
                  border: `1px solid ${type === id ? C.blue : C.border}`,
                }}
              >
                {l}
              </button>
            ))}
            <button
              onClick={onClose}
              className="ml-1 rounded-lg px-3 py-1 text-xs font-semibold"
              style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
            >
              fechar
            </button>
          </div>
        </div>
        {progress && progress.done < progress.total && (
          <p className="mb-2 text-xs" style={{ color: C.muted }}>
            a carregar rotas… {progress.done}/{progress.total}
          </p>
        )}
        <div ref={divRef} style={{ height: 460, borderRadius: 12, overflow: "hidden" }} />
      </div>
    </div>
  );
}

/* C3: relatório anual */
function AnnualReport({ year, onYearChange, prs, shoes, assignments }) {
  const [acts, setActs] = useState(null);
  useEffect(() => {
    api.listGarminActivities(`${year}-01-01`, `${year}-12-31`).then(setActs);
  }, [year]);

  const r = useMemo(() => {
    if (!acts) return null;
    const runs = acts.filter((a) => RUN_TYPES.has(a.type));
    const km = +acts.reduce((s, a) => s + (a.distance_km || 0), 0).toFixed(1);
    const time = acts.reduce((s, a) => s + (a.duration_s || 0), 0);
    const kcal = Math.round(acts.reduce((s, a) => s + (a.kcal || 0), 0));
    // consistência: semanas com >=3 treinos
    const weeks = {};
    for (const a of acts) {
      const d = new Date(String(a.start).slice(0, 10));
      const wk = `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + ((d.getDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
      weeks[wk] = (weeks[wk] || 0) + 1;
    }
    const consistentWeeks = Object.values(weeks).filter((n) => n >= 3).length;
    // volume mensal
    const monthly = Array.from({ length: 12 }, (_, m) => ({
      label: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][m],
      km: +acts
        .filter((a) => +String(a.start).slice(5, 7) - 1 === m && RUN_TYPES.has(a.type))
        .reduce((s, a) => s + (a.distance_km || 0), 0)
        .toFixed(1),
    }));
    // km por sapatilha
    const kmByShoe = {};
    for (const a of runs) {
      const m = (assignments || []).find((x) => x.source === a.source && x.source_key === a.source_key);
      if (m) kmByShoe[m.shoe_id] = (kmByShoe[m.shoe_id] || 0) + (a.distance_km || 0);
    }
    const shoeRows = (shoes || [])
      .map((s) => ({ name: s.name, km: +(kmByShoe[s.id] || 0).toFixed(1) }))
      .filter((x) => x.km > 0)
      .sort((a, b) => b.km - a.km);
    // melhores momentos
    const longest = [...runs].sort((a, b) => (b.distance_km || 0) - (a.distance_km || 0))[0];
    const biggest = [...acts].sort((a, b) => (b.tss || 0) - (a.tss || 0))[0];
    const fastest = runs
      .filter((a) => a.distance_km >= 3)
      .sort((a, b) => a.duration_s / a.distance_km - b.duration_s / b.distance_km)[0];
    const moments = [];
    if (longest) moments.push(`Maior distância: ${longest.distance_km} km (${fmtDate(longest.start)})`);
    if (fastest)
      moments.push(
        `Ritmo mais rápido: ${Math.floor(fastest.duration_s / fastest.distance_km / 60)}:${String(
          Math.round((fastest.duration_s / fastest.distance_km) % 60),
        ).padStart(2, "0")} /km (${fmtDate(fastest.start)})`,
      );
    if (biggest) moments.push(`Maior carga: ${Math.round(biggest.tss || 0)} TSS (${fmtDate(biggest.start)})`);
    return { km, time, kcal, sessions: acts.length, consistentWeeks, monthly, shoeRows, moments };
  }, [acts, assignments, shoes]);

  const yearPrs = (prs || []).filter((p) => String(p.date).startsWith(String(year)));

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => onYearChange(year - 1)}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          ‹
        </button>
        <h3 className="text-sm font-semibold" style={{ color: C.text }}>
          Relatório {year}
        </h3>
        <button
          onClick={() => onYearChange(year + 1)}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          ›
        </button>
      </div>

      {!r ? (
        <p className="text-sm" style={{ color: C.muted }}>A carregar…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Distância" value={r.km.toLocaleString("pt-PT")} unit="km" color={C.teal} />
            <StatCard label="Sessões" value={r.sessions} unit="" color={C.blue} />
            <StatCard label="Tempo" value={fmtTime(r.time)} unit="" color={C.orange} />
            <StatCard label="Consistência" value={r.consistentWeeks} unit="sem ≥3" color={C.green} />
          </div>

          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={r.monthly}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} unit=" km" />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="km" fill={C.teal} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {r.shoeRows.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold" style={{ color: C.text }}>Km por sapatilha</h4>
              {r.shoeRows.map((s) => (
                <div key={s.name} className="flex justify-between py-1 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.text }}>{s.name}</span>
                  <span style={{ color: C.muted }}>{s.km} km</span>
                </div>
              ))}
            </div>
          )}

          {yearPrs.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold" style={{ color: C.text }}>Recordes do ano</h4>
              {yearPrs.map((p) => (
                <div key={p.label} className="flex justify-between py-1 text-sm" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.text }}>{p.label}</span>
                  <span style={{ color: C.teal }}>{fmtRecord(p.label, p.value_s)}</span>
                </div>
              ))}
            </div>
          )}

          {r.moments.length > 0 && (
            <div className="mt-4 rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
              <h4 className="mb-1 text-xs font-semibold" style={{ color: C.text }}>Melhores momentos</h4>
              {r.moments.map((m, i) => (
                <p key={i} className="text-xs" style={{ color: C.muted }}>{m}</p>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
