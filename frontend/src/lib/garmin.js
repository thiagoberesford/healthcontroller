/* Helpers partilhados para dados Garmin. */
import { C } from "../theme.js";

export const RUN_TYPES = new Set(["running", "treadmill_running", "trail_running"]);

export const TYPE_LABEL = {
  running: "Corrida",
  treadmill_running: "Esteira",
  trail_running: "Trail",
  strength_training: "Força",
  indoor_cycling: "Bicicleta indoor",
  walking: "Caminhada",
  other: "Outro",
};

export const TYPE_COLOR = {
  running: C.blue,
  treadmill_running: "#60a5fa",
  trail_running: C.teal,
  strength_training: C.orange,
  indoor_cycling: C.green,
  walking: C.muted,
  other: C.purple,
};

export const fmtDate = (iso) => {
  const [y, m, day] = iso.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

export const fmtKcal = (kcal) =>
  kcal ? Math.round(kcal).toLocaleString("pt-BR") : "—";

export const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

export const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateKey(d);
};

export const dayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/* 223.7 -> "3:43.7" | 5828 -> "1:37:08" */
export const fmtRecord = (s) => {
  if (!s && s !== 0) return "—";
  const total = Math.round(s * 10); // décimos com transporte
  const ms = total % 10;
  const sec = Math.floor(total / 10);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}${ms ? "." + ms : ""}`;
};

/* m/s -> "5:39/km" */
export const fmtPace = (speedMs) => {
  if (!speedMs || speedMs <= 0) return "—";
  const tot = Math.round(1000 / speedMs); // arredonda o total antes de decompor
  return `${Math.floor(tot / 60)}:${String(tot % 60).padStart(2, "0")}`;
};

export const fmtDuration = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};
