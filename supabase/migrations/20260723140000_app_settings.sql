-- Configuración global de la app (no secretos), gestionada por el equipo desde el
-- apartado "Configuración". A diferencia de `app_config` (solo service_role, para
-- secretos de jobs), esta la leen y escriben el panel (authenticated) y las Edge
-- Functions (service_role).

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

grant select, insert, update on app_settings to authenticated;
grant select, insert, update on app_settings to service_role;

create policy "authenticated gestiona app_settings"
  on app_settings for all to authenticated
  using (true) with check (true);

-- Modo test: si 'true' (por defecto), la app SOLO envía WhatsApp/email a los usuarios
-- marcados `es_test`. **Fail-safe**: si la fila falta o no se puede leer, las Edge
-- Functions lo tratan como ACTIVO (no envían a no-test). Se apaga a mano desde
-- Configuración cuando se pase a producción real. Gobierna whatsapp-send,
-- enviar-email, whatsapp-webhook e intake-recordatorios (gate `es_test`, §8).
insert into app_settings (key, value) values ('test_mode', 'true')
  on conflict (key) do nothing;
