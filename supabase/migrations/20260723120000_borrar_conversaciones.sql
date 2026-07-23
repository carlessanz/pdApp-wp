-- Permite al equipo (authenticated) borrar hilos de conversación desde el panel:
-- eliminar todos los `wa_messages` de un contacto y el propio `wa_contact`.
--
-- Hasta ahora `wa_messages` era solo-lectura para authenticated (los mensajes los
-- escribe el servidor por las Edge Functions) y `wa_contacts` admitía insert/update
-- pero no delete. Aquí se añade DELETE para poder limpiar hilos a mano desde la
-- consola. Si el contacto vuelve a escribir, el webhook lo recrea.
--
-- Las dos capas, como siempre (§4): GRANT (permiso de Postgres) + POLICY (RLS).

grant delete on wa_messages to authenticated;
grant delete on wa_contacts to authenticated;

create policy "authenticated puede borrar mensajes"
  on wa_messages for delete to authenticated using (true);
create policy "authenticated puede borrar contactos"
  on wa_contacts for delete to authenticated using (true);
