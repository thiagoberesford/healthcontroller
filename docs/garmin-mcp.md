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
