/* Dados de exemplo usados enquanto não há backend sincronizado.
   Séries de treinos/diários são sempre reais (Supabase/ Garmin); mock apenas para corpo. */
const today = new Date();
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const todayIso = isoDate(today);
export const dayLabel = (d) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

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
