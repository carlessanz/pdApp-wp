-- Autenticación real: el acceso pasa de `anon` a `authenticated`.
--
-- Hasta ahora cualquiera con la publishable key (que es pública por diseño, va
-- en el bundle) podía leer la base entera. Con los datos maestros importados eso
-- son 452 fichas con nombre, NIF, teléfono, email y dirección, así que deja de
-- ser aceptable.
--
-- A partir de aquí hace falta una sesión de Supabase Auth. Las cuentas se crean
-- solo con la Admin API (no hay registro público, ver config.toml), y el
-- `PasswordGate` cosmético del frontend queda sustituido por un login de verdad.
--
-- Las dos capas se mueven a la vez, porque ambas hacen falta:
--   · GRANT  -> permiso de Postgres; sin él PostgREST responde permission denied.
--   · POLICY -> RLS; decide qué filas ve cada rol.

-- ---------------------------------------------------------------------------
-- 1. Políticas: sustituir las de anon por otras equivalentes para authenticated
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tablas text[] := array[
    'wa_contacts', 'wa_messages', 'productores', 'productor_ubicaciones',
    'entidades', 'excedentes', 'canalizaciones', 'intake_sessions',
    'productos', 'causas', 'factores_conversion'
  ];
begin
  foreach t in array tablas loop
    -- Fuera las políticas de anon (los nombres varían entre migraciones).
    execute format('drop policy if exists "anon puede leer" on %I', t);
    execute format('drop policy if exists "anon puede leer contactos" on %I', t);
    execute format('drop policy if exists "anon puede crear contactos" on %I', t);
    execute format('drop policy if exists "anon puede actualizar contactos" on %I', t);
    execute format('drop policy if exists "anon puede leer mensajes" on %I', t);
    execute format('drop policy if exists "anon puede leer productores" on %I', t);

    -- Cualquier persona autenticada del equipo puede leer.
    execute format(
      'create policy "authenticated puede leer" on %I for select to authenticated
         using (true)', t);
  end loop;

  -- La consola da de alta contactos y sincroniza sus nombres.
  create policy "authenticated puede crear contactos"
    on wa_contacts for insert to authenticated with check (true);
  create policy "authenticated puede actualizar contactos"
    on wa_contacts for update to authenticated using (true) with check (true);
end $$;

-- Sin política de INSERT en wa_messages a propósito: los mensajes solo los
-- escribe el servidor (service_role) a través de las Edge Functions.

-- ---------------------------------------------------------------------------
-- 2. GRANTs: quitar a anon, dar a authenticated
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on wa_contacts to authenticated;

-- Y que las tablas futuras hereden lo mismo.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select on tables to authenticated;
