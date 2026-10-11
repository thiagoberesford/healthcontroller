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
    return () => {
      alive = false;
    };
  }, [activity]);

  const changeShoe = async (shoeId) => {
    setShoe(shoeId);
    if (shoeId) await api.setShoeAssignment(activity.source, activity.source_key, shoeId);
    else await api.removeShoeAssignment(activity.source, activity.source_key);
  };

  const a = activity;
  const isRun = RUN_TYPES.has(a.type);
  const pace = a.distance_km > 0 && a.duration_s ? a.duration_s / a.distance_km : null;

  const splits = detail && detail !== "none" ? detail.splits || [] : [];
  const gear = detail && detail !== "none" ? detail.gear || [] : [];
  const polyline = detail && detail !== "none" ? detail.polyline || [] : [];
  const hrSeries = detail && detail !== "none" ? detail.hr || [] : [];
  const distSeries = detail && detail !== "none" ? detail.dist_series || [] : [];
  const speedSeries = detail && detail !== "none" ? detail.speed || [] : [];


  const paceChart = useMemo(() => {
    let cum = distSeries;
    if (!cum.length && speedSeries.length) {
      let d = 0;
      let pt = 0;
      cum = speedSeries.map(([t, v]) => {
        d += (Number(v) || 0) * (Number(t) - pt);
        pt = Number(t);
        return [Number(t), d];
      });
    }
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

  /* resumo da estrutura do treino: aquecimento / intervalos / desaquecimento
     (heurística sobre o ritmo por minuto) — linhas com barra, estilo zonas de FC */
  const structure = useMemo(() => {
    const pts = paceChart.filter((p) => p.pace);
    if (pts.length < 4) return null;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    const sorted = [...pts].map((p) => p.pace).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const spread = (sorted[sorted.length - 1] - sorted[0]) / median;
    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const total = pts.length;

    if (spread < 0.3) {
      return {
        rows: [
          {
            label: "Contínuo",
            min: total,
            pct: 100,
            value: `${total} min · ${fmt(median)}/km`,
            color: C.teal,
          },
        ],
      };
    }
    const fastThr = median * 0.95;
    const kinds = pts.map((p) => (p.pace < fastThr ? "F" : "S"));
    const blocks = [];
    let cur = null;
    kinds.forEach((k, i) => {
      if (k === "F") {
        if (!cur) cur = { start: i, end: i };
        else cur.end = i;
      } else if (cur) {
        blocks.push(cur);
        cur = null;
      }
    });
    if (cur) blocks.push(cur);
    if (blocks.length < 2) {
      return {
        rows: [
          {
            label: "Contínuo",
            min: total,
            pct: 100,
            value: `${total} min · ${fmt(median)}/km`,
            color: C.teal,
          },
        ],
      };
    }
    const fastPaces = [];
    blocks.forEach((b) => {
      for (let i = b.start; i <= b.end; i++) fastPaces.push(pts[i].pace);
    });
    const lens = blocks.map((b) => b.end - b.start + 1).sort((a, b) => a - b);
    const typLen = lens[Math.floor(lens.length / 2)];
    const slowPaces = [];
    for (let i = blocks[0].start; i <= blocks[blocks.length - 1].end; i++) {
      if (kinds[i] === "S") slowPaces.push(pts[i].pace);
    }
    const wu = pts.slice(0, blocks[0].start);
    const cd = pts.slice(blocks[blocks.length - 1].end + 1);
    const rows = [];
    if (wu.length >= 2) {
      rows.push({
        label: "Aquecimento",
        min: wu.length,
        pct: +((wu.length / total) * 100).toFixed(1),
        value: `${wu.length} min · ${fmt(avg(wu.map((p) => p.pace)))}/km`,
        color: C.blue,
      });
    }
    rows.push({
      label: `${blocks.length} interval${blocks.length === 1 ? "o" : "s"} de ~${typLen} min`,
      min: total - wu.length - cd.length,
      pct: +(((total - wu.length - cd.length) / total) * 100).toFixed(1),
      value: `${fmt(avg(fastPaces))}/km${slowPaces.length ? ` · rec. ${fmt(avg(slowPaces))}/km` : ""}`,
      color: C.orange,
    });
    if (cd.length >= 2) {
      rows.push({
        label: "Desaquecimento",
        min: cd.length,
        pct: +((cd.length / total) * 100).toFixed(1),
        value: `${cd.length} min · ${fmt(avg(cd.map((p) => p.pace)))}/km`,
        color: C.purple,
      });
    }
    return { rows };
  }, [paceChart]);

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
        className="mx-auto max-w-4xl rounded-2xl p-5 sm:p-6"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
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
