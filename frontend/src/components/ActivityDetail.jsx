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
import { C, tooltipStyle } from "../theme.js";
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
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      maxZoom: 19,
    }).addTo(map);
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

  useEffect(() => {
    let alive = true;
    setDetail(null);
    api.getActivityDetail(activity.source, activity.source_key).then((d) => {
      if (alive) setDetail(d || "none");
    });
    return () => {
      alive = false;
    };
  }, [activity]);

  const a = activity;
  const isRun = RUN_TYPES.has(a.type);
  const pace = a.distance_km > 0 && a.duration_s ? a.duration_s / a.distance_km : null;

  const splits = detail && detail !== "none" ? detail.splits || [] : [];
  const gear = detail && detail !== "none" ? detail.gear || [] : [];
  const polyline = detail && detail !== "none" ? detail.polyline || [] : [];
  const hrSeries = detail && detail !== "none" ? detail.hr || [] : [];

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
  const cadence = splits.length
    ? Math.round(splits.reduce((s, l) => s + (l.cadence || 0), 0) / splits.filter((l) => l.cadence).length)
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
