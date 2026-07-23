-- Marca de "usuario de prueba" en las fichas, INDEPENDIENTE de la fase de Meta.
--
-- Hasta ahora "quién puede recibir" se decidía por las whitelists de teléfono/email
-- de Meta (meta_test_recipients / email_test_recipients), atadas al entorno de test
-- de Meta. `es_test` lo lleva a la ficha del productor/entidad: es la **fuente de
-- verdad de la app** para permitir el envío (WhatsApp y correo), tanto en test como
-- en producción de Meta. Solo se envía a quien tenga es_test = true; el gate vive en
-- whatsapp-webhook (respuestas + intake), whatsapp-send (ofertas) y enviar-email (§8).
-- Las whitelists de Meta quedan por debajo como requisito técnico del entorno de test.

alter table productores add column if not exists es_test boolean not null default false;
alter table entidades   add column if not exists es_test boolean not null default false;

-- Arranque: hereda el estado actual. Son de prueba los que ya estaban en las whitelists.
update productores set es_test = true
 where phone in (select phone from meta_test_recipients);

update entidades set es_test = true
 where telefono in (select phone from meta_test_recipients)
    or (email is not null and lower(email) in (select lower(email) from email_test_recipients));

-- `authenticated` ya tiene UPDATE en productores/entidades (CRUD del panel) y las
-- columnas nuevas lo heredan: el toggle es_test se edita desde la ficha.
