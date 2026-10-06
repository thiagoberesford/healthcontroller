-- Push de guias para o relógio: fila + estado por treino planeado.
-- Fluxo: site aprova -> guide_push_queue (pending) -> worker no Mac
-- (suuntool) -> guia na conta Suunto -> planned_workouts.push_status='watch'.

alter table public.planned_workouts add column if not exists push_status text;
alter table public.planned_workouts add column if not exists pushed_at timestamptz;

create table if not exists public.guide_push_queue (
  id bigint generated always as identity primary key,
  date date not null,
  payload jsonb,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists guide_push_queue_status_idx on public.guide_push_queue (status);

alter table public.guide_push_queue enable row level security;

-- o app cria pedidos e consulta o estado; só o worker (DB) atualiza
drop policy if exists "insert guide_push_queue" on public.guide_push_queue;
create policy "insert guide_push_queue" on public.guide_push_queue
  for insert to authenticated with check (true);

drop policy if exists "read guide_push_queue" on public.guide_push_queue;
create policy "read guide_push_queue" on public.guide_push_queue
  for select to authenticated using (true);
