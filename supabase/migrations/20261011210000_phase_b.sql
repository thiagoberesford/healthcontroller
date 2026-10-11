-- Fase B: organização.
-- B2: rotinas de força (séries por treino)
create table if not exists public.strength_sets (
  id bigint generated always as identity primary key,
  source text not null,
  source_key text not null,
  exercise text not null,
  sets int not null default 1,
  reps int not null default 10,
  weight_kg real,
  updated_at timestamptz not null default now()
);
create index if not exists strength_sets_act_idx on public.strength_sets (source, source_key);
alter table public.strength_sets enable row level security;
drop policy if exists "rw strength_sets" on public.strength_sets;
create policy "rw strength_sets" on public.strength_sets
  as permissive for all to authenticated using (true) with check (true);

-- B3: streak de dias ativos e km acumulado do mês (calculados no sync)
alter table public.training_load add column if not exists streak int;
alter table public.training_load add column if not exists month_km real;

-- B3: meta mensal de km (editável pelo utilizador)
create table if not exists public.monthly_goal (
  id text primary key default 'goal',
  km real not null,
  updated_at timestamptz not null default now()
);
alter table public.monthly_goal enable row level security;
drop policy if exists "rw monthly_goal" on public.monthly_goal;
create policy "rw monthly_goal" on public.monthly_goal
  as permissive for all to authenticated using (true) with check (true);
