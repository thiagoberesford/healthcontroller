import React, { useState } from "react";
import { Card } from "./ui.jsx";
import { C } from "../theme.js";
import { sbSignIn } from "../lib/api.js";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const msg = await sbSignIn(email.trim(), password);
    if (msg) setError(msg);
  };

  const inputStyle = { background: C.card2, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div className="mx-auto max-w-sm pt-10">
      <Card className="p-6">
        <h2 className="mb-1 text-lg font-bold" style={{ color: C.text }}>
          Entrar
        </h2>
        <p className="mb-4 text-xs" style={{ color: C.muted }}>
          Os teus dados de saúde estão protegidos — inicia sessão para os ver.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={inputStyle}
          />
          {error && (
            <p className="text-xs" style={{ color: C.red }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg py-2 text-sm font-semibold"
            style={{ background: C.teal, color: "#04141a" }}
          >
            Entrar
          </button>
        </form>
      </Card>
    </div>
  );
}
