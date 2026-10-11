/* Paleta via CSS vars (ver index.css) — o toggle light/dark muda a
   classe 'light' no <html> e os getters releem os valores em cada render. */
const cssVar = (name) =>
  typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const C = {
  get bg() { return cssVar("--bg"); },
  get card() { return cssVar("--card"); },
  get card2() { return cssVar("--card2"); },
  get border() { return cssVar("--border"); },
  get text() { return cssVar("--text"); },
  get muted() { return cssVar("--muted"); },
  get teal() { return cssVar("--teal"); },
  get blue() { return cssVar("--blue"); },
  get orange() { return cssVar("--orange"); },
  get green() { return cssVar("--green"); },
  get purple() { return cssVar("--purple"); },
  get red() { return cssVar("--red"); },
};

export const axisProps = {
  get stroke() { return C.muted; },
  fontSize: 11,
  /* E4: menos ticks no eixo X em mobile (<640px); desktop mantém o
     auto-thinning do Recharts (preserveEnd) — interval=0 forçava todos */
  get interval() {
    if (typeof window === "undefined") return "preserveEnd";
    return window.innerWidth < 640 ? 2 : "preserveEnd";
  },
};

/* E4: para séries longas, ~5 etiquetas no eixo X em mobile (<640px);
   desktop mantém o auto-thinning do Recharts (preserveEnd). */
export const tickInterval = (n) => {
  if (typeof window === "undefined" || window.innerWidth >= 640) return "preserveEnd";
  return Math.max(1, Math.ceil((n || 1) / 5) - 1);
};

export const tooltipStyle = {
  get background() { return C.card2; },
  get border() { return `1px solid ${C.border}`; },
  borderRadius: 10,
  get color() { return C.text; },
  fontSize: 12,
};

export const fmtTime = (s) => {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
};

/* ---- tema ---- */
export const isLight = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("light");

export function setTheme(light) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", light);
  try {
    localStorage.setItem("hc-theme", light ? "light" : "dark");
  } catch (e) {}
}

export const savedThemeIsLight = () => {
  try {
    return localStorage.getItem("hc-theme") === "light";
  } catch (e) {
    return false;
  }
};
