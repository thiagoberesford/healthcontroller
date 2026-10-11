import React, { useState } from "react";
import { C } from "../theme.js";
import { api } from "../lib/api.js";
import { dayMonth } from "../lib/garmin.js";

/* Popup: corridas novas sem ténis atribuído — confirma par a par.
   Só com ténis atribuído é que a corrida conta para os km do par. */
export default function ShoeAssignModal({ runs, shoes, onClose, onDone }) {
  const current = shoes.find((s) => s.is_current && !s.retired) || null;
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);

  const shoeFor = (r) => sel[r.source_key] || current?.id || "";

  const save = async () => {
    setBusy(true);
    for (const r of runs) {
      const shoeId = shoeFor(r);
      if (shoeId) {
        await api.setShoeAssignment(r.source, r.source_key, shoeId);
      }
    }
    setBusy(false);
    onDone();
  };

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-sm font-semibold" style={{ color: C.text }}>
          🏃 Corridas sem ténis
        </h3>
        <p className="mb-4 text-xs" style={{ color: C.muted }}>
          {runs.length} treino{runs.length === 1 ? "" : "s"} de corrida à espera de ténis — só contam
          para o desgaste quando atribuídos
          {current ? ` (por defeito: ${current.name})` : ""}.
        </p>
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.source_key} className="flex items-center justify-between gap-2 text-sm">
              <span style={{ color: C.text }}>
                {dayMonth(r.date)} · {r.km} km
              </span>
              <select
                className="rounded-lg px-2 py-1 text-xs outline-none"
                value={shoeFor(r)}
                onChange={(e) => setSel({ ...sel, [r.source_key]: e.target.value })}
                style={inputStyle}
              >
                {shoes.filter((s) => !s.retired).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.is_current ? " (em uso)" : ""}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.muted }}>
            mais tarde
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: C.teal, color: "#04141a" }}
          >
            {busy ? "a guardar…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
