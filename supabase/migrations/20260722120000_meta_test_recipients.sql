-- Lista de números de prueba de Meta (whitelist de destinatarios).
--
-- El entorno de test de la WhatsApp Cloud API solo entrega a un máximo de 5
-- números, dados de alta a mano en el panel de Meta (el destinatario confirma un
-- código). Meta NO expone ninguna API para listar ni añadir esos números, así que
-- la app no puede detectarlos ni gestionarlos automáticamente: mantiene aquí su
-- propia copia de los que tú has registrado en Meta y la usa como fuente de verdad
-- para separar productores y permitir/bloquear envíos.
--
-- Semántica del gate (whatsapp-send): si esta tabla tiene al menos una fila, solo
-- se envía a los números que estén en ella; si está VACÍA, no restringe nada (así,
-- al pasar a un número de producción sin límite de 5, se vacía la lista y el gate
-- desaparece solo).

create table if not exists meta_test_recipients (
  phone text primary key,           -- E.164 sin '+', como el resto del proyecto
  etiqueta text,                    -- nombre/nota para reconocerlo en el gestor
  created_at timestamptz not null default now()
);

alter table meta_test_recipients enable row level security;

-- Cualquier persona autenticada del equipo la gestiona (leer, añadir, borrar).
-- anon no tiene ningún privilegio (coherente con 20260721160000_auth_authenticated).
grant select, insert, delete on meta_test_recipients to authenticated;

create policy "authenticated gestiona meta_test_recipients"
  on meta_test_recipients for all to authenticated
  using (true) with check (true);
