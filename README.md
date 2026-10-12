# Health Controller

App pessoal de saúde: **treinos, sono, corpo, nutrição e ténis** — 7 anos de histórico Garmin
(arquivo congelado), **Suunto** como fonte diária, plano de treinos do **Treinus** com push
aprovado para o relógio, pesagens automáticas da balança Xiaomi, parser de refeições com LLM
e **treinador conversacional** com function calling.

**https://thiagoberesford.github.io/healthcontroller/** — PWA (instalável no telemóvel, tabs
no fundo e modais como bottom sheets), login obrigatório.

## Funcionalidades

### Treinos
- **Duas fontes unificadas**: arquivo completo do Garmin Connect (**1.437 atividades desde
  2019**, métricas diárias de 2.656 dias) + **Suunto em direto** (treinos, passos, kcal
  ativas, sono — com sonecas contadas no total diário, HRV — sync a cada 30 min via
  `suuntool`); merge por campo, sem buracos
- Filtros por período: hoje / 7d / 30d / 90d / 1 ano / tudo / **intervalo personalizado**;
  stats vs. período anterior; gráfico de km por dia e **evolução VO₂máx**
- **Calendário mensal** ao lado do plano: círculos por dia (laranja treino feito, teal
  planeado, verde plano cumprido), resumo do mês (dias ativos/km/horas), clique num dia
  abre os treinos; vista "Calendário" em página inteira como alternativa
- **Detalhe de cada atividade** (clicável): mapa Leaflet com o traçado, splits por km,
  zonas Z1-Z5, estrutura do treino em texto ("aquecimento + 10 intervalos de 2m + desaquecimento"),
  **RPE/feeling pós-treino** editável e **rotinas de força** (séries × reps × peso, com
  lembrete do último treino)
- **Melhores marcas oficiais** (1 km, 1 milha, 5/10 km, meia, maratona) — cards clicáveis
- **Mapa de percursos** (todas as polylines num único mapa, filtros por período/tipo) e
  **Relatório anual** (km, sessões, consistência, km por sapatilha, recordes do ano)

### Camada analítica (calculada no sync, o frontend só lê)
- **TSS oficial do Suunto** por atividade; TRIMP de Banister para o arquivo Garmin
- **CTL (42d) / ATL (7d) / TSB** + rácio agudo:crónico com zona de risco — gráfico
  "Forma" na Visão Geral (14d visíveis, cálculo sobre todo o histórico)
- **Readiness diário** (sono + HRV + TSB + carga aguda) com anel e mensagem
  ("dia para treino forte" / "moderado" / "recuperação") no **Morning Report**
- **Banda pessoal de HRV** (baseline 60d recalculada no sync) com estado colorido
- **Race predictor** (Riegel + VO₂máx): 5k/10k/meia/maratona, com evolução temporal
- Streak de dias ativos + **meta mensal de km** editável

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

### Ginásio (plano ABC → relógio)
- Treinos A/B/C (7 exercícios, 45s trabalho / 75s descanso, bike final) como guias
  cronometradas — mesmo fluxo aprovado do Treinus: clique "→ relógio" no site →
  fila → worker → guia "Ginásio A/B/C" no relógio; card com exercícios expandível
  e plano editável em `backend/data/gym_plan.json`

### Corpo (balança Xiaomi Mi Body Composition Scale 2)
- Leitura **Bluetooth direta no Mac** (`scale_listener.py` + LaunchAgent): pisar a balança
  → aparece no site, sem app nem export
- Peso, impedância e composição (gordura, água, músculo esquelético, massa óssea,
  visceral) com as fórmulas do openScale — **validadas contra a app Mi Fitness**
- Uma pesagem por dia; a última com composição completa ganha; re-broadcasts e pesagens
  sem impedância válida são ignorados; controlo de peso começa em 03/10/2026

### Ténis
- Aba própria: km por sapatilha, data de início de uso, estado (ativo/reformado)
- Atribuição de ténis por treino no detalhe da atividade; corridas sem ténis atribuído
  pedem confirmação; km por sapatilha no relatório anual

### Nutrição
- Base com **~2.2k alimentos portugueses** (Open Food Facts + **FatSecret via OAuth1** +
  genéricos curados) que **se enriquece sozinha**: produtos validados ficam guardados
- **Autocomplete** sobre toda a base + **alimentos personalizados** (nome e macros editáveis)
- **Linguagem natural 100% IA** (Mistral, Edge Function): "comi uma tosta de queijo e um
  galão de 250ml" → itens com macros reais quando há produto na base/FatSecret, estimativa
  ≈ quando não há; quantidades editáveis inline antes de guardar
- **Balanço calórico diário**: ingerido − kcal ativas (que já incluem treinos; sem double
  counting), com breakdown de kcal do treino no tooltip
- **Metas**: 1.800 kcal/dia e 1,6 g proteína/kg (base científica para perda de peso);
  refeições agrupadas por dia; hidratação (meta 3L) no mesmo separador

### Treinador (coach chat)
- Chat flutuante em todas as abas com **streaming** e function calling contra o Supabase
  (JWT do utilizador — RLS aplicado): atividades, daily, corpo, refeições, hidratação,
  recordes e plano Treinus — responde com os números reais, nunca inventa

### Visão geral
- **Morning Report** no topo: readiness + noite (sono, HRV, FC repouso) + treino planeado
  de hoje + sugestão de ação
- Últimos 14 dias **com dados reais** (rotulados com a data): passos, calorias ativas,
  sono (HH:MM, sempre a última noite completa), HRV vs. banda pessoal, FC repouso,
  VO₂máx, gasto diário (BMR + ativas)
- **Todos os cards clicáveis** → modal com gráfico do período e **comparação de métricas**
  (eixos duplos, presets guardados)
- **Tema claro/escuro** com ícone; auto-refresh a cada 60s; mobile: bottom tab bar,
  conta colapsada num ícone, `theme-color` dinâmica

## Arquitetura

```
┌─ GitHub Pages (React + Vite + Tailwind + Recharts + Leaflet, PWA)
│    └─ supabase-js (sessão Auth; RLS só para utilizadores autenticados)
│
├─ Supabase Postgres
│    activities (garmin congelado + suunto, tss) · daily (merge por campo)
│    activity_details (jsonb: polyline/HR/splits) · personal_records
│    training_load (tss/ctl/atl/tsb/acr/readiness/hrv/predições/streak)
│    activity_notes (rpe/feeling) · strength_sets · monthly_goal
│    body_metrics · meals · foods · hydration
│    shoes · shoe_assignments
│    planned_workouts (plano Treinus + push_status) · guide_push_queue
│
├─ Edge Functions (Deno)
│    parse-meal   → Mistral + FatSecret/OFF (keys em secrets)
│    coach-chat   → Mistral + function calling (7 ferramentas, RLS via JWT)
│
└─ Mac (scripts Python, backend/.env local; LaunchAgents)
     scale_listener.py       balança Xiaomi via BLE (contínuo)
     suunto_sync.py          treinos + wellness + guias (a cada 30 min)
     suunto_details.py       SML → detalhes por atividade (mapa/splits)
     training_load_sync.py   TSS/CTL/ATL/TSB/readiness/predições (após o suunto_sync)
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
  **balança Xiaomi** + LLM na nutrição + hidratação + tema claro/escuro
- **Fase 4** (concluída): **Treinus** — plano no site com push aprovado para o relógio
- **Fase 5** (concluída): camada analítica (TSS/CTL/ATL/TSB, readiness, race predictor,
  morning report), coach chat, ténis, balanço calórico + metas, calendário, força,
  relatório anual, comparar métricas, heatmap de percursos, mobile PWA

## Segurança

- Login obrigatório (email/password Supabase Auth); todas as tabelas com RLS
  `authenticated` — chaves públicas no bundle não dão acesso a dados
- Signup público desativado; 2FA ativa no GitHub e no Supabase
- Edge Functions com CORS restrito ao domínio do Pages
- Credenciais (Suunto, Treinus, `SUPABASE_DB_URL`, `MISTRAL_API_KEY`, FatSecret) apenas
  em `.env` local / secrets — nunca no repo
- `frontend/.env.production` contém só a publishable key do Supabase (pública por design)
