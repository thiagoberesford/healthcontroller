# Garmin — integração

## Via biblilioteca `garminconnect` (já no backend)

```bash
cp backend/.env.example backend/.env   # preencher GARMIN_EMAIL / GARMIN_PASSWORD
```

Login único (salva token em `~/.garminconnect`, depois não pede mais senha):

```python
from app.services import garmin_service
garmin_service.login_and_sync(days=7)   # sincroniza e grava cache
```

Depois, `GET /api/garmin` devolve os dados em cache.

## Snapshot completo (backup antes de trocar de ecossistema)

`backend/scripts/garmin_snapshot.py` exporta tudo para `backend/data/garmin_export/`:

- `profile.json` — perfil, dispositivos, gear
- `activities.json` — metadados de todas as atividades
- `activity_files/<id>.zip` — ficheiro original (FIT) de cada atividade
- `body_composition_<ano>.json`, `weigh_ins_<ano>.json` — peso/composição
- `sleep/<dia>.json`, `daily/<dia>.json` (stats + HRV) — por dia

```bash
cd backend
.venv/bin/python -u scripts/garmin_snapshot.py --start 2019-06-26 [--max-seconds 240]
```

Resumível (rerun continua de onde parou; exit 2 = pausado). 4 workers no fetch diário,
backoff automático em 429.

## Via MCP (alternativa, sem código)

Servidores MCP úteis para consultar/ingestar dados Garmin no Claude/VSCode:

| Server | Repo | Notas |
|---|---|---|
| garmin_mcp | Taxuspt/garmin_mcp | Leitura de atividades, sono, passos |
| garmin-connect-mcp | eddmann/garmin-connect-mcp | Leitura + escrita (upload de treinos) |

Exemplo de uso: registar o server no cliente MCP com as credenciais por env, e pedir "últimos 7 dias de atividades" — os dados podem ser copiados para `backend/data/garmin_cache.json` no mesmo formato do cache.

## Suunto (Fase 3)

Preferência do utilizador por marcas europeias (Suunto, Finlândia). Sem API pública oficial
para consumidores: o caminho prático é exportar ficheiros do Suunto app (ZIP com .gpx/.fit)
e ingerir via `suunto_service.write_cache()`, ou a ferramenta `suuntool`.
