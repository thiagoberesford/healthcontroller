import React, { useEffect, useState } from "react";
import { C, setTheme, savedThemeIsLight } from "./theme.js";
import { api, SUPABASE_ENABLED, sbUser, sbSignOut, onSbAuthChange } from "./lib/api.js";
import LoginScreen from "./components/LoginScreen.jsx";
import OverviewTab from "./components/OverviewTab.jsx";
import TrainingTab from "./components/TrainingTab.jsx";
import BodyTab from "./components/BodyTab.jsx";
import NutritionTab from "./components/NutritionTab.jsx";
import CoachChat from "./components/CoachChat.jsx";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "training", label: "Treinos" },
  { id: "body", label: "Corpo" },
  { id: "nutrition", label: "Nutrição" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  const [lightTheme, setLightTheme] = useState(savedThemeIsLight());
  const [mode, setMode] = useState("local");
  const [user, setUser] = useState(SUPABASE_ENABLED ? undefined : null);
  const [meals, setMeals] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    sbUser().then((u) => {
      setUser(u);
      if (u) api.migrateLocalToSupabase();
    });
    return onSbAuthChange(setUser);
  }, []);

  useEffect(() => {
    (async () => {
      await api.probe();
      setMode(api.mode);
      setMeals(await api.listMeals());
    })();
  }, [refreshKey, user]);

  if (SUPABASE_ENABLED && user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: C.bg }}>
        <span className="text-sm" style={{ color: C.muted }}>A carregar…</span>
      </div>
    );
  }

  if (SUPABASE_ENABLED && !user) return <LoginScreen />;

  const supabaseBadge = user ? (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(74,222,128,.15)", color: C.green }}>
      ● {user.email}
    </span>
  ) : null;

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
          {supabaseBadge}
          {badge}
          {user && (
            <button
              onClick={() => sbSignOut()}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted }}
            >
              Sair
            </button>
          )}
          <button
            onClick={() => {
              setLightTheme((v) => {
                setTheme(!v);
                return !v;
              });
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
            title="Alternar tema"
          >
            {lightTheme ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            )}
          </button>
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

      {tab === "overview" && <OverviewTab meals={meals} refreshKey={refreshKey} />}
      {tab === "training" && <TrainingTab refreshKey={refreshKey} />}
      {tab === "body" && <BodyTab onSaved={() => setRefreshKey((k) => k + 1)} refreshKey={refreshKey} />}
      {tab === "nutrition" && (
        <NutritionTab
          meals={meals}
          refreshKey={refreshKey}
          addMeal={() => setRefreshKey((k) => k + 1)}
          removeMeal={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <footer className="mt-10 pb-6 text-center text-xs" style={{ color: C.muted }}>
        Dados Garmin no Supabase (acesso com login) · refeições no navegador/backend local · Suunto na Fase 3
        <span className="ml-2 opacity-50">· build 2026-10-11a</span>
      </footer>

      {SUPABASE_ENABLED && user && <CoachChat />}
    </div>
  );
}
