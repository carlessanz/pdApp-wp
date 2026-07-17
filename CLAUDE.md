# CLAUDE.md

Este archivo proporciona contexto a Claude Code cuando trabaja en este repositorio.

## Proyecto

Consola de mensajería WhatsApp (PDApp). Permite enviar y recibir mensajes de WhatsApp
mediante la Cloud API de Meta, en entorno de pruebas (número de test de Meta).

## Stack

- **Frontend:** Vite + React + `@supabase/supabase-js` (con Realtime).
- **Backend:** Edge Functions de Supabase en TypeScript/Deno.
- **Base de datos:** Supabase (Postgres).

## Convenciones

- Teléfonos en formato E.164 **sin** el símbolo `+`, ej. `34612345678`.
- Endpoint de Meta: `https://graph.facebook.com/v23.0/{WHATSAPP_PHONE_ID}/messages`
- Nunca escribir secretos en el código; usar variables de entorno.
- Variables de entorno en las Edge Functions:
  - `WHATSAPP_TOKEN`
  - `WHATSAPP_PHONE_ID`
  - `WHATSAPP_VERIFY_TOKEN`
  - `WHATSAPP_APP_SECRET`
  - `SB_SECRET_KEY` (la nueva secret key de Supabase, `sb_secret_...`)
  - `SUPABASE_URL` (inyectada automáticamente por Supabase)
- Claves de Supabase: usar las **nuevas**.
  - Publishable key (`sb_publishable_...`) en el frontend.
  - Secret key (`sb_secret_...`) en el servidor.
  - **No** usar las obsoletas `anon`/`service_role` (las claves JWT antiguas).
  - Los roles de Postgres `anon`/`authenticated`/`service_role` sí se siguen usando en las políticas RLS.

## Reglas de negocio

- Solo se puede enviar mensajes a contactos con `opt_in = true`.
- Regla de WhatsApp: fuera de la ventana de 24 horas solo se puede iniciar conversación
  con una plantilla aprobada; el texto libre solo funciona dentro de la ventana
  (después de que el usuario haya escrito).

## Seguridad

- Es una herramienta de pruebas de uso interno.
- **Pendiente:** antes de exponerla a producción hay que añadir autenticación.
  No implementarla todavía; solo tenerlo anotado como tarea pendiente.
