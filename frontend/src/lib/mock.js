/* Dados de exemplo (mock Garmin/Suunto/Mi Scale) usados enquanto não há backend sincronizado.
   Nota: atividades são sempre reais (Garmin via backend); mocks apenas para séries diárias/corpo. */
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
