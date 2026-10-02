import React, { useEffect, useState } from "react";
import { C } from "./theme.js";
import { api } from "./lib/api.js";
import OverviewTab from "./components/OverviewTab.jsx";
import TrainingTab from "./components/TrainingTab.jsx";
import BodyTab from "./components/BodyTab.jsx";
import NutritionTab from "./components/NutritionTab.jsx";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "training", label: "Treinos" },
  { id: "body", label: "Corpo" },
  { id: "nutrition", label: "Nutrição" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  const [mode, setMode] = useState("local");
  const [meals, setMeals] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      await api.probe();
      setMode(api.mode);
      setMeals(await api.listMeals());
    })();
  }, [refreshKey]);

  const badge =
    mode === "backend" ? (
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(74,222,128,.15)", color: C.green }}>
        ● backend conectado
      </span>
    ) : (
      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(0,180,179,.15)", color: C.teal }}>
        ● modo local (navegador)
      </span>
    );

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6" style={{ background: C.bg }}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: C.text }}>
            Health <span style={{ color: C.teal }}>Controller</span>
          </h1>
          <p className="text-xs" style={{ color: C.muted }}>
            Treinos · Sono · Corpo · Nutrição
          </p>
        </div>
        <div className="flex items-center gap-3">
          {badge}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
          >
            ↻ Atualizar
          </button>
        </div>
      </header>

      <nav className="mb-6 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              background: tab === t.id ? C.teal : C.card,
              color: tab === t.id ? "#04141a" : C.muted,
              border: `1px solid ${tab === t.id ? C.teal : C.border}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab meals={meals} />}
      {tab === "training" && <TrainingTab />}
      {tab === "body" && <BodyTab onSaved={() => setRefreshKey((k) => k + 1)} />}
      {tab === "nutrition" && (
        <NutritionTab
          meals={meals}
          addMeal={() => setRefreshKey((k) => k + 1)}
          removeMeal={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <footer className="mt-10 pb-6 text-center text-xs" style={{ color: C.muted }}>
        Dados locais no navegador (localStorage) · backend opcional · Garmin/Suunto MCP na Fase 2
      </footer>
    </div>
  );
}
