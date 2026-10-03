-- Fase 3: coluna source nas tabelas Garmin (histórico congelado 'garmin';
-- dados novos entram com 'suunto') + índices.
alter table public.garmin_activities
  add column if not exists source text not null default 'garmin';
alter table public.garmin_daily
  add column if not exists source text not null default 'garmin';

create index if not exists garmin_activities_source_start_idx
  on public.garmin_activities (source, start desc);
create index if not exists garmin_daily_source_date_idx
  on public.garmin_daily (source, date desc);
