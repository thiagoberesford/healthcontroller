-- Preflight auto-curativo: contar tentativas de push para requeue limitado.
alter table public.guide_push_queue
  add column if not exists attempts int not null default 0;
