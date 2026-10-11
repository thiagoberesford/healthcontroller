import React from "react";
import { C, fmtTime } from "../theme.js";

export function Card({ children, style, className = "" }) {
  return (
    <div
      className={`rounded-xl ${className}`}
      style={{ background: C.card, border: `1px solid ${C.border}`, ...style }}
    >
      {children}
    </div>
  );
}

/* skeleton pulsante para estados de loading (D2) */
export function Skeleton({ lines = 3, className = "" }) {
  return (
    <Card className={`p-5 ${className}`}>
      <div className="animate-pulse space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg"
            style={{
              height: 14,
              width: `${i === 0 ? 40 : 65 + ((i * 13) % 30)}%`,
              background: C.card2,
            }}
          />
        ))}
        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl" style={{ background: C.card2 }} />
          ))}
        </div>
      </div>
    </Card>
  );
}

export function Ring({ value, max, label, unit, color, size = 120, icon, display }) {
  const pct = Math.min(1, value / max);
  const r = size / 2 - 9;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth="9" fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth="9"
            fill="none"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset .8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold" style={{ color: C.text }}>
            {display ?? Math.round(value).toLocaleString("pt-PT")}
          </span>
          <span className="text-[10px]" style={{ color: C.muted }}>
            {unit}
          </span>
          {icon}
        </div>
      </div>
      <span className="text-xs font-medium" style={{ color: C.muted }}>
        {label}
      </span>
    </div>
  );
}

export function StatCard({ label, value, unit, delta, deltaLabel = "vs. semana anterior", color = C.teal, icon }) {
  const positive = delta ? delta.startsWith("+") : false;
  return (
    <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: C.muted }}>
          {label}
        </span>
        {icon && <span style={{ color }}>{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold" style={{ color: C.text }}>
          {value}
        </span>
        {unit && (
          <span className="text-xs" style={{ color: C.muted }}>
            {unit}
          </span>
        )}
      </div>
      {delta && (
        <div className="mt-1 text-xs">
          <span style={{ color: positive ? C.green : C.red }}>{delta}</span>{" "}
          <span style={{ color: C.muted }}>{deltaLabel}</span>
        </div>
      )}
    </div>
  );
}

export { fmtTime };
