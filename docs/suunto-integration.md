# Suunto — integração (Fase 3)

Decisão: dados novos a partir de 07/10/2026 vêm do Suunto, sincronizados para o
Supabase com `source='suunto'` (histórico Garmin é imutável).

## Via escolhida: `suuntool` (CLI/MCP não-oficial, backend Sports-Tracker)

> **Atualização 2026-10-03:** a API oficial (apizone.suunto.com) **não está
> disponível para uso pessoal** — Suunto só aceita parceiros. Confirmado com o
> Suunto. A via oficial fica fora; seguimos com o cliente não-oficial, o mesmo
> padrão do `garminconnect` (fala com o backend que o Suunto app usa).

Repositório: https://github.com/tajchert/suuntool (Go, binário estático, macOS/Linux)

Instalação: `brew install --cask tajchert/tap/suuntool`

Comandos relevantes para o sync:

| Necessidade | Comando |
|---|---|
| Autenticar | `suuntool login --email ... --password-stdin` (sessão em `~/.config/suuntool/session.json`) |
| Atividades | `suuntool workouts list --since 7d` (JSON/NDJSON, `--stream` pagina) |
| Detalhe/FIT | `suuntool workouts get wk_...`, `workouts fit wk_... -o out.fit` |
| Diário (passos) | `suuntool wellness activity --since 1d` (`.entryData.stepCount`, kcal etc.) |
| Sono | `suuntool wellness sleep --since 7d` (qualidade, FC média, sestas) |
| Recuperação | `suuntool wellness recovery`, `wellness sleepstages` |
| Diagnóstico | `suuntool doctor` |

## Plano técnico

1. **Teste de ligação**: login com a conta suunto.com (sem dados ainda, conta
   criada) → `suuntool doctor` + enumerar o que devolve `wellness activity` /
   `sleep` para o relógio em causa.
2. **`backend/scripts/suunto_sync.py`**:
   - Invoca o `suuntool` (subprocess), parse NDJSON/JSON
   - Incremental: só dados com data > último registo `source='suunto'` no Supabase
   - Upsert idempotente em `garmin_activities`/`garmin_daily` com `source='suunto'`
   - Mapear tipos Suunto (RUNNING, TRAIL_RUNNING, GYM…) → tipos existentes
     (running, trail_running, strength_training, …)
   - Backoff em rate-limit (reutilizar padrão `_retry` do `garmin_snapshot.py`)
3. **Automação**: LaunchAgent macOS de manhã → `suunto_sync.py` → log em
   `backend/logs/` + notificação em falha.

## Regras

- Nunca escrever em linhas `source='garmin'` após o congelamento (07/10/2026).
- Datas Suunto < 07/10/2026 não são esperadas; se aparecerem, investigar antes
  de importar.
- `suuntool` é não-oficial (pode violar os ToS do Suunto; uso pessoal e por
  conta e risco — o mesmo espírito do garminconnect).

## Alternativas (referência)

- `suunto-mcp` (googlarz/suuntool-adjacente, Node) — MCP server para AI agents
- `suunto-api-wrapper` (Marius-Ar, TypeScript) — cliente tipado do mesmo backend
- `open-wearables` (the-momentum) — plataforma self-hosted multi-wearable (overkill)
