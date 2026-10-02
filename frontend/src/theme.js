/* Paleta inspirada em Garmin (azul/teal), Coros (cards escuros) e Suunto (laranja) */
export const C = {
  bg: "#0e1116",
  card: "#171c24",
  card2: "#1e242f",
  border: "#2a3140",
  text: "#e7ecf3",
  muted: "#8b97a8",
  teal: "#00b4b3",
  blue: "#3b82f6",
  orange: "#ff5d1f",
  green: "#4ade80",
  purple: "#a78bfa",
  red: "#f87171",
};

export const axisProps = { stroke: C.muted, fontSize: 11 };

export const tooltipStyle = {
  background: C.card2,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  color: C.text,
  fontSize: 12,
};

export const fmtTime = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
};
