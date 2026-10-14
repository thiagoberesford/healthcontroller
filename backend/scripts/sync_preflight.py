"""Preflight do sync: deteta e corrige erros antes de cada execução.

Corre no início de suunto_sync (LaunchAgent a cada 30 min) e:

  1. re-fila pedidos guide_push_queue com status='error' (limite de
     tentativas; o worker incrementa `attempts` a cada falha)
  2. deteta dias recentes sem linha em daily (gaps de sync falhado)
     e devolve um `since` alargado para os re-buscar
  3. deteta atividades suunto sem detalhe (activity_details) e devolve
     as chaves para re-ingestão

Tudo é idempotente: correr de novo não duplica nada.
"""
from __future__ import annotations

from datetime import date, timedelta


MAX_ATTEMPTS = 3
GAP_WINDOW_DAYS = 7      # dias recentes a verificar em daily
DETAIL_WINDOW_DAYS = 30  # janela para detalhes em falta
REQUEUE_COOLDOWN_MIN = 10  # não re-filar erro fresco (evita martelada)


def preflight(conn) -> dict:
    """Devolve {'since_override': iso|None, 'detail_keys': [...], 'log': [...]}"""
    log: list[str] = []
    today = date.today()

    # 1. re-fila erros da guide_push_queue (com limite de tentativas)
    with conn.cursor() as cur:
        cur.execute(
            """
            update public.guide_push_queue
            set status = 'pending', processed_at = null
            where status = 'error'
              and attempts < %s
              and processed_at < now() - interval '%s minutes'
            returning id, source, date, payload
            """,
            (MAX_ATTEMPTS, REQUEUE_COOLDOWN_MIN),
        )
        requeued = cur.fetchall()
    if requeued:
        conn.commit()
        for rid, src, d, payload in requeued:
            what = (payload or {}).get("workout") or (payload or {}).get("schedule") or d
            log.append(f"re-filado #{rid} ({src} {what}) para nova tentativa")

    # 2. gaps em daily: dias recentes sem linha — alargar o since
    since_override = None
    with conn.cursor() as cur:
        cur.execute(
            """
            select (current_date - g)::date
            from generate_series(0, %s::int) as g
            where not exists (
                select 1 from public.daily
                where date = (current_date - g)::date and source = 'suunto'
                  and (steps is not null or active_kcal is not null)
            )
            order by 1
            """,
            (GAP_WINDOW_DAYS,),
        )
        gaps = [r[0] for r in cur.fetchall()]
    if gaps:
        earliest = gaps[0]
        # 2 dias extra: janela de wellness é incremental e o sono aponta
        # para a noite anterior (bedtimeEnd)
        since_override = (earliest - timedelta(days=2)).isoformat()
        log.append(
            f"{len(gaps)} dia(s) sem dados ({earliest}..{gaps[-1]}) — "
            f"sync alargado desde {since_override}"
        )

    # 3. atividades suunto sem detalhe (janela recente)
    detail_keys: list[str] = []
    with conn.cursor() as cur:
        cur.execute(
            """
            select a.source_key
            from public.activities a
            left join public.activity_details d
              on d.source = a.source and d.source_key = a.source_key
            where a.source = 'suunto' and d.source_key is null
              and a.start >= current_date - %s::int
            order by a.start
            """,
            (DETAIL_WINDOW_DAYS,),
        )
        detail_keys = [r[0] for r in cur.fetchall()]
    if detail_keys:
        log.append(f"{len(detail_keys)} atividade(s) sem detalhe — re-ingestão")

    return {"since_override": since_override, "detail_keys": detail_keys, "log": log}
