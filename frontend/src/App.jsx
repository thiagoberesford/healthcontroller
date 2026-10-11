import React, { useEffect, useState } from "react";
import { C, setTheme, savedThemeIsLight } from "./theme.js";
import { api, SUPABASE_ENABLED, sbUser, sbSignOut, onSbAuthChange } from "./lib/api.js";
import LoginScreen from "./components/LoginScreen.jsx";
import OverviewTab from "./components/OverviewTab.jsx";
import TrainingTab from "./components/TrainingTab.jsx";
import BodyTab from "./components/BodyTab.jsx";
import NutritionTab from "./components/NutritionTab.jsx";
import ShoesTab from "./components/ShoesTab.jsx";
import CoachChat from "./components/CoachChat.jsx";

const TABS = [
  { id: "overview", label: "Visão geral" },
  { id: "training", label: "Treinos" },
  { id: "body", label: "Corpo" },
  { id: "nutrition", label: "Nutrição" },
  { id: "shoes", label: "Ténis" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  const [lightTheme, setLightTheme] = useState(savedThemeIsLight());
  const [mode, setMode] = useState("local");
  const [user, setUser] = useState(SUPABASE_ENABLED ? undefined : null);
  const [meals, setMeals] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);

  /* E4: theme-color dinâmica ao alternar tema */
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", lightTheme ? "#f5f6f8" : "#0e1116");
  }, [lightTheme]);

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
          {/* E5: badges colapsam num ícone de conta no mobile */}
          <div className="hidden items-center gap-3 sm:flex">
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
          </div>
          {user && (
            <div className="relative sm:hidden">
              <button
                onClick={() => setAccountOpen((v) => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                title="Conta"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
                </svg>
              </button>
              {accountOpen && (
                <div
                  className="absolute right-0 top-12 z-50 w-52 rounded-xl p-3 text-xs"
                  style={{ background: C.card, border: `1px solid ${C.border}` }}
                  onClick={() => setAccountOpen(false)}
                >
                  <p className="mb-2 break-all" style={{ color: C.muted }}>{user.email}</p>
                  <button
                    onClick={() => sbSignOut()}
                    className="w-full rounded-lg px-3 py-2 font-semibold"
                    style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}
                  >
                    Sair
                  </button>
                </div>
              )}
            </div>
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

      {/* E1: nav do topo só em desktop */}
      <nav className="mb-6 hidden gap-2 overflow-x-auto sm:flex">
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
      {tab === "shoes" && <ShoesTab refreshKey={refreshKey} />}

      <footer className="mt-10 pb-24 text-center text-xs sm:pb-6" style={{ color: C.muted }}>
        Treinos: arquivo Garmin (7 anos) + Suunto em direto · nutrição com LLM · plano Treinus ·
        balança Xiaomi BLE — tudo no Supabase (login)
        <span className="ml-2 opacity-50">· build 2026-10-11b</span>
      </footer>

      {SUPABASE_ENABLED && user && <CoachChat />}

      {/* E1: bottom tab bar no mobile */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t sm:hidden"
        style={{
          background: C.card,
          borderColor: C.border,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold"
            style={{ color: tab === t.id ? C.teal : C.muted }}
          >
            <TabIcon id={t.id} active={tab === t.id} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function TabIcon({ id, active }) {
  const stroke = active ? "#00b4b3" : "#7a8290";
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", stroke };
  switch (id) {
    case "overview":
      return (
        <svg {...common}>
          <path d="M3 12h4l2-7 4 14 2-7h6" />
        </svg>
      );
    case "training":
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v6l-3 6M12 13l3 6M8 9l-4 2M16 9l4 2" />
        </svg>
      );
    case "body":
      return (
        <svg {...common}>
          <path d="M12 3a7 7 0 0 1 7 7c0 3-2 4-2 6s2 2 2 4H5c0-2 2-2 2-4s-2-3-2-6a7 7 0 0 1 7-7z" />
        </svg>
      );
    case "nutrition":
      return (
        <svg {...common}>
          <path d="M6 3v8a3 3 0 0 0 6 0V3M9 11v10M15 3c-1.5 2-2 4-2 6s1 3 2 3 2-1 2-3-0.5-4-2-6zM17 12v9" />
        </svg>
      );
    case "shoes":
      return (
        <svg {...common}>
          <path d="M2 15c2-1 3-4 5-5 1.6-.8 3 .2 4 1 1 .7 2 .6 3 .3 2-.7 4.5-.4 6 1.6 1 1.4 1.6 2.6 1.6 4H3c-1 0-1.4-1.7-1-2.9z" />
        </svg>
      );
    default:
      return null;
  }
}
