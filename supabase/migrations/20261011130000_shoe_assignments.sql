-- Ténis: atribuição de ténis por treino (popup de confirmação por corrida).
create table if not exists public.shoe_assignments (
  source text not null,
  source_key text not null,
  shoe_id text not null references public.shoes(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (source, source_key)
);

create index if not exists shoe_assignments_shoe_idx on public.shoe_assignments (shoe_id);

alter table public.shoe_assignments enable row level security;

drop policy if exists "rw shoe_assignments" on public.shoe_assignments;
create policy "rw shoe_assignments" on public.shoe_assignments
  as permissive for all to authenticated
  using (true) with check (true);
