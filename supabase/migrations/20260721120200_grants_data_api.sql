-- GRANTs de la Data API.
--
-- Supabase ya NO expone automáticamente las tablas del esquema public a los roles
-- de la API: `auto_expose_new_tables` viene desactivado en los proyectos nuevos y
-- el ajuste desaparece el 2026-10-30. Sin estos GRANT, PostgREST responde
-- "permission denied for table X" antes siquiera de evaluar las políticas RLS,
-- y tanto el frontend como las Edge Functions fallan contra cualquier tabla.
--
-- Los GRANT solo abren la puerta a nivel de Postgres; quien decide qué filas se
-- ven sigue siendo RLS. Ambas capas son necesarias.

grant usage on schema public to anon, authenticated, service_role;

-- service_role: lo usan las Edge Functions, que necesitan acceso total.
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- anon: la consola lee con la publishable key. Solo lectura...
grant select on all tables in schema public to anon;
-- ...salvo wa_contacts, donde la consola da de alta contactos y sincroniza nombres.
grant insert, update on wa_contacts to anon;

-- Que las tablas que se creen a partir de ahora hereden lo mismo, para no repetir
-- este problema en cada migración nueva.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant select on tables to anon;
