import React, { useEffect, useState } from "react";
import { Card } from "./ui.jsx";
import { C } from "../theme.js";
import { api } from "../lib/api.js";

export default function ShoesTab({ refreshKey }) {
  const [shoes, setShoes] = useState(null);
  const [acts, setActs] = useState([]);
  const [asg, setAsg] = useState([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("700");
  const [start, setStart] = useState("0");
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setShoes(await api.listShoes());
    setAsg(await api.listShoeAssignments());
    // corridas desde o início do regime Suunto (histórico Garmin ignorado)
    setActs(await api.listGarminActivities("2026-10-05", null));
  };
  useEffect(() => {
    load();
  }, [refreshKey]);

  /* km por par: km iniciais + corridas atribuídas */
  const kmByShoe = {};
  for (const s of shoes || []) kmByShoe[s.id] = s.start_km || 0;
  let unassignedRuns = 0;
  for (const a of acts) {
    if (!["running", "trail_running", "treadmill_running"].includes(a.type)) continue;
    const m = (asg || []).find(
      (x) => x.source === a.source && x.source_key === a.source_key,
    );
    if (m) kmByShoe[m.shoe_id] = (kmByShoe[m.shoe_id] || 0) + (a.distance_km || 0);
    else unassignedRuns += 1;
  }

  const add = async () => {
    if (!name.trim()) {
      setMsg("Dá um nome ao par.");
      return;
    }
    const t = parseFloat(String(target).replace(",", ".")) || 700;
    const s = parseFloat(String(start).replace(",", ".")) || 0;
    const saved = await api.addShoe({ name, target_km: t, start_km: s });
    if (!saved) {
      setMsg("Não foi possível guardar (Supabase?).");
      return;
    }
    setName("");
    setTarget("700");
    setStart("0");
    setMsg(null);
    load();
  };

  const setCurrent = async (id) => {
    await api.setCurrentShoe(id);
    load();
  };

  const toggleRetire = async (s) => {
    await api.updateShoe(s.id, { retired: !s.retired, ...(s.is_current && !s.retired ? { is_current: false } : {}) });
    load();
  };

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold" style={{ color: C.text }}>
          🏃 Ténis — registo de pares
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-48 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            placeholder="Nome do par (ex.: ASICS Novablast 5)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            style={inputStyle}
          />
          <input
            type="number"
            className="w-24 rounded-lg px-3 py-2 text-sm outline-none"
            placeholder="meta km"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={inputStyle}
            title="Vida útil de referência (km)"
          />
          <input
            type="number"
            className="w-24 rounded-lg px-3 py-2 text-sm outline-none"
            placeholder="km iniciais"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={inputStyle}
            title="Desgaste que o par já tem (calibrar o contador)"
          />
          <button
            onClick={add}
            className="rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: C.teal, color: "#04141a" }}
          >
            Adicionar
          </button>
        </div>
        {msg && <p className="mt-2 text-xs" style={{ color: C.orange }}>{msg}</p>}
      </Card>

      <Card className="p-4">
        {shoes === null ? (
          <p className="text-sm" style={{ color: C.muted }}>A carregar…</p>
        ) : shoes.length === 0 ? (
          <p className="text-sm" style={{ color: C.muted }}>
            Ainda sem pares registados — adiciona o primeiro em cima.
          </p>
        ) : (
          <div className="space-y-2">
            {shoes.map((s) => {
              const km = +(kmByShoe[s.id] || 0).toFixed(1);
              const pct = Math.min(100, +((km / (s.target_km || 700)) * 100).toFixed(0));
              const warn = pct >= 90 && !s.retired;
              return (
                <div
                  key={s.id}
                  className="rounded-lg px-3 py-2.5"
                  style={{
                    background: s.is_current ? "rgba(0,180,179,.08)" : C.card2,
                    border: `1px solid ${warn ? C.orange : s.is_current ? C.teal : C.border}`,
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: s.retired ? C.muted : C.text }}>
                        {s.name}
                      </span>
                      {s.is_current && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.teal, color: "#04141a" }}>
                          em uso
                        </span>
                      )}
                      {s.retired && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>
                          retirado
                        </span>
                      )}
                      {warn && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(251,146,60,.15)", color: C.orange }}>
                          altura de trocar
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {!s.is_current && !s.retired && (
                        <button
                          onClick={() => setCurrent(s.id)}
                          className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}
                        >
                          usar este
                        </button>
                      )}
                      <button
                        onClick={() => toggleRetire(s)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                        style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted }}
                      >
                        {s.retired ? "reativar" : "retirar"}
                      </button>
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: C.card }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: warn ? C.orange : s.is_current ? C.teal : C.blue,
                        }}
                      />
                    </div>
                    <span className="w-28 text-right text-xs font-medium" style={{ color: C.text }}>
                      {km} / {s.target_km} km
                    </span>
                  </div>
                </div>
              );
            })}
            {unassignedRuns > 0 && (
              <p className="text-xs" style={{ color: C.orange }}>
                {unassignedRuns} corrida{unassignedRuns === 1 ? "" : "s"} ainda sem ténis atribuído —
                confirma no separador Treinos.
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs" style={{ color: C.muted }}>
          km por par = km iniciais + corridas atribuídas (a confirmar no separador Treinos após cada
          treino novo). Contagem a partir de 05/10/2026 — histórico Garmin ignorado.
        </p>
      </Card>
    </div>
  );
}
