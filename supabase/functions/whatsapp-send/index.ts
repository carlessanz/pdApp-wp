// Envío de mensajes de WhatsApp vía Cloud API de Meta.
// Formatos aceptados (POST JSON):
//   { "to": "34...", "type": "text", "body": "Hola" }
//   { "to": "34...", "type": "template", "template": "hello_world", "language": "en_US", "components": [] }
//
// TODO: quitar --no-verify-jwt y validar auth antes de producción.
// Es una herramienta de pruebas interna sin login todavía.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// CORS abierto para poder llamar desde el frontend Vite en local.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  try {
    const input = await req.json();
    const { to, type } = input;

    if (!to || typeof to !== "string") {
      return json({ error: "Falta 'to' (teléfono E.164 sin +, ej. 34612345678)" }, 400);
    }
    if (type !== "text" && type !== "template") {
      return json({ error: "'type' debe ser 'text' o 'template'" }, 400);
    }
    if (type === "text" && (!input.body || typeof input.body !== "string")) {
      return json({ error: "Falta 'body' para un mensaje de texto" }, 400);
    }
    if (type === "template" && (!input.template || typeof input.template !== "string")) {
      return json({ error: "Falta 'template' para un mensaje de plantilla" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );

    // Regla de negocio: solo se envía a contactos con opt_in = true
    const { data: contact, error: contactError } = await supabase
      .from("wa_contacts")
      .select("phone, opt_in")
      .eq("phone", to)
      .maybeSingle();

    if (contactError) {
      console.error("wa_contacts select:", contactError.message);
      return json({ error: "Error consultando el contacto" }, 500);
    }
    if (!contact) {
      return json({ error: `El contacto ${to} no existe en wa_contacts` }, 403);
    }
    if (!contact.opt_in) {
      return json(
        { error: `El contacto ${to} no tiene opt-in (opt_in=false); no se puede enviar` },
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
      `https://graph.facebook.com/v23.0/${phoneId}/messages`,
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
      return json(metaData, metaResponse.status);
    }

    const { error: insertError } = await supabase.from("wa_messages").insert({
      wa_message_id: metaData.messages?.[0]?.id ?? null,
      contact_phone: to,
      direction: "outbound",
      type,
      body: type === "text" ? input.body : input.template,
      status: "sent",
      raw: metaData,
    });
    if (insertError) console.error("wa_messages insert:", insertError.message);

    return json(metaData, 200);
  } catch (err) {
    console.error(
      "Error en whatsapp-send:",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "Error interno o JSON inválido" }, 500);
  }
});
