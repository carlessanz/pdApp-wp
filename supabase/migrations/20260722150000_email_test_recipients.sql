-- Lista de correos de prueba para el canal de email (Resend).
--
-- Análoga a meta_test_recipients pero para email: mientras se está en pruebas,
-- las ofertas por email solo se mandan a los correos de esta whitelist. Además,
-- Resend sin dominio verificado solo entrega al correo propietario de la cuenta,
-- así que esta lista es la segunda barrera (la del panel).
--
-- Semántica del gate (enviar-email): si la tabla tiene alguna fila, solo se envía
-- a los correos que estén en ella; si está VACÍA, no restringe (paso a producción).

create table if not exists email_test_recipients (
  email text primary key,
  etiqueta text,
  created_at timestamptz not null default now()
);

alter table email_test_recipients enable row level security;

grant select, insert, delete on email_test_recipients to authenticated;

create policy "authenticated gestiona email_test_recipients"
  on email_test_recipients for all to authenticated
  using (true) with check (true);
