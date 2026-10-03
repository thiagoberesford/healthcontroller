# Health Controller

App pessoal de saúde: **treinos, sono, corpo e nutrição** — 7 anos de histórico Garmin,
pesagens automáticas da balança Xiaomi e parser de refeições com LLM.

**https://thiagoberesford.github.io/healthcontroller/** — PWA (instalável no telemóvel), login obrigatório.

## Funcionalidades

### Treinos
- Histórico completo do Garmin Connect: **1.437 atividades desde 2019** (corrida, força, esteira…) + métricas diárias (passos, sono, HRV, FC repouso, VO₂máx) de **2.656 dias**
- Filtros por período: hoje / 7d / 30d / 90d / 1 ano / tudo / **intervalo personalizado**
- Stats vs. período anterior equivalente; gráfico de km por dia/semana/mês
- **Detalhe de cada atividade** (clicável): mapa Leaflet com o traçado (tiles Esri dark),
  splits por km com desvio de ritmo, FC no tempo, zonas Z1-Z5, cadência, ténis usado
- **Melhores marcas oficiais** (1 km, 1 milha, 5/10 km, meia, maratona) — cards clicáveis
  que abrem a atividade recorde

### Corpo (balança Xiaomi Mi Body Composition Scale 2)
- Leitura **Bluetooth direta no Mac** (`scale_listener.py` + LaunchAgent): pisar a balança
  → aparece no site, sem app nem export
- Peso, impedância e composição (gordura, água, músculo esquelético, massa óssea,
  visceral) com as fórmulas do openScale — **validadas contra a app Mi Fitness**
- Uma pesagem por dia; a última com composição completa ganha; re-broadcasts ignorados
- Controlo de peso começa em 03/10/2026 (histórico anterior removido por decisão do utilizador)

### Nutrição
- Base com **~2.2k alimentos portugueses**: marcas do Open Food Facts (Continente, Pingo
  Doce, Mimosa, Danone, Milbona…) + genéricos curados (francesinha, pão de mistura, café…)
- **Autocomplete** sobre toda a base + **alimentos personalizados** (ficam guardados)
- **Linguagem natural com LLM** (Mistral, via Supabase Edge Function): "comi uma tosta de
  queijo (3 fatias de queijo e duas de pão) e um galão de 250ml" → itens com gramas e macros;
  ancoragem à base apenas quando escreves a marca; estimativas com badge ≈
- Refeições guardadas no Supabase, com anéis de hoje e evolução 14 dias

### Visão geral
- Últimos 14 dias **com dados reais** (rotulados com a data): passos, calorias ativas,
  sono, HRV, FC repouso, VO₂máx com tendência, gasto diário

## Arquitetura

```
┌─ GitHub Pages (React + Vite + Tailwind + Recharts, PWA)
│    └─ supabase-js (sessão Auth; RLS só para utilizadores autenticados)
│
├─ Supabase Postgres
│    activities (garmin + suunto) · daily · activity_details (jsonb: polyline/HR/splits)
│    personal_records · body_metrics · meals · foods
│
├─ Edge Function (Deno)  parse-meal → API Mistral (key em secrets)
│
└─ Mac (scripts Python, backend/.env local)
     scale_listener.py  balança Xiaomi via BLE (LaunchAgent, contínuo)
     garmin_snapshot.py export completo do Garmin (resumível)
     garmin_details.py   detalhes por atividade + PRs + VO₂máx
     import_supabase.py  upsert idempotente de tudo → Supabase
     suunto_sync.py      sync diário Suunto (suuntool; pronto, à espera do relógio)
     body_sync.py        import retrospetivo de pesagens (CSV/JSON)
     build_food_db.py    colheita do Open Food Facts + curadoria
```

O backend FastAPI é opcional (dev); a app funciona 100% serverless no Pages + Supabase.

## Quickstart (dev)

```bash
# frontend
cd frontend && npm install && npm run dev   # proxy /api -> localhost:8000

# backend (opcional)
cd backend && pip install -e ".[dev]" && uvicorn app.main:app --reload

# scripts (precisam de backend/.env: credenciais Garmin/Suunto, SUPABASE_DB_URL)
cd backend && .venv/bin/python scripts/import_supabase.py
```

## Estado das fases

- **Fase 1** (concluída): Pages + parser de refeições
- **Fase 2** (concluída): Supabase (persistência + Auth/RLS) + Garmin Connect
  (histórico completo; **arquivo congelado em 07/10/2026**)
- **Fase 3** (em curso): **Suunto** como fonte diária (`suuntool` autenticado,
  `suunto_sync.py` pronto) + **balança Xiaomi** (a funcionar) + LLM na nutrição (a funcionar)

## Segurança

- Login obrigatório (email/password Supabase Auth); todas as tabelas com RLS
  `authenticated` — chaves públicas no bundle não dão acesso a dados
- Credenciais (Garmin, Suunto, `SUPABASE_DB_URL`, `MISTRAL_API_KEY`) apenas em
  `.env` local / secrets — nunca no repo
- `frontend/.env.production` contém só a publishable key do Supabase (pública por design)
