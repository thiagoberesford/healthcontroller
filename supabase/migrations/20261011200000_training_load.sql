-- Fase A: camada analítica de treino.
-- activities.tss: TSS oficial do Suunto (só escrito em linhas suunto; garmin imutável)
alter table public.activities add column if not exists tss real;

-- carga diária calculada pelo script sync (nunca pelo frontend)
create table if not exists public.training_load (
  date date primary key,
  tss int not null default 0,        -- TSS oficial (suunto) ou TRIMP (arquivo garmin)
  ctl real,                           -- média móvel exponencial 42d
  atl real,                           -- 7d
  tsb real,                           -- ctl - atl
  acr real,                           -- rácio agudo:crónico (7d/28d)
  readiness int,                      -- 0-100
  hrv_base_min real, hrv_base_avg real, hrv_base_max real,  -- banda pessoal 60d
  pred_5k real, pred_10k real, pred_half real, pred_mara real, -- Riegel + VO2 (segundos)
  source text not null default 'calc',
  updated_at timestamptz not null default now()
);

create index if not exists training_load_date_idx on public.training_load (date);

alter table public.training_load enable row level security;
drop policy if exists "read training_load" on public.training_load;
create policy "read training_load" on public.training_load
  for select to authenticated using (true);

-- RPE/feeling pós-treino: tabela separada para nunca escrever no arquivo garmin
create table if not exists public.activity_notes (
  source text not null,
  source_key text not null,
  rpe int check (rpe between 1 and 10),
  feeling text,
  updated_at timestamptz not null default now(),
  primary key (source, source_key)
);

alter table public.activity_notes enable row level security;
drop policy if exists "rw activity_notes" on public.activity_notes;
create policy "rw activity_notes" on public.activity_notes
  as permissive for all to authenticated
  using (true) with check (true);
