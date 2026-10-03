-- Fase 3: tabelas unificadas activities/daily (multi-fonte: garmin, suunto).
-- As garmin_* ficam como arquivo (freeze 07/10/2026; nenhuma escrita depois).
create table if not exists public.activities (
  source text not null,
  source_key text not null,
  name text,
  type text not null,
  start timestamp not null,
  distance_km real not null default 0,
  duration_s real,
  kcal int,
  avg_hr int,
  primary key (source, source_key)
);

create index if not exists activities_start_idx on public.activities (start desc);
create index if not exists activities_source_start_idx on public.activities (source, start desc);

create table if not exists public.daily (
  date date not null,
  source text not null,
  steps int,
  active_kcal int,
  total_kcal int,
  resting_hr int,
  hrv int,
  sleep_hours real,
  stress_avg int,
  floors real,
  intense_min int,
  primary key (date, source)
);

create index if not exists daily_date_idx on public.daily (date desc);

alter table public.activities enable row level security;
alter table public.daily enable row level security;

drop policy if exists "read activities" on public.activities;
create policy "read activities" on public.activities
  for select to authenticated using (true);

drop policy if exists "read daily" on public.daily;
create policy "read daily" on public.daily
  for select to authenticated using (true);

-- Espelho do arquivo Garmin (idempotente; atualiza enquanto não congela)
insert into public.activities
  (source, source_key, name, type, start, distance_km, duration_s, kcal, avg_hr)
select 'garmin', id::text, name, type, start, distance_km, duration_s, kcal, avg_hr
from public.garmin_activities
on conflict (source, source_key) do update set
  name = excluded.name, type = excluded.type, start = excluded.start,
  distance_km = excluded.distance_km, duration_s = excluded.duration_s,
  kcal = excluded.kcal, avg_hr = excluded.avg_hr;

insert into public.daily
  (date, source, steps, active_kcal, total_kcal, resting_hr, hrv,
   sleep_hours, stress_avg, floors, intense_min)
select date, source, steps, active_kcal, total_kcal, resting_hr, hrv,
       sleep_hours, stress_avg, floors, intense_min
from public.garmin_daily
on conflict (date, source) do update set
  steps = excluded.steps, active_kcal = excluded.active_kcal,
  total_kcal = excluded.total_kcal, resting_hr = excluded.resting_hr,
  hrv = excluded.hrv, sleep_hours = excluded.sleep_hours,
  stress_avg = excluded.stress_avg, floors = excluded.floors,
  intense_min = excluded.intense_min;
