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
  const ms = Math.round((s % 1) * 10);
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}${ms ? "." + ms : ""}`;
};

/* m/s -> "5:39/km"; s/km direto se negativo/zero tratado fora */
export const fmtPace = (speedMs) => {
  if (!speedMs || speedMs <= 0) return "—";
  const secPerKm = 1000 / speedMs;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
