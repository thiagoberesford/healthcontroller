# Health Controller

App pessoal de saúde: **treinos, sono, corpo e nutrição** — 7 anos de histórico Garmin
(arquivo congelado), **Suunto** como fonte diária, plano de treinos do **Treinus** com push
aprovado para o relógio, pesagens automáticas da balança Xiaomi e parser de refeições com LLM.

**https://thiagoberesford.github.io/healthcontroller/** — PWA (instalável no telemóvel), login obrigatório.

## Funcionalidades

### Treinos
- **Duas fontes unificadas**: arquivo completo do Garmin Connect (**1.437 atividades desde
  2019**, métricas diárias de 2.656 dias) + **Suunto em direto** (treinos, passos, kcal
  ativas, sono, HRV — sync a cada 30 min via `suuntool`); merge por campo, sem buracos
- Filtros por período: hoje / 7d / 30d / 90d / 1 ano / tudo / **intervalo personalizado**
- Stats vs. período anterior; gráfico de km por dia/semana/mês; **evolução VO₂máx**
- **Detalhe de cada atividade** (clicável): mapa Leaflet com o traçado (tiles Esri
  dark/light), splits por km com desvio de ritmo, FC no tempo, zonas Z1-Z5, cadência
  — funciona para Garmin e Suunto (detalhes Suunto calculados a partir do SML bruto:
  coordenadas em radianos, FC em Hz, laps interpolados da série de distância)
- **Melhores marcas oficiais** (1 km, 1 milha, 5/10 km, meia, maratona) — cards clicáveis
  que abrem a atividade recorde

### Plano de treinos (Treinus → site → relógio)
- **Plano autoritativo direto da API do Treinus** (reverse-engineered da app Android):
  briefing completo do treinador, tipo, duração estimada — sempre atualizado
- Card "Plano · Treinus" com os treinos futuros (nome com data: "Rodagem Alternada qui 08/10")
- **Fluxo aprovado pelo utilizador**: nada vai para o relógio sem clique no site
  ("→ relógio") → fila no Supabase → worker no Mac (LaunchAgent, 5 min) → guia SuuntoPlus
  na conta → badge "no relógio" (auto-refresh); idempotente a cliques repetidos
- Guias construídas a partir dos segmentos estruturados do Treinus (aquecimento,
  repetições N×, arrefecimento) com contagem decrescente e voltas automáticas
- Treinos executados seguem a guia no relógio; o site compara plano vs. feito

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
  sono (em HH:MM, sempre a última noite completa), HRV, FC repouso, VO₂máx com tendência
- **Todos os cards clicáveis** → modal com gráfico do período (7d/30d/90d/1 ano/Tudo)
- **Hidratação**: card com meta 3L, botões +250/+500 ml, registo diário no Supabase
- **Tema claro/escuro** com botão de ícone; botão "Atualizar" refresca todas as abas
- Auto-refresh a cada 60s (dados "ao vivo" do sync de 30 min)

## Arquitetura

```
┌─ GitHub Pages (React + Vite + Tailwind + Recharts, PWA)
│    └─ supabase-js (sessão Auth; RLS só para utilizadores autenticados)
│
├─ Supabase Postgres
│    activities (garmin congelado + suunto) · daily (merge por campo)
│    activity_details (jsonb: polyline/HR/splits) · personal_records
│    body_metrics · meals · foods · hydration
│    planned_workouts (plano Treinus + push_status) · guide_push_queue
│
├─ Edge Function (Deno)  parse-meal → API Mistral (key em secrets)
│
└─ Mac (scripts Python, backend/.env local; LaunchAgents)
     scale_listener.py       balança Xiaomi via BLE (contínuo)
     suunto_sync.py          treinos + wellness + guias (a cada 30 min)
     suunto_details.py       SML → detalhes por atividade (mapa/splits)
     guide_push_worker.py    fila do site → guias no relógio (a cada 5 min)
     treinus_sync.py         plano autoritativo da API Treinus (a cada 30 min)
     treinus_guide_fix.py    reconstruir guias SuuntoPlus a partir do plano
     garmin_snapshot.py      export completo do Garmin (resumível; aposentado)
     garmin_details.py       detalhes por atividade + PRs + VO₂máx
     import_supabase.py      upsert idempotente de tudo → Supabase
     body_sync.py            import retrospetivo de pesagens (CSV/JSON)
     build_food_db.py        colheita do Open Food Facts + curadoria
```

O backend FastAPI é opcional (dev); a app funciona 100% serverless no Pages + Supabase.
O Mac é o único componente com "servidor": os LaunchAgents mantêm as fontes locais
(balança BLE, suuntool, Treinus) a alimentar o Supabase sem intervenção.

## Quickstart (dev)

```bash
# frontend
cd frontend && npm install && npm run dev   # proxy /api -> localhost:8000

# backend (opcional)
cd backend && pip install -e ".[dev]" && uvicorn app.main:app --reload

# scripts (precisam de backend/.env: credenciais Suunto/Treinus, SUPABASE_DB_URL)
cd backend && .venv/bin/python scripts/suunto_sync.py
```

## Estado das fases

- **Fase 1** (concluída): Pages + parser de refeições
- **Fase 2** (concluída): Supabase (persistência + Auth/RLS) + Garmin Connect
  (histórico completo; **arquivo congelado em 04/10/2026**)
- **Fase 3** (concluída): **Suunto** como fonte diária (treinos, wellness, detalhes SML) +
  **balança Xiaomi** (a funcionar) + LLM na nutrição (a funcionar) +
  **hidratação** + tema claro/escuro
- **Fase 4** (em curso): **Treinus** — plano no site com push aprovado para o relógio
  (MVP: aprovar/enviar; próximo: edição no site antes do push)

## Segurança

- Login obrigatório (email/password Supabase Auth); todas as tabelas com RLS
  `authenticated` — chaves públicas no bundle não dão acesso a dados
- Signup público desativado; 2FA ativa no GitHub e no Supabase
- Credenciais (Suunto, Treinus, `SUPABASE_DB_URL`, `MISTRAL_API_KEY`) apenas em
  `.env` local / secrets — nunca no repo
- `frontend/.env.production` contém só a publishable key do Supabase (pública por design)
