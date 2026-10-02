# Arquitetura

```
┌─────────────────────────┐        ┌──────────────────────┐
│  Frontend (GitHub Pages)│  HTTP  │  Backend FastAPI      │
│  React + Vite           │───────>│  (opcional, localhost │
│  - localStorage         │  /api  │   ou host gratuito)   │
│  - foodParser.js local  │        │  - food_db (parser)   │
│  - api.js dual-mode     │        │  - storage (JSON)     │
└─────────────────────────┘        │  - garmin_service    │
                                   │  - suunto_service    │
                                   └──────────────────────┘
```

## Modo dual (chave do design)

O GitHub Pages só serve ficheiros estáticos. Por isso o frontend funciona sozinho:
- `src/lib/api.js` faz `probe()` em `/api/health` no arranque.
- Sem backend → badge "modo local", dados no `localStorage`, parser em JS (`foodParser.js`).
- Com backend (`VITE_API_BASE` ou proxy do Vite em dev) → badge "backend conectado", dados no storage do backend.

## Parser de refeições

Mesma lógica nos dois lados (mantê-los em sincronia):
- `backend/app/services/food_db.py` (fonte da verdade)
- `frontend/src/lib/foodParser.js` (espelho JS)

Reconhece quantidade ("duas", "200g"), unidades ("fatia", "colher", "prato") e ~30 alimentos pt-BR com macros por 100g (TACO/USDA aproximados).

## Fase 2 — Supabase

Trocar `storage.py` (JSON) por Supabase: mesmo schema (`meals`, `body`), auth opcional.
O frontend continua idêntico — só o backend muda.

## Fase 3 — Dispositivos

- Garmin: `garminconnect` (login 1x, token em `~/.garminconnect`), cache diário em `backend/data/garmin_cache.json`. Alternativas MCP: garmin_mcp (Taxuspt), garmin-connect-mcp (eddmann).
- Suunto: stub pronto; integrar via export do Suunto app ou suuntool.
- Balança Xiaomi: xiaomi-scale-mcp.
