/* Dados de exemplo (mock Garmin/Suunto/Mi Scale) usados enquanto não há backend sincronizado. */
const today = new Date();
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const todayIso = isoDate(today);
export const dayLabel = (d) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const rand = (min, max, seed) => {
  const x = Math.sin(seed * 999) * 10000;
  const frac = x - Math.floor(x);
  return Math.round(min + frac * (max - min));
};

const DAYS14 = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() - (13 - i));
  return dayLabel(d);
});

export const daily = DAYS14.map((label, i) => ({
  label,
  steps: rand(5200, 14200, i + 1),
  caloriesBurned: rand(2050, 2950, i + 2),
  activeCalories: rand(320, 880, i + 3),
  sleepHours: +(rand(580, 490, i + 4) / 100).toFixed(1),
  restingHr: rand(52, 61, i + 5),
  hrv: rand(48, 78, i + 6),
  load: rand(120, 640, i + 7),
}));

export const activities = [
  { date: DAYS14[13], name: "Corrida — Parque", type: "Corrida", km: 8.2, time: 2760, hr: 152, kcal: 640, load: 210 },
  { date: DAYS14[12], name: "Ginásio — Pernas", type: "Força", km: 0, time: 3600, hr: 124, kcal: 420, load: 180 },
  { date: DAYS14[11], name: "Descanso", type: "Descanso", km: 0, time: 0, hr: 0, kcal: 0, load: 0 },
  { date: DAYS14[10], name: "Corrida longa", type: "Corrida", km: 14.5, time: 5100, hr: 146, kcal: 1120, load: 380 },
  { date: DAYS14[8], name: "Ginásio — Peito/Tríceps", type: "Força", km: 0, time: 3300, hr: 118, kcal: 380, load: 150 },
  { date: DAYS14[6], name: "Intervalado 6x800m", type: "Corrida", km: 9.1, time: 2820, hr: 165, kcal: 720, load: 290 },
  { date: DAYS14[4], name: "Ginásio — Costas/Bíceps", type: "Força", km: 0, time: 3450, hr: 120, kcal: 400, load: 160 },
  { date: DAYS14[2], name: "Corrida regenerativa", type: "Corrida", km: 6.0, time: 2280, hr: 132, kcal: 430, load: 90 },
];

export const bodyMeasurements = [0, 2, 4, 6, 8, 10, 12].map((back) => {
  const d = new Date(today);
  d.setDate(d.getDate() - back);
  const t = (14 - back) / 14;
  const w = 82.4 - 1.6 * t + Math.sin(back * 3.7) * 0.15;
  return {
    label: dayLabel(d),
    date: isoDate(d),
    weight: +w.toFixed(1),
    muscle: +(34.2 + 0.9 * t).toFixed(1),
    fat: +(19.8 - 0.8 * t).toFixed(1),
    bmi: +(w / Math.pow(1.78, 2)).toFixed(1),
    water: +(55.2 + 0.3 * t).toFixed(1),
    bone: 3.4,
    visceral: Math.max(6, Math.round(8 - 1 * t)),
  };
});

export const last14Labels = DAYS14;

/* Fallback do modo local: mesmas atividades mock no formato resumido do Garmin. */
const MOCK_TYPE = { Corrida: "running", "Força": "strength_training" };
export function mockGarminActivities(start, end) {
  return activities
    .map((a) => {
      const idx = DAYS14.indexOf(a.date);
      if (idx < 0) return null;
      const d = new Date(today);
      d.setDate(d.getDate() - (13 - idx));
      return {
        id: `mock-${idx}`,
        name: a.name,
        type: MOCK_TYPE[a.type] || "other",
        start: `${isoDate(d)} ${a.type === "Corrida" ? "08:00:00" : "19:00:00"}`,
        distance_km: a.km || 0,
        duration_s: a.time || 0,
        kcal: a.kcal || 0,
        avg_hr: a.hr || null,
      };
    })
    .filter(Boolean)
    .filter((a) => (!start || a.start.slice(0, 10) >= start) && (!end || a.start.slice(0, 10) <= end))
    .sort((a, b) => b.start.localeCompare(a.start));
}
