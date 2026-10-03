-- Nutrição: base de alimentos portugueses (openfoodfacts + genéricos).
create table if not exists public.foods (
  id text primary key,
  name text not null,
  brand text not null default '',
  category text not null default '',
  kcal real not null,
  protein real not null default 0,
  carbs real not null default 0,
  fat real not null default 0,
  portion real not null default 100,
  source text not null default 'openfoodfacts'
);

create index if not exists foods_name_idx on public.foods (name);
create index if not exists foods_brand_idx on public.foods (brand);

alter table public.foods enable row level security;

-- leitura para o app (authenticated); escrita só via DB (scripts)
drop policy if exists "read foods" on public.foods;
create policy "read foods" on public.foods
  for select to authenticated using (true);
