# Suunto — integração (Fase 3)

Decisão: dados novos a partir de 07/10/2026 vêm do Suunto, sincronizados para o
Supabase com `source='suunto'` (histórico Garmin é imutável).

## Vias de ingestão (pesquisa 2026-10-03)

| Via | O que é | Adequação |
|---|---|---|
| **API oficial Suunto** (apizone.suunto.com) | OAuth2, devolve **ficheiros FIT** das atividades; recentemente expandida com **sono, HRV e FC repouso dinâmica** (relógios modernos, ex. Suunto Race — confirmado pela integração da Tredict, que importa 2 anos de HRV/sono) | Preferível para o sync diário; exige registo de app OAuth no apizone |
| **suuntool** (tajchert/suuntool, Go) | CLI + MCP não-oficial para a cloud API do Suunto app (backend Sports-Tracker) — o caminho "garminconnect-style" | Fallback se o OAuth oficial demorar; leitura/escrita dos próprios dados |
| **suunto-mcp** (googlarz/suunto-mcp, Node) | MCP server para assistentes AI; tokens locais em `~/.suunto-mcp/tokens.json`; login via apizone; funciona com qualquer relógio que sincronize com o Suunto app | Útil para explorar dados interativamente antes de escrever o sync |
| **open-wearables** (the-momentum, ~2.6k stars) | Plataforma self-hosted (Python/FastAPI) que unifica Garmin/Suunto/Apple Health com API própria | Overkill para este projeto; referência de mapeamento de campos |

Fontes: blog.tredict.com (expansão da API: sono/HRV/RHR), apizone.suunto.com
(documentação da API oficial), repositórios acima.

## Plano técnico

1. **Teste de ligação** (conta já existe): instalar `suuntool` ou `suunto-mcp`,
   autenticar com a conta suunto.com e enumerar endpoints disponíveis
   (atividades, diário, sono/HRV se o relógio suportar).
2. **`backend/scripts/suunto_sync.py`**:
   - Incremental: só dados com data > último registo `source='suunto'` no Supabase
   - Upsert idempotente em `garmin_activities`/`garmin_daily` com `source='suunto'`
   - Mapear tipos Suunto → tipos existentes (running, strength_training, ...)
   - Backoff em rate-limit (reutilizar `_retry` do `garmin_snapshot.py`)
3. **Automação**: LaunchAgent macOS de manhã → `suunto_sync.py` → log em
   `backend/logs/` + notificação em falha.

## Regras

- Nunca escrever em linhas `source='garmin'` após o congelamento (07/10/2026).
- Datas Suunto < 07/10/2026 não são esperadas; se aparecerem, investigar antes
  de importar.
