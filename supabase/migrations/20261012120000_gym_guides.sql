-- Guias de ginásio ABC: a fila passa a distinguir a origem do pedido.
-- source='treinus' (default, comportamento existente) | source='gym'
-- Para gym, payload = {"workout":"A"|"B"|"C", "date"?: "YYYY-MM-DD"}.

alter table public.guide_push_queue
  add column if not exists source text not null default 'treinus';

create index if not exists guide_push_queue_source_idx
  on public.guide_push_queue (source, status);
