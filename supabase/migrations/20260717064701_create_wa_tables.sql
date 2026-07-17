-- Tablas para la consola de mensajería WhatsApp (PDApp)

-- Contactos: teléfonos en E.164 sin el símbolo +
create table wa_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  opt_in boolean not null default false,
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  created_at timestamptz not null default now()
);

create table wa_messages (
  id uuid primary key default gen_random_uuid(),
  wa_message_id text,
  contact_phone text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  type text,
  body text,
  status text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index wa_messages_contact_phone_created_at_idx
  on wa_messages (contact_phone, created_at);

-- RLS
alter table wa_contacts enable row level security;
alter table wa_messages enable row level security;

-- service_role: acceso total (lo usan las Edge Functions)
create policy "service_role acceso total"
  on wa_contacts for all to service_role
  using (true) with check (true);

create policy "service_role acceso total"
  on wa_messages for all to service_role
  using (true) with check (true);

-- Herramienta de pruebas interna sin login todavía.
-- TODO: restringir con auth antes de producción.
create policy "anon puede leer contactos"
  on wa_contacts for select to anon
  using (true);

create policy "anon puede crear contactos"
  on wa_contacts for insert to anon
  with check (true);

create policy "anon puede actualizar contactos"
  on wa_contacts for update to anon
  using (true) with check (true);

create policy "anon puede leer mensajes"
  on wa_messages for select to anon
  using (true);

-- Nota: sin política de INSERT de anon en wa_messages a propósito:
-- el envío de mensajes se hace vía Edge Function (service_role), no por inserción directa.

-- Realtime
alter publication supabase_realtime add table wa_contacts, wa_messages;
