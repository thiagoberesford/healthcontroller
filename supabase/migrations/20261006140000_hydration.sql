-- Hidratação diária (registo manual na Visão geral; meta 3L).
create table if not exists public.hydration (
  date date primary key,
  ml int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.hydration enable row level security;

-- app de utilizador único: leitura + escrita para authenticated
drop policy if exists "rw hydration" on public.hydration;
create policy "rw hydration" on public.hydration
  as permissive for all to authenticated
  using (true) with check (true);
