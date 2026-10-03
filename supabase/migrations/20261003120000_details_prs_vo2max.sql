-- Fase 3: detalhes por-atividade, PRs e VO2max.
alter table public.daily add column if not exists vo2max int;

create table if not exists public.activity_details (
  source text not null,
  source_key text not null,
  data jsonb not null,
  primary key (source, source_key)
);

create table if not exists public.personal_records (
  source text not null,
  label text not null,
  value_s real not null,
  activity_key text,
  date date,
  primary key (source, label)
);

alter table public.activity_details enable row level security;
alter table public.personal_records enable row level security;

drop policy if exists "read activity_details" on public.activity_details;
create policy "read activity_details" on public.activity_details
  for select to authenticated using (true);

drop policy if exists "read personal_records" on public.personal_records;
create policy "read personal_records" on public.personal_records
  for select to authenticated using (true);
