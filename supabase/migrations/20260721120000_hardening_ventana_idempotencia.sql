-- Hardening de la infraestructura de mensajería (POMA, Prompt 0bis).
-- Dos huecos detectados en la fase 1:
--   1. Meta reintenta las entregas del webhook y hoy se duplicarían los mensajes.
--   2. La ventana de servicio de 24 h no estaba modelada en datos: el envío de texto
--      libre se bloqueaba por opt_in, cuando la regla real de WhatsApp es otra
--      (texto ⇒ ventana abierta; plantilla ⇒ opt-in).

-- Última vez que el contacto nos escribió. Con esto se calcula la ventana de 24 h
-- en whatsapp-send y se puede mostrar en la consola sin esperar al error de Meta.
alter table wa_contacts add column last_inbound_at timestamptz;

-- Idempotencia: un mismo wa_message_id no puede entrar dos veces.
--
-- El índice NO es parcial a propósito, aunque la columna sea nullable. En
-- PostgreSQL los NULL son distintos entre sí dentro de un índice único, así que
-- las filas sin wa_message_id conviven sin problema. Un índice parcial
-- (... where wa_message_id is not null) daría el mismo resultado en la tabla
-- pero rompería los upsert: PostgREST genera "on conflict (wa_message_id)" sin
-- predicado y Postgres no puede inferir un índice parcial si no se repite su
-- WHERE, fallando con 42P10 en cada mensaje entrante.
create unique index wa_messages_wa_message_id_key
  on wa_messages (wa_message_id);
