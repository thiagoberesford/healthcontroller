import React, { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import { api } from "../lib/api.js";

const TOOL_LABEL = {
  query_activities: "atividades",
  query_daily: "métricas diárias",
  query_body: "corpo",
  query_meals: "refeições",
  query_hydration: "hidratação",
  get_personal_records: "melhores marcas",
  get_planned_workouts: "treinos planeados",
};

export default function CoachChat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]); // {role: "user"|"coach", text, tools?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const history = msgs
      .filter((m) => !m.error && m.text)
      .map((m) => ({ role: m.role === "coach" ? "assistant" : "user", content: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "coach", text: "" }]);
    setBusy(true);
    await api.coachChat(q, history, (ev) => {
      if (ev.type === "tools") {
        setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            tools: ev.names.map((n) => TOOL_LABEL[n] || n),
          };
          return copy;
        });
      } else if (ev.type === "token") {
        setMsgs((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, text: (last.text || "") + ev.v };
          return copy;
        });
      } else if (ev.type === "error") {
        setMsgs((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = {
            ...last,
            text: last.text || "Erro na resposta.",
            error: ev.error,
          };
          return copy;
        });
      }
    });
    setBusy(false);
  };

  return (
    <>
      {/* botão flutuante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-transform hover:scale-105"
          style={{
            background: "#00b4b3",
            border: "3px solid #ffffff40",
            color: "#04141a",
          }}
          title="Treinador"
          aria-label="Abrir o treinador"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* painel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-40 flex w-[92vw] max-w-sm flex-col overflow-hidden rounded-xl shadow-2xl sm:w-96"
          style={{ background: C.card, border: `1px solid ${C.border}`, height: 480 }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: C.card2, borderBottom: `1px solid ${C.border}` }}
          >
            <span className="text-sm font-semibold" style={{ color: C.text }}>
              Treinador
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-xs font-semibold"
              style={{ color: C.muted }}
            >
              fechar
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {msgs.length === 0 && (
              <p className="px-1 text-xs leading-5" style={{ color: C.muted }}>
                Pergunta o que quiseres sobre os teus dados: "quantos km corri este mês?",
                "como está o meu sono esta semana?", "estou a comer acima da meta?"
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <div
                  className="inline-block max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm"
                  style={
                    m.role === "user"
                      ? { background: C.teal, color: "#04141a", textAlign: "left" }
                      : { background: C.card2, color: C.text, border: `1px solid ${C.border}` }
                  }
                >
                  {m.text || (busy && i === msgs.length - 1 ? "…" : "")}
                  {m.tools?.length > 0 && (
                    <div
                      className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px]"
                      style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}
                    >
                      consultou: {m.tools.join(", ")}
                    </div>
                  )}
                  {m.error && (
                    <div className="mt-1 text-[10px]" style={{ color: C.orange }}>
                      {m.error}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 p-3" style={{ borderTop: `1px solid ${C.border}` }}>
            <input
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              placeholder="Pergunta ao treinador…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              style={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
            />
            <button
              onClick={ask}
              disabled={busy || !input.trim()}
              className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
              style={{ background: C.teal, color: "#04141a" }}
            >
              {busy ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
