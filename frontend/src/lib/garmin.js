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
