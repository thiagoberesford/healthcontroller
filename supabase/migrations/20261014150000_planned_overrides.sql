-- Remarcação manual de treinos planeados (Treinus é autoritativo e
-- sobrescreve planned_workouts a cada 30 min; o override vive à parte).
-- O app escreve aqui (RLS authenticated); o sync do Treinus não toca.
create table if not exists public.planned_overrides (
  id text primary key,           -- = planned_workouts.id (treinus_<IdExercise>)
  new_date date not null,
  updated_at timestamptz not null default now()
);

alter table public.planned_overrides enable row level security;

drop policy if exists "read planned_overrides" on public.planned_overrides;
create policy "read planned_overrides" on public.planned_overrides
  for select to authenticated using (true);

drop policy if exists "insert planned_overrides" on public.planned_overrides;
create policy "insert planned_overrides" on public.planned_overrides
  for insert to authenticated with check (true);

drop policy if exists "update planned_overrides" on public.planned_overrides;
create policy "update planned_overrides" on public.planned_overrides
  for update to authenticated using (true) with check (true);

drop policy if exists "delete planned_overrides" on public.planned_overrides;
create policy "delete planned_overrides" on public.planned_overrides
  for delete to authenticated using (true);
