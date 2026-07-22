-- CRUD de productores y entidades desde el panel.
--
-- El frontend usa la publishable key -> rol `authenticated`, que hasta ahora solo
-- tenía SELECT sobre estas tablas (20260721160000_auth_authenticated.sql). Para
-- editar, crear y borrar fichas desde el panel necesita también INSERT/UPDATE/DELETE.
--
-- Coherente con el modelo actual SIN roles: cualquier usuario autenticado ya podía
-- leerlo todo; ahora también puede escribirlo. Cuando se introduzcan roles habrá
-- que restringir estas políticas (deuda técnica §12).

-- GRANTs (capa Postgres). Las de SELECT ya estaban.
grant insert, update, delete on productores to authenticated;
grant insert, update, delete on entidades to authenticated;

-- Políticas RLS de escritura (la de SELECT "authenticated puede leer" ya existe).
create policy "authenticated crea productores"
  on productores for insert to authenticated with check (true);
create policy "authenticated edita productores"
  on productores for update to authenticated using (true) with check (true);
create policy "authenticated borra productores"
  on productores for delete to authenticated using (true);

create policy "authenticated crea entidades"
  on entidades for insert to authenticated with check (true);
create policy "authenticated edita entidades"
  on entidades for update to authenticated using (true) with check (true);
create policy "authenticated borra entidades"
  on entidades for delete to authenticated using (true);
