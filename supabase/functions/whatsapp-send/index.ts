// Envío de mensajes de WhatsApp vía Cloud API de Meta.
// Formatos aceptados (POST JSON):
//   { "to": "34...", "type": "text", "body": "Hola" }
//   { "to": "34...", "type": "template", "template": "hello_world", "language": "en_US", "components": [] }
//
// Requiere una sesión de Supabase Auth: se despliega SIN --no-verify-jwt, así que
// la plataforma valida la firma del JWT, y además aquí se comprueba que
// corresponde a un usuario real.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendText, sendTemplate } from "../_shared/whatsapp.ts";

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
      "authorization, x-client-info, apikey, content-type",
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // La plataforma ya ha validado la firma del JWT (verify_jwt). Aquí se
  // comprueba que detrás hay un usuario de verdad: la publishable key no es un
  // JWT, así que una petición sin sesión no llega ni a este punto.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return responder(
      { error: "Necesitas iniciar sesión para enviar mensajes", code: "unauthorized" },
      401,
    );
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

    // Gate de la lista de test de Meta. En el entorno de test la Cloud API solo
    // entrega a los ≤5 números dados de alta en Meta; los guardamos en
    // `meta_test_recipients`. Si la tabla tiene alguna fila, solo se envía a quien
    // esté en ella; si está vacía, no restringe (paso a producción sin límite de
    // 5). Defensa en profundidad: la UI ya desactiva el botón, esto lo corta en el
    // servidor aunque la UI fallara. Es independiente del interruptor
    // WHATSAPP_ENVIO_REAL: uno limita a QUIÉN se podría enviar, el otro si sale algo.
    const { data: enLista, error: listaError } = await supabase
      .from("meta_test_recipients")
      .select("phone")
      .eq("phone", to)
      .maybeSingle();
    if (listaError) {
      console.error("meta_test_recipients select:", listaError.message);
      return responder({ error: "Error consultando la lista de test de Meta" }, 500);
    }
    if (!enLista) {
      const { count, error: countError } = await supabase
        .from("meta_test_recipients")
        .select("phone", { count: "exact", head: true });
      if (countError) {
        console.error("meta_test_recipients count:", countError.message);
        return responder({ error: "Error consultando la lista de test de Meta" }, 500);
      }
      if ((count ?? 0) > 0) {
        return responder(
          {
            error:
              `${to} no está en la lista de números de prueba de Meta. En el entorno ` +
              `de test solo se puede enviar a los números dados de alta en Meta.`,
            code: "no_test_recipient",
          },
          403,
        );
      }
    }

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

    // La llamada a Meta y el registro del saliente viven en _shared/whatsapp.ts,
    // compartidos con el webhook. Aquí solo quedan las reglas de negocio.
    const r = type === "text"
      ? await sendText(supabase, to, input.body)
      : await sendTemplate(
        supabase,
        to,
        input.template,
        input.language ?? "en_US",
        input.components ?? [],
      );

    // Si Meta devuelve error, reenviarlo tal cual al cliente para depurar.
    if (!r.ok) return responder(r.data, r.status);

    return responder(r.data, 200);
  } catch (err) {
    console.error(
      "Error en whatsapp-send:",
      err instanceof Error ? err.message : String(err),
    );
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
