-- Alimentos personalizados: authenticated pode inserir/atualizar os seus
-- (a app é de utilizador único; leitura continua como já estava).
drop policy if exists "insert foods" on public.foods;
create policy "insert foods" on public.foods
  for insert to authenticated with check (true);

drop policy if exists "update foods" on public.foods;
create policy "update foods" on public.foods
  for update to authenticated using (true) with check (true);
