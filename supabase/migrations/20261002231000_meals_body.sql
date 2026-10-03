-- Fase 3: refeições e medidas corporais no Supabase (RLS authenticated,
-- app de utilizador único). Totais/macros em jsonb para manter o formato
-- atual do frontend.
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  date date not null,
  time text,
  text text not null,
  items jsonb not null default '[]'::jsonb,
  totals jsonb
);

create index if not exists meals_date_idx on public.meals (date desc);

create table if not exists public.body_metrics (
  date date primary key,
  weight real,
  muscle real,
  body_fat real,
  water real,
  visceral int,
  source text not null default 'manual'
);

alter table public.meals enable row level security;
alter table public.body_metrics enable row level security;

drop policy if exists "meals all" on public.meals;
create policy "meals all" on public.meals
  for all to authenticated using (true) with check (true);

drop policy if exists "body_metrics all" on public.body_metrics;
create policy "body_metrics all" on public.body_metrics
  for all to authenticated using (true) with check (true);
