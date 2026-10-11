-- Ténis: registo e desgaste por par.
-- (A contagem de km por ténis será decidida em separado: atribuição
-- por "ténis atual" e/ou confirmação por treino.)
create table if not exists public.shoes (
  id text primary key,
  name text not null,
  target_km int not null default 700,     -- vida útil de referência
  start_km real not null default 0,       -- km iniciais (desgaste prévio)
  is_current boolean not null default false, -- par em uso
  retired boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.shoes enable row level security;

drop policy if exists "rw shoes" on public.shoes;
create policy "rw shoes" on public.shoes
  as permissive for all to authenticated
  using (true) with check (true);
