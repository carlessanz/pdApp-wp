-- Limpieza de datos de prueba: vaciar mensajes y quitar el contacto ficticio
-- que creó el botón "Test" del panel de webhooks de Meta.
truncate table wa_messages;
delete from wa_contacts where phone = '16315551181';

-- Tabla de productores (teléfonos en E.164 sin +)
create table productores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  phone text unique not null,
  created_at timestamptz not null default now()
);

alter table productores enable row level security;

-- service_role: acceso total (Edge Functions / backoffice)
create policy "service_role acceso total"
  on productores for all to service_role
  using (true) with check (true);

-- Herramienta de pruebas interna sin login todavía: solo lectura para anon.
-- Los productores se gestionan por migración, no desde la interfaz.
-- TODO: restringir con auth antes de producción.
create policy "anon puede leer productores"
  on productores for select to anon
  using (true);

insert into productores (name, email, phone) values
  ('Carles Sanz', 'hola@carlessanz.com', '34676452492'),
  ('Sebas Sale', 'sebastian@espigoladors.com', '34644880747')
on conflict do nothing;
