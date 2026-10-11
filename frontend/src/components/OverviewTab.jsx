import React, { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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
const fmtSleep = (h) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
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
  const [tload, setTload] = useState([]);
  const [planned, setPlanned] = useState([]);

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
      // camada analítica (readiness/CTL/TSB/predições) + plano Treinus
      const tl = await api.listTrainingLoad(addDays(dateKey(today), -120), dateKey(today));
      if (alive) setTload(tl);
      const pw = await api.listPlannedWorkouts();
      if (alive) setPlanned(pw);
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
  const todayLoad = tload.length ? tload[tload.length - 1] : null;
  const readiness = todayLoad?.readiness;
  const hrvBase = todayLoad?.hrv_base_avg ? todayLoad : null;
  const hrvColor = (() => {
    if (!last?.hrv || !hrvBase) return METRICS.hrv.color;
    if (last.hrv >= hrvBase.hrv_base_avg) return C.green;
    if (last.hrv >= hrvBase.hrv_base_min) return C.orange;
    return C.red;
  })();
  const todayPlan = planned.find((p) => p.date === dateKey(new Date()));
  const readinessMsg =
    readiness == null ? "" : readiness > 75
      ? "dia para treino forte"
      : readiness >= 50
        ? "treino moderado"
        : "prioriza recuperação";
  const tsbState = (() => {
    const tsb = todayLoad?.tsb;
    if (tsb == null) return null;
    if (tsb > 5) return { txt: "produtivo — fresco", color: C.green };
    if (tsb > -10) return { txt: "neutro — a absorver carga", color: C.text };
    if (tsb > -30) return { txt: "fadiga acumulada", color: C.orange };
    return { txt: "overreaching — recupera", color: C.red };
  })();
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
      <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-5">
          {/* readiness */}
          <div className="flex items-center gap-3">
            <Ring
              value={readiness ?? 0}
              max={100}
              label="Prontidão"
              unit=""
              color={
                readiness == null ? C.muted : readiness > 75 ? C.green : readiness >= 50 ? C.orange : C.red
              }
              size={92}
              display={readiness ?? "—"}
            />
          </div>
          {/* noite + plano */}
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            {readiness != null && (
              <p style={{ color: C.text }}>
                <b>{readiness}</b> — {readinessMsg}
              </p>
            )}
            <p className="text-xs" style={{ color: C.muted }}>
              Última noite: sono {sleepLast?.sleepHours ? fmtSleep(sleepLast.sleepHours) : "—"}
              {last?.hrv ? ` · HRV ${last.hrv} ms` : ""}
              {last?.restingHr ? ` · FC repouso ${last.restingHr} bpm` : ""}
            </p>
            <p className="text-xs" style={{ color: C.muted }}>
              Plano de hoje:{" "}
              {todayPlan ? (
                <b style={{ color: C.teal }}>{todayPlan.name}</b>
              ) : (
                "sem treino planeado"
              )}
              {tsbState && ` · forma: ${tsbState.txt}`}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <p className="mb-4 text-right text-[11px]" style={{ color: C.muted }}>
          dados de {fmtDate(last.date)}
        </p>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            { m: METRICS.steps, value: last.steps || 0, max: 10000, unit: "passos" },
            { m: METRICS.activeCalories, value: last.activeCalories || 0, max: 800, unit: "kcal" },
            { m: METRICS.sleepHours, value: sleepLast?.sleepHours || 0, max: 9, unit: "", date: sleepLast?.date, display: sleepLast?.sleepHours ? fmtSleep(sleepLast.sleepHours) : null },
            { m: METRICS.hrv, value: last.hrv || 0, max: 90, unit: "ms", color: hrvColor },
          ].map(({ m, ...ringProps }) => (
            <div
              key={m.key}
              onClick={() => setDetail(m)}
              className="cursor-pointer rounded-xl transition-transform hover:scale-105"
              title={`Ver evolução de ${m.title}`}
            >
              <Ring {...ringProps} label={m.title} color={ringProps.color || m.color} />
            </div>
          ))}
        </div>
      </Card>
      </>
      )}

      <HydrationCard refreshKey={refreshKey} />

      {/* Forma: CTL (42d) / ATL (7d) / TSB */}
      {tload.length > 2 && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="text-sm font-semibold" style={{ color: C.text }}>
              Forma (CTL · ATL · TSB, 120d)
            </h3>
            <span className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
              {tsbState && (
                <span style={{ color: tsbState.color }}>{tsbState.txt}</span>
              )}
              {todayLoad?.acr != null && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{
                    background:
                      todayLoad.acr <= 1.3
                        ? "rgba(74,222,128,.15)"
                        : todayLoad.acr <= 1.5
                          ? "rgba(251,146,60,.15)"
                          : "rgba(248,113,113,.15)",
                    color:
                      todayLoad.acr <= 1.3 ? C.green : todayLoad.acr <= 1.5 ? C.orange : C.red,
                  }}
                >
                  agudo:crónico {todayLoad.acr.toFixed(1)}
                  {todayLoad.acr > 1.5 ? " — risco" : ""}
                </span>
              )}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={tload.map((r) => ({ ...r, label: dayMonth(r.date) }))}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke={C.muted} strokeDasharray="2 2" />
              <Line type="monotone" dataKey="ctl" stroke={C.green} strokeWidth={2} dot={false} name="CTL (forma)" />
              <Line type="monotone" dataKey="atl" stroke={C.red} strokeWidth={2} dot={false} name="ATL (fadiga)" />
              <Line type="monotone" dataKey="tsb" stroke={C.blue} strokeWidth={2} dot={false} name="TSB" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Race predictor (Riegel a partir dos PRs + VO2máx) */}
      {todayLoad?.pred_5k && <RacePredictorCard todayLoad={todayLoad} />}

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

/* Hidratação diária — registo manual, meta 3L. */
const WATER_GOAL = 3000;
function HydrationCard({ refreshKey }) {
  const [ml, setMl] = useState(null);
  const today = dateKey(new Date());

  useEffect(() => {
    api.getHydration(today).then(setMl);
  }, [refreshKey, today]);

  const add = async (delta) => {
    setMl((v) => Math.max(0, (v ?? 0) + delta));
    const total = await api.addWater(today, delta);
    if (total != null) setMl(total);
  };

  const pct = Math.min(100, ((ml || 0) / WATER_GOAL) * 100);
  const goalDone = (ml || 0) >= WATER_GOAL;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold" style={{ color: C.text }}>
          Hidratação · {dayMonth(today)}
        </h3>
        <span className="text-xs" style={{ color: C.muted }}>
          {(ml ?? 0).toLocaleString("pt-BR")} / {WATER_GOAL.toLocaleString("pt-BR")} ml
        </span>
      </div>
      <div
        className="h-3 overflow-hidden rounded-full"
        style={{ background: C.card2, border: `1px solid ${C.border}` }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: goalDone ? C.teal : C.blue,
            transition: "width .4s ease",
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[250, 500].map((v) => (
          <button
            key={v}
            onClick={() => add(v)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
          >
            +{v} ml
          </button>
        ))}
        <button
          onClick={() => ml > 0 && add(-ml)}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}
          title="Zerar o registo de hoje"
        >
          Reset
        </button>
      </div>
    </Card>
  );
}
/* Race predictor: Riegel a partir dos PRs oficiais, ajustado pelo VO2máx. */
const fmtRace = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

function RacePredictorCard({ todayLoad }) {
  const [evo, setEvo] = useState(null);
  const races = [
    { key: "pred_5k", label: "5 km" },
    { key: "pred_10k", label: "10 km" },
    { key: "pred_half", label: "Meia" },
    { key: "pred_mara", label: "Maratona" },
  ];

  const openEvo = async () => {
    setEvo([]);
    const rows = await api.listTrainingLoad("2025-01-01");
    setEvo(rows.filter((r) => r.pred_5k));
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold" style={{ color: C.text }}>
          Preditor de prova
        </h3>
        <button
          onClick={openEvo}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
        >
          evolução
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {races.map((r) => (
          <div key={r.key} className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>
              {r.label}
            </div>
            <div className="mt-1 text-lg font-bold" style={{ color: C.teal }}>
              {fmtRace(todayLoad[r.key])}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[10px]" style={{ color: C.muted }}>
        Riegel a partir dos teus PRs, ajustado pelo VO2máx atual — afina com treinos recentes
      </p>

      {evo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.6)" }}
          onClick={() => setEvo(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl p-5"
            style={{ background: C.card, border: `1px solid ${C.border}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
              Evolução das predições
            </h3>
            {evo.length === 0 ? (
              <p className="text-sm" style={{ color: C.muted }}>A carregar…</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={evo
                    .filter((r) => r.date >= "2025-02-01")
                    .filter((r) => r.date.endsWith("-01") || r.date.endsWith("-15"))
                    .map((r) => ({
                      label: dayMonth(r.date),
                      pred_5k: r.pred_5k,
                      pred_10k: r.pred_10k,
                      pred_half: r.pred_half,
                      pred_mara: r.pred_mara,
                    }))}
                >
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis
                    {...axisProps}
                    tickFormatter={(s) => fmtRace(s)}
                  />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtRace(v)]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="pred_5k" stroke={C.teal} dot={false} name="5 km" />
                  <Line type="monotone" dataKey="pred_10k" stroke={C.blue} dot={false} name="10 km" />
                  <Line type="monotone" dataKey="pred_half" stroke={C.orange} dot={false} name="Meia" />
                  <Line type="monotone" dataKey="pred_mara" stroke={C.purple} dot={false} name="Maratona" />
                </LineChart>
              </ResponsiveContainer>
            )}
            <div className="mt-3 text-right">
              <button
                onClick={() => setEvo(null)}
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
