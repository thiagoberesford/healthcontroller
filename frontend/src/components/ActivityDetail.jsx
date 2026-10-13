import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
import { C, tooltipStyle, isLight } from "../theme.js";
import { api } from "../lib/api.js";
import {
  TYPE_LABEL,
  TYPE_COLOR,
  fmtDate,
  fmtDuration,
  fmtPace,
  RUN_TYPES,
} from "../lib/garmin.js";

const ZONES = [
  { label: "Z1 · Recovery", pct: [0, 0.6], color: "#38bdf8" },
  { label: "Z2 · Aerobic", pct: [0.6, 0.7], color: C.green },
  { label: "Z3 · Tempo", pct: [0.7, 0.8], color: C.teal },
  { label: "Z4 · Threshold", pct: [0.8, 0.9], color: C.orange },
  { label: "Z5 · Anaerobic", pct: [0.9, 1.01], color: C.red },
];

function MapCard({ polyline }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !polyline?.length) return;
    const map = L.map(ref.current, { attributionControl: true });
    const tiles = isLight()
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
    L.tileLayer(tiles, {
      attribution: "© OpenStreetMap contributors · Esri, HERE, Garmin",
      maxZoom: 16,
    }).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16 },
    ).addTo(map);
    const line = L.polyline(polyline, { color: C.teal, weight: 3, opacity: 0.9 }).addTo(map);
    L.circleMarker(polyline[0], { radius: 5, color: C.green, fillColor: C.green, fillOpacity: 1 }).addTo(map);
    L.circleMarker(polyline[polyline.length - 1], { radius: 5, color: C.red, fillColor: C.red, fillOpacity: 1 }).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [18, 18] });
    return () => map.remove();
  }, [polyline]);

  if (!polyline?.length) return null;
  return (
    <div
      ref={ref}
      style={{ height: 300, borderRadius: 12, border: `1px solid ${C.border}` }}
    />
  );
}

export default function ActivityDetail({ activity, onClose }) {
  const [detail, setDetail] = useState(null);
  const [shoes, setShoes] = useState([]);
  const [shoe, setShoe] = useState("");
  const [note, setNote] = useState({ rpe: null, feeling: "" });
  const [strengthRows, setStrengthRows] = useState(null);
  const [lastStrength, setLastStrength] = useState([]);

  const a = activity;
  const isStrength = a?.type === "strength_training" || a?.type === "gym";

  useEffect(() => {
    let alive = true;
    setDetail(null);
    api.getActivityDetail(activity.source, activity.source_key).then((d) => {
      if (alive) setDetail(d || "none");
    });
    api.listShoes().then((s) => {
      if (alive) setShoes(s.filter((x) => !x.retired));
    });
    api.listShoeAssignments().then((asg) => {
      if (!alive) return;
      const mine = asg.find((x) => x.source === activity.source && x.source_key === activity.source_key);
      setShoe(mine?.shoe_id || "");
    });
    api.getActivityNote(activity.source, activity.source_key).then((n) => {
      if (alive && n) setNote({ rpe: n.rpe ?? null, feeling: n.feeling || "" });
    });
    if ((activity.type === "strength_training" || activity.type === "gym")) {
      api.listStrengthSets(activity.source, activity.source_key).then((rows) => {
        if (alive) setStrengthRows(rows || []);
      });
      // lembrete: séries do treino de força anterior
      api.listGarminActivities().then((acts) => {
        if (!alive) return;
        const prev = acts.find(
          (x) =>
            (x.type === "strength_training" || x.type === "gym") &&
            x.start < activity.start,
        );
        if (prev) {
          api.listStrengthSets(prev.source, prev.source_key).then((rows) => {
            if (alive) setLastStrength(rows || []);
          });
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [activity]);

  const addStrengthRow = () => {
    setStrengthRows((rows) => [
      ...(rows || []),
      {
        source: activity.source,
        source_key: activity.source_key,
        exercise: "",
        sets: 3,
        reps: 10,
        weight_kg: null,
      },
    ]);
  };

  const saveStrengthRow = async (row, idx) => {
    if (!row.exercise?.trim()) return;
    const saved = await api.saveStrengthSet(row);
    if (saved) {
      setStrengthRows((rows) => rows.map((r, i) => (i === idx ? saved : r)));
    }
  };

  const removeStrengthRow = async (row, idx) => {
    if (row.id) await api.deleteStrengthSet(row.id);
    setStrengthRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const saveNote = async (patch) => {
    const next = { ...note, ...patch };
    setNote(next);
    await api.setActivityNote(activity.source, activity.source_key, next);
  };

  const changeShoe = async (shoeId) => {
    setShoe(shoeId);
    if (shoeId) await api.setShoeAssignment(activity.source, activity.source_key, shoeId);
    else await api.removeShoeAssignment(activity.source, activity.source_key);
  };

  const isRun = RUN_TYPES.has(a.type);
  const pace = a.distance_km > 0 && a.duration_s ? a.duration_s / a.distance_km : null;

  const splits = detail && detail !== "none" ? detail.splits || [] : [];
  const gear = detail && detail !== "none" ? detail.gear || [] : [];
  const polyline = detail && detail !== "none" ? detail.polyline || [] : [];
  const hrSeries = detail && detail !== "none" ? detail.hr || [] : [];
  const distSeries = detail && detail !== "none" ? detail.dist_series || [] : [];
  const speedSeries = detail && detail !== "none" ? detail.speed || [] : [];


  /* distância cumulativa (t, m) — da série de distância (Suunto) ou
     integrando a série de velocidade (Garmin); partilhada pelos gráficos */
  const cumSeries = useMemo(() => {
    if (distSeries.length) return distSeries;
    if (!speedSeries.length) return [];
    let d = 0;
    let pt = 0;
    return speedSeries.map(([t, v]) => {
      d += (Number(v) || 0) * (Number(t) - pt);
      pt = Number(t);
      return [Number(t), d];
    });
  }, [distSeries, speedSeries]);

  const paceChart = useMemo(() => {
    const cum = cumSeries;
    if (!cum.length || !a.duration_s) return [];
    const distAt = (t) => {
      if (t <= cum[0][0]) return cum[0][1];
      for (let i = 1; i < cum.length; i++) {
        if (cum[i][0] >= t) {
          const [t0, d0] = cum[i - 1];
          const [t1, d1] = cum[i];
          const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
          return d0 + (d1 - d0) * f;
        }
      }
      return cum[cum.length - 1][1];
    };
    const out = [];
    for (let m = 0; m * 60 < a.duration_s && m < 120; m++) {
      const t0 = m * 60;
      const t1 = Math.min((m + 1) * 60, a.duration_s);
      const dm = distAt(t1) - distAt(t0);
      out.push({
        min: m + 1,
        pace: dm > 3 ? Math.round((1000 / dm) * (t1 - t0)) : null, // s/km
      });
    }
    return out;
  }, [distSeries, speedSeries, a.duration_s]);

  /* resumo da estrutura do treino: aquecimento / repetições / desaquecimento.
     Bins de 15s + 2-means (rápido/lento) + segmentos — reconhece padrões
     tipo 3' corrida / 1' caminhada × N que o bin de 1 minuto fragmentava */
  const structure = useMemo(() => {
    if (!cumSeries.length || !a.duration_s) return null;
    const BIN = 10; // s — fino o suficiente para 3'/1' sem fragmentar
    const distAt2 = (t) => {
      const cum = cumSeries;
      if (t <= cum[0][0]) return cum[0][1];
      for (let i = 1; i < cum.length; i++) {
        if (cum[i][0] >= t) {
          const [t0, d0] = cum[i - 1];
          const [t1, d1] = cum[i];
          const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
          return d0 + (d1 - d0) * f;
        }
      }
      return cum[cum.length - 1][1];
    };
    const bins = [];
    for (let t = 0; t + BIN <= a.duration_s; t += BIN) {
      const dm = distAt2(t + BIN) - distAt2(t);
      const pace = dm > 1.5 ? (1000 / dm) * BIN : null;
      // descarta parados/arranque GPS (>18:00/km): contaminavam o clustering
      if (pace && pace < 18 * 60) bins.push({ t0: t, t1: t + BIN, pace });
    }
    if (bins.length < 4) return null;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

    const paces = bins.map((b) => b.pace).sort((x, y) => x - y);
    const median = paces[Math.floor(paces.length / 2)];
    const spread = (paces[paces.length - 1] - paces[0]) / median;
    const total = Math.round(a.duration_s / 60);
    const continuous = (label) => ({
      rows: [{ label: "Contínuo", min: total, pct: 100, value: `${total} min · ${fmt(median)}/km`, color: C.teal }],
    });
    if (spread < 0.3) return continuous();

    // 2-means 1D: separa rápido/lento sem depender da mediana
    let lo = paces[0];
    let hi = paces[paces.length - 1];
    for (let it = 0; it < 10; it++) {
      const mid = (lo + hi) / 2;
      const a1 = paces.filter((p) => p < mid);
      const b1 = paces.filter((p) => p >= mid);
      if (!a1.length || !b1.length) break;
      const nlo = avg(a1);
      const nhi = avg(b1);
      if (Math.abs(nlo - lo) < 0.5 && Math.abs(nhi - hi) < 0.5) break;
      lo = nlo;
      hi = nhi;
    }
    const thr = (lo + hi) / 2;
    bins.forEach((b) => (b.fast = b.pace < thr));

    // segmentos contíguos do mesmo tipo; ruído <15s funde no anterior
    const segs = [];
    for (const b of bins) {
      const last = segs[segs.length - 1];
      if (last && last.fast === b.fast) {
        last.t1 = b.t1;
        last.paces.push(b.pace);
      } else {
        segs.push({ fast: b.fast, t0: b.t0, t1: b.t1, paces: [b.pace] });
      }
    }
    const merged = [];
    for (const s of segs) {
      const prev = merged[merged.length - 1];
      if (prev && s.t1 - s.t0 <= BIN) {
        prev.t1 = s.t1;
        prev.paces.push(...s.paces);
      } else {
        merged.push(s);
      }
    }
    if (merged.length < 3) return continuous();

    // aquecimento/desaquecimento: segmentos lentos >=90s nas pontas
    let i0 = 0;
    let i1 = merged.length - 1;
    const wu = !merged[0].fast && merged[0].t1 - merged[0].t0 >= 90 ? merged[i0++] : null;
    const cd = !merged[i1].fast && merged[i1].t1 - merged[i1].t0 >= 90 && i1 > i0 ? merged[i1--] : null;
    const mid = merged.slice(i0, i1 + 1);
    const fastSegs = mid.filter((s) => s.fast);
    const slowSegs = mid.filter((s) => !s.fast);
    if (fastSegs.length < 2) return continuous();

    const dur = (s) => s.t1 - s.t0;
    const med = (arr) => {
      const v = [...arr].sort((x, y) => x - y);
      return v[Math.floor(v.length / 2)];
    };
    const runLen = Math.round(med(fastSegs.map(dur)) / 10) * 10;
    const recLen = slowSegs.length ? Math.round(med(slowSegs.map(dur)) / 10) * 10 : null;
    const runPace = avg(fastSegs.flatMap((s) => s.paces));
    const recPace = slowSegs.length ? avg(slowSegs.flatMap((s) => s.paces)) : null;
    const fmtDur = (s) => (s % 60 === 0 ? `${s / 60}'` : `${(s / 60).toFixed(1).replace(".", ",")}'`);
    const recWord = recPace >= 540 ? "caminhada" : "rec."; // >9:00/km = caminhar
    const rows = [];
    const midMin = Math.round((mid[mid.length - 1].t1 - mid[0].t0) / 60);
    const totalMin = Math.round(a.duration_s / 60);
    if (wu) {
      rows.push({
        label: "Aquecimento",
        min: Math.round(dur(wu) / 60),
        pct: +((dur(wu) / a.duration_s) * 100).toFixed(1),
        value: `${Math.round(dur(wu) / 60)} min · ${fmt(avg(wu.paces))}/km`,
        color: C.blue,
      });
    }
    rows.push({
      label: `${fastSegs.length} repetições${runLen ? ` · ${fmtDur(runLen)}${recLen ? ` / ${fmtDur(recLen)}` : ""}` : ""}`,
      min: midMin,
      pct: +((1 - (wu ? dur(wu) : 0) / a.duration_s - (cd ? dur(cd) : 0) / a.duration_s) * 100).toFixed(1),
      value: recPace
        ? `corrida ${fmt(runPace)}/km · ${recWord} ${fmt(recPace)}/km`
        : `${fmt(runPace)}/km`,
      color: C.orange,
    });
    if (cd) {
      rows.push({
        label: "Desaquecimento",
        min: Math.round(dur(cd) / 60),
        pct: +((dur(cd) / a.duration_s) * 100).toFixed(1),
        value: `${Math.round(dur(cd) / 60)} min · ${fmt(avg(cd.paces))}/km`,
        color: C.purple,
      });
    }
    return { rows };
  }, [distSeries, speedSeries, a.duration_s]);

  const hrChart = useMemo(() => {
    if (!hrSeries.length) return [];
    const t0 = hrSeries[0][0];
    return hrSeries
      .filter(([, bpm]) => bpm)
      .map(([t, bpm]) => ({ min: +((t - t0) / 60).toFixed(1), bpm: Math.round(bpm) }));
  }, [hrSeries]);

  const hrAvg = hrChart.length
    ? Math.round(hrChart.reduce((s, p) => s + p.bpm, 0) / hrChart.length)
    : null;

  const zones = useMemo(() => {
    if (hrSeries.length < 2) return [];
    const hrMax = Math.max(...hrSeries.map(([, b]) => b).filter(Boolean));
    if (!hrMax) return [];
    let prev = hrSeries[0][0];
    const times = new Map();
    for (let i = 1; i < hrSeries.length; i++) {
      const [t, bpm] = hrSeries[i];
      const dt = t - prev;
      prev = t;
      if (!bpm || dt <= 0 || dt > 600) continue;
      for (const z of ZONES) {
        if (bpm >= z.pct[0] * hrMax && bpm < z.pct[1] * hrMax) {
          times.set(z.label, (times.get(z.label) || 0) + dt);
          break;
        }
      }
    }
    const total = [...times.values()].reduce((s, v) => s + v, 0);
    return ZONES.map((z) => ({
      ...z,
      seconds: times.get(z.label) || 0,
      pct: total ? +(((times.get(z.label) || 0) / total) * 100).toFixed(1) : 0,
    }));
  }, [hrSeries]);

  const elevGain = splits.reduce((s, l) => s + (l.elev_gain || 0), 0);
  const cadenceParts = splits.filter((l) => l.cadence);
  const cadence = cadenceParts.length
    ? Math.round(cadenceParts.reduce((s, l) => s + l.cadence, 0) / cadenceParts.length)
    : null;

  const metrics = [
    { label: "Distância", value: a.distance_km ? a.distance_km.toFixed(2) : "—", unit: "km" },
    { label: "Duração", value: fmtDuration(a.duration_s), unit: "" },
    ...(isRun ? [{ label: "Ritmo médio", value: pace ? fmtPace(1000 / pace) : "—", unit: "/km" }] : []),
    { label: "FC média", value: a.avg_hr ?? "—", unit: "bpm" },
    { label: "Calorias", value: a.kcal ?? "—", unit: "kcal" },
    ...(elevGain ? [{ label: "Elevação +", value: Math.round(elevGain), unit: "m" }] : []),
    ...(cadence ? [{ label: "Cadência média", value: cadence, unit: "spm" }] : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(5,8,12,.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:max-h-[92vh] max-sm:overflow-y-auto max-sm:rounded-b-none mx-auto max-w-4xl rounded-2xl p-5 sm:p-6"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full sm:hidden" style={{ background: C.border }} />
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: C.text }}>
              {a.name || TYPE_LABEL[a.type] || "Atividade"}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: C.muted }}>
              <span
                className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: C.card2, color: TYPE_COLOR[a.type] || C.muted }}
              >
                {TYPE_LABEL[a.type] || a.type}
              </span>
              <span>{fmtDate(a.start)}</span>
              {a.source === "suunto" && (
                <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: C.card2, color: C.orange }}>
                  Suunto
                </span>
              )}
            </div>
            {gear.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {gear.map((g, i) => (
                  <span
                    key={i}
                    className="rounded-full px-2.5 py-1 text-[11px]"
                    style={{
                      background: "rgba(74,222,128,.12)",
                      color: g.status === "active" ? C.green : C.muted,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    {g.type === "Shoes" ? "👟 " : ""}
                    {g.name}
                    {g.status === "active" ? " · ativo" : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold"
            style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
          >
            Fechar
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: C.muted }}>
                {m.label}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-bold" style={{ color: C.text }}>{m.value}</span>
                {m.unit && <span className="text-[10px]" style={{ color: C.muted }}>{m.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        {isRun && shoes.length > 0 && (
          <div className="mb-5 flex items-center gap-2 text-sm">
            <span className="text-xs" style={{ color: C.muted }}>Ténis:</span>
            <select
              className="rounded-lg px-2 py-1 text-xs outline-none"
              value={shoe}
              onChange={(e) => changeShoe(e.target.value)}
              style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
            >
              <option value="">— sem ténis —</option>
              {shoes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.is_current ? " (em uso)" : ""}
                </option>
              ))}
            </select>
            <span className="text-[10px]" style={{ color: C.muted }}>
              conta para o desgaste do par
            </span>
          </div>
        )}

        {/* RPE / feeling pós-treino (à Suunto Feeling) */}
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>          <span className="text-xs font-semibold" style={{ color: C.text }}>
            Esforço (RPE 1-10):
          </span>
          <select
            className="rounded-lg px-2 py-1 text-xs outline-none"
            value={note.rpe ?? ""}
            onChange={(e) => saveNote({ rpe: e.target.value ? +e.target.value : null })}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <input
            className="min-w-40 flex-1 rounded-lg px-2 py-1 text-xs outline-none"
            placeholder="Como te sentiste no treino? (opcional)"
            value={note.feeling}
            onChange={(e) => setNote({ ...note, feeling: e.target.value })}
            onBlur={(e) => saveNote({ feeling: e.target.value })}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
          />
        </div>

        {isStrength && (
          <div className="mb-5 rounded-xl p-4" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
            <h3 className="mb-2 text-xs font-semibold" style={{ color: C.text }}>
              Rotina de força
            </h3>
            {lastStrength.length > 0 && strengthRows?.length === 0 && (
              <p className="mb-2 text-[10px]" style={{ color: C.muted }}>
                Última vez: {lastStrength.map((r) => `${r.exercise} ${r.sets}x${r.reps}${r.weight_kg ? ` @ ${r.weight_kg}kg` : ""}`).join(" · ")}
              </p>
            )}
            <div className="space-y-2">
              {(strengthRows || []).map((row, idx) => (
                <div key={row.id ?? `n${idx}`} className="flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-32 flex-1 rounded-lg px-2 py-1 text-xs outline-none"
                    placeholder="Exercício"
                    value={row.exercise}
                    onChange={(e) =>
                      setStrengthRows((rows) => rows.map((r, i) => (i === idx ? { ...r, exercise: e.target.value } : r)))
                    }
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                  />
                  <input
                    type="number"
                    className="w-14 rounded-lg px-2 py-1 text-xs outline-none"
                    placeholder="séries"
                    value={row.sets}
                    onChange={(e) =>
                      setStrengthRows((rows) => rows.map((r, i) => (i === idx ? { ...r, sets: +e.target.value || 1 } : r)))
                    }
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                  />
                  <input
                    type="number"
                    className="w-14 rounded-lg px-2 py-1 text-xs outline-none"
                    placeholder="reps"
                    value={row.reps}
                    onChange={(e) =>
                      setStrengthRows((rows) => rows.map((r, i) => (i === idx ? { ...r, reps: +e.target.value || 10 } : r)))
                    }
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                  />
                  <input
                    type="number"
                    className="w-16 rounded-lg px-2 py-1 text-xs outline-none"
                    placeholder="kg"
                    value={row.weight_kg ?? ""}
                    onChange={(e) =>
                      setStrengthRows((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, weight_kg: e.target.value ? +e.target.value : null } : r)),
                      )
                    }
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                  />
                  <button
                    onClick={() => saveStrengthRow(row, idx)}
                    className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                    style={{ background: C.teal, color: "#04141a" }}
                  >
                    guardar
                  </button>
                  <button
                    onClick={() => removeStrengthRow(row, idx)}
                    className="text-xs"
                    style={{ color: C.red }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addStrengthRow}
              className="mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted }}
            >
              + exercício
            </button>
          </div>
        )}

        {detail === null ? (
          <p className="py-8 text-center text-sm" style={{ color: C.muted }}>
            A carregar detalhes…
          </p>
        ) : detail === "none" ? (
          <p className="py-6 text-center text-xs" style={{ color: C.muted }}>
            Sem detalhes guardados para esta atividade.
          </p>
        ) : (
          <div className="space-y-5">
            {polyline.length > 1 && <MapCard polyline={polyline} />}

            {splits.length > 0 && (
              <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${C.border}` }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase" style={{ color: C.muted, background: C.card2 }}>
                      <th className="px-3 py-2">Split</th>
                      <th className="px-3 py-2">Ritmo</th>
                      <th className="px-3 py-2">Desvio</th>
                      <th className="px-3 py-2">FC méd</th>
                      <th className="px-3 py-2">FC máx</th>
                      <th className="px-3 py-2">Elev +</th>
                    </tr>
                  </thead>
                  <tbody>
                    {splits.map((l, i) => {
                      const km = (l.distance || 0) / 1000;
                      const paceKm = l.duration && km ? l.duration / km : null;
                      const dev = pace && paceKm ? paceKm - pace : null;
                      return (
                        <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td className="px-3 py-2 font-medium" style={{ color: C.text }}>
                            Km {i + 1}
                          </td>
                          <td className="px-3 py-2" style={{ color: C.text }}>
                            {paceKm ? fmtPace(1000 / paceKm) : "—"} /km
                          </td>
                          <td className="px-3 py-2" style={{ color: dev === null ? C.muted : dev > 0 ? C.red : C.green }}>
                            {dev === null ? "—" : `${dev > 0 ? "+" : ""}${Math.round(dev)}s`}
                          </td>
                          <td className="px-3 py-2" style={{ color: C.text }}>{l.avg_hr ?? "—"}</td>
                          <td className="px-3 py-2" style={{ color: C.muted }}>{l.max_hr ?? "—"}</td>
                          <td className="px-3 py-2" style={{ color: C.muted }}>
                            {l.elev_gain ? `${Math.round(l.elev_gain)} m` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              {hrChart.length > 1 && (
                <div className="rounded-xl p-3" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
                  <h3 className="mb-2 px-1 text-xs font-semibold" style={{ color: C.text }}>
                    FC no tempo {hrAvg && `(média ${hrAvg} bpm)`}
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={hrChart}>
                      <defs>
                        <linearGradient id="gHR" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={C.red} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={C.red} stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                      <XAxis dataKey="min" unit="min" stroke={C.muted} fontSize={11} />
                      <YAxis domain={["dataMin - 10", "dataMax + 5"]} stroke={C.muted} fontSize={11} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} bpm`, "FC"]} />
                      {hrAvg && <ReferenceLine y={hrAvg} stroke={C.muted} strokeDasharray="4 4" />}
                      <Area type="monotone" dataKey="bpm" stroke={C.red} strokeWidth={2} fill="url(#gHR)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {structure && (
                <div className="rounded-xl p-4" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
                  <h3 className="mb-3 px-1 text-xs font-semibold" style={{ color: C.text }}>
                    Estrutura do treino
                  </h3>
                  <div className="space-y-2.5">
                    {structure.rows.map((r) => (
                      <div key={r.label} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-xs" style={{ color: C.muted }}>
                          {r.label}
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: C.card }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${r.pct}%`, background: r.color }}
                          />
                        </div>
                        <span className="w-28 text-right text-xs font-medium" style={{ color: C.text }}>
                          {r.value}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 px-1 text-[10px]" style={{ color: C.muted }}>
                    heurística sobre o ritmo por minuto — valores aproximados
                  </p>
                </div>
              )}

              {zones.length > 0 && (
                <div className="rounded-xl p-4" style={{ background: C.card2, border: `1px solid ${C.border}` }}>
                  <h3 className="mb-3 px-1 text-xs font-semibold" style={{ color: C.text }}>
                    Tempo por zona de FC
                  </h3>
                  <div className="space-y-2.5">
                    {zones.map((z) => (
                      <div key={z.label} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-xs" style={{ color: C.muted }}>
                          {z.label}
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: C.card }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${z.pct}%`, background: z.color }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs font-medium" style={{ color: C.text }}>
                          {z.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
