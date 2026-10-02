# Health Controller

App pessoal de saúde: treinos, sono, nutrição (com parser de refeições em linguagem natural, pt-BR) e composição corporal.

**Frontend (React + Vite + Tailwind + Recharts)** publicado no GitHub Pages:
https://thiagoberesford.github.io/healthcontroller/

Funciona em **modo local** (dados no `localStorage` do navegador) e, se um backend estiver disponível (`VITE_API_BASE`), sincroniza automaticamente — o badge no cabeçalho indica o modo ativo.

## Estrutura

```
frontend/   React + Vite (deploy no GitHub Pages via Actions)
backend/    FastAPI opcional (parser, storage JSON, Garmin, stub Suunto)
docs/       Arquitetura e notas de integração
```

## Quickstart (local, com backend)

```bash
# backend
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload        # http://localhost:8000/docs

# frontend
cd ../frontend
npm install
npm run dev                          # proxy /api -> localhost:8000
```

## Quickstart (só frontend)

```bash
cd frontend && npm install && npm run dev
```

## Fases

- **Fase 1 (atual):** Pages + modo local + parser local de refeições
- **Fase 2:** Supabase (persistência na cloud sem servidor) + Garmin Connect (MCP/garminconnect)
- **Fase 3:** Suunto (export do app / suuntool) + balança Xiaomi (xiaomi-scale-mcp)
