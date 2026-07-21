// Envío de mensajes de WhatsApp vía Cloud API de Meta.
// Formatos aceptados (POST JSON):
//   { "to": "34...", "type": "text", "body": "Hola" }
//   { "to": "34...", "type": "template", "template": "hello_world", "language": "en_US", "components": [] }
//
// Requiere la cabecera x-api-key (WHATSAPP_SEND_API_KEY).
// TODO producción: sustituir la x-api-key por Supabase Auth (verify_jwt) y quitar
// el --no-verify-jwt del despliegue.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const API_VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0";

// CORS restringido a los orígenes del panel; ya no '*'.
// ALLOWED_ORIGIN admite varios separados por comas y '*' como comodín dentro de
// un origen, porque los despliegues de Vercel no tienen URL estable. Ejemplo:
//   http://localhost:5173,https://pdapp-*-carlessanz-projects.vercel.app
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function originPermitido(origin: string): boolean {
  return ALLOWED_ORIGINS.some((patron) => {
    if (!patron.includes("*")) return patron === origin;
    const re = new RegExp(
      "^" + patron.split("*").map((p) =>
        p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("[A-Za-z0-9-]+") + "$",
    );
    return re.test(origin);
  });
}

// El navegador exige que Allow-Origin sea un origen concreto, no una lista:
// se devuelve el del solicitante si está permitido y, si no, el primero
// configurado (que hará fallar el CORS en el navegador, como debe ser).
function corsPara(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": originPermitido(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Ventana de servicio de WhatsApp: 24 h desde el último mensaje del contacto.
const WINDOW_MS = 24 * 60 * 60 * 1000;

function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Comparación en tiempo constante, igual que la de la firma en whatsapp-webhook.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  // Closure para no repetir las cabeceras CORS en cada return.
  const responder = (body: unknown, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return responder({ error: "Method Not Allowed" }, 405);
  }

  const apiKey = Deno.env.get("WHATSAPP_SEND_API_KEY") ?? "";
  const provided = req.headers.get("x-api-key") ?? "";
  if (!apiKey || !timingSafeEqual(provided, apiKey)) {
    return responder({ error: "No autorizado", code: "unauthorized" }, 401);
  }

  try {
    const input = await req.json();
    const { to, type } = input;

    if (!to || typeof to !== "string") {
      return responder({ error: "Falta 'to' (teléfono E.164 sin +, ej. 34612345678)" }, 400);
    }
    if (type !== "text" && type !== "template") {
      return responder({ error: "'type' debe ser 'text' o 'template'" }, 400);
    }
    if (type === "text" && (!input.body || typeof input.body !== "string")) {
      return responder({ error: "Falta 'body' para un mensaje de texto" }, 400);
    }
    if (type === "template" && (!input.template || typeof input.template !== "string")) {
      return responder({ error: "Falta 'template' para un mensaje de plantilla" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );

    const { data: contact, error: contactError } = await supabase
      .from("wa_contacts")
      .select("phone, opt_in, last_inbound_at")
      .eq("phone", to)
      .maybeSingle();

    if (contactError) {
      console.error("wa_contacts select:", contactError.message);
      return responder({ error: "Error consultando el contacto" }, 500);
    }
    if (!contact) {
      return responder(
        { error: `El contacto ${to} no existe en wa_contacts`, code: "unknown_contact" },
        404,
      );
    }

    // Reglas de envío (decisión D1 del manual): el texto libre es una respuesta de
    // servicio y solo cabe con la ventana abierta; la plantilla la iniciamos nosotros
    // y por eso exige consentimiento.
    if (type === "text") {
      const lastInbound = contact.last_inbound_at
        ? new Date(contact.last_inbound_at).getTime()
        : 0;
      if (Date.now() - lastInbound > WINDOW_MS) {
        return responder(
          {
            error:
              `La ventana de 24 h con ${to} está cerrada. Solo se puede escribir texto ` +
              `libre después de que el contacto haya escrito; inicia con una plantilla.`,
            code: "window_closed",
          },
          409,
        );
      }
    } else if (!contact.opt_in) {
      return responder(
        {
          error: `El contacto ${to} no tiene opt-in; no se le puede enviar una plantilla`,
          code: "no_opt_in",
        },
        403,
      );
    }

    // Cuerpo para la Graph API según el tipo de mensaje
    const metaBody: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to,
      type,
    };
    if (type === "text") {
      metaBody.text = { body: input.body };
    } else {
      metaBody.template = {
        name: input.template,
        language: { code: input.language ?? "en_US" },
        components: input.components ?? [],
      };
    }

    const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
    const metaResponse = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metaBody),
      },
    );

    const metaData = await metaResponse.json();

    // Si Meta devuelve error, reenviarlo tal cual al cliente para depurar
    if (!metaResponse.ok) {
      return responder(metaData, metaResponse.status);
    }

    const { error: insertError } = await supabase.from("wa_messages").upsert(
      {
        wa_message_id: metaData.messages?.[0]?.id ?? null,
        contact_phone: to,
        direction: "outbound",
        type,
        body: type === "text" ? input.body : input.template,
        status: "sent",
        raw: metaData,
      },
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    );
    if (insertError) console.error("wa_messages upsert:", insertError.message);

    return responder(metaData, 200);
  } catch (err) {
    console.error(
      "Error en whatsapp-send:",
      err instanceof Error ? err.message : String(err),
    );
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
