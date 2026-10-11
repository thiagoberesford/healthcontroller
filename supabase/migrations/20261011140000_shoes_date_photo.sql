-- Ténis: data de início de uso + foto do par (fotos do próprio utilizador,
-- guardadas no bucket 'shoes' do Supabase Storage).
alter table public.shoes add column if not exists start_date date;
alter table public.shoes add column if not exists photo_url text;

-- bucket para as fotos (público de leitura; nomes de ficheiro aleatórios)
insert into storage.buckets (id, name, public)
values ('shoes', 'shoes', true)
on conflict (id) do nothing;

-- upload/remoção apenas para utilizadores autenticados
drop policy if exists "shoes upload" on storage.objects;
create policy "shoes upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shoes');

drop policy if exists "shoes delete" on storage.objects;
create policy "shoes delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shoes');
