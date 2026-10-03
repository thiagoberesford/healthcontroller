-- Balança Xiaomi (Mi Body Composition Scale 2) via SmartScaleConnect:
-- expandir body_metrics com as métricas de composição que o export traz.
-- Tabela existente (pesagens Garmin + manuais): expandir, não recriar.

alter table public.body_metrics add column if not exists bone_mass real;
alter table public.body_metrics add column if not exists protein real;
alter table public.body_metrics add column if not exists bmi real;

-- alinhar nome/tipo com o spec (visceral int -> visceral_fat real)
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'body_metrics' and column_name = 'visceral'
  ) then
    alter table public.body_metrics rename column visceral to visceral_fat;
  end if;
end $$;

alter table public.body_metrics alter column visceral_fat type real;

-- export da balança é a fonte por omissão; NOT NULL em date (PK) e weight
alter table public.body_metrics alter column source set default 'xiaomi';
alter table public.body_metrics alter column weight set not null;

-- RLS: já ativa com policy "body_metrics all" (to authenticated) desde
-- 20261002231000 — leitura/escrita apenas para utilizadores autenticados,
-- zero acesso anon. Inalterado para manter as pesagens manuais do app.
