-- Treinos planeados: Treinus -> SuuntoPlus Guides (via suuntool) -> Supabase.
-- O Treinus empurra o plano para a conta Suunto como guides; este script lê-os.
create table if not exists public.planned_workouts (
  id text primary key,
  date date not null,
  name text not null,
  source text not null default 'treinus',
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists planned_workouts_date_idx on public.planned_workouts (date);

alter table public.planned_workouts enable row level security;

-- leitura para o app (authenticated); escrita só via DB (scripts)
drop policy if exists "read planned_workouts" on public.planned_workouts;
create policy "read planned_workouts" on public.planned_workouts
  for select to authenticated using (true);
