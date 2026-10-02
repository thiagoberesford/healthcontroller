-- Health Controller: tabelas Garmin (histórico) — leitura pública via anon + RLS,
-- escrita apenas com service_role / DB direto (scripts de import).
create table if not exists public.garmin_activities (
  id bigint primary key,
  name text,
  type text not null,
  start timestamp not null,
  distance_km real not null default 0,
  duration_s real,
  kcal int,
  avg_hr int
);

create index if not exists garmin_activities_start_idx on public.garmin_activities (start desc);

create table if not exists public.garmin_daily (
  date date primary key,
  steps int,
  active_kcal int,
  total_kcal int,
  resting_hr int,
  hrv int,
  sleep_hours real,
  stress_avg int,
  floors int,
  intense_min int
);

alter table public.garmin_activities enable row level security;
alter table public.garmin_daily enable row level security;

drop policy if exists "read garmin_activities" on public.garmin_activities;
create policy "read garmin_activities" on public.garmin_activities
  for select to anon, authenticated using (true);

drop policy if exists "read garmin_daily" on public.garmin_daily;
create policy "read garmin_daily" on public.garmin_daily
  for select to anon, authenticated using (true);
