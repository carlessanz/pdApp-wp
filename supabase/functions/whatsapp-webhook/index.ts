// Webhook de WhatsApp Cloud API (Meta).
// GET: verificación del webhook. POST: recepción de mensajes y estados.
// Se despliega con --no-verify-jwt: Meta no envía JWT; la autenticidad
// se valida con la firma X-Hub-Signature-256.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendText } from "../_shared/whatsapp.ts";
import { leerRespuesta, procesarIntake } from "../_shared/intake.ts";
import { procesarRespuestaOferta } from "../_shared/respuestas.ts";
import { esTelefonoTest } from "../_shared/gate.ts";

const encoder = new TextEncoder();

// Valida X-Hub-Signature-256: HMAC-SHA256 del cuerpo CRUDO con WHATSAPP_APP_SECRET.
async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const received = header.slice("sha256=".length);

  // Comparación en tiempo constante
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  // GET: verificación del webhook por parte de Meta
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const mode = params.get("hub.mode");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge ?? "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // POST: la firma se calcula sobre el cuerpo CRUDO, leerlo antes de parsear
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

  if (!(await verifySignature(rawBody, signature, appSecret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // A partir de aquí responder siempre 200 para que Meta no reintente
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );

    const payload = JSON.parse(rawBody);

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};

        // Mensajes entrantes
        for (const message of value.messages ?? []) {
          const from: string = message.from;
          // El cuerpo legible: el texto, o el título de la opción pulsada si la
          // respuesta es interactiva (botón o lista del intake).
          const { texto: cuerpo } = leerRespuesta(message);

          // Crear el contacto si no existe (sin tocar los existentes)
          const { error: contactError } = await supabase
            .from("wa_contacts")
            .upsert(
              { phone: from, name: null, opt_in: false },
              { onConflict: "phone", ignoreDuplicates: true },
            );
          if (contactError) console.error("wa_contacts upsert:", contactError.message);

          // Upsert, no insert: Meta reintenta las entregas y el mismo wa_message_id
          // puede llegar más de una vez (índice único en wa_message_id).
          const { error: messageError } = await supabase.from("wa_messages").upsert(
            {
              wa_message_id: message.id,
              contact_phone: from,
              direction: "inbound",
              type: message.type ?? null,
              body: cuerpo,
              status: "received",
              raw: message,
            },
            { onConflict: "wa_message_id", ignoreDuplicates: true },
          );
          if (messageError) console.error("wa_messages upsert:", messageError.message);

          // Abre/renueva la ventana de servicio de 24 h para este contacto.
          const { error: windowError } = await supabase
            .from("wa_contacts")
            .update({ last_inbound_at: new Date().toISOString() })
            .eq("phone", from);
          if (windowError) console.error("last_inbound_at update:", windowError.message);

          // Gate "solo usuarios de prueba": el mensaje entrante queda registrado y
          // abre la ventana, pero NO respondemos (ALTA/BAJA, respuesta a oferta ni
          // intake) si el número no es de un productor/entidad marcado es_test.
          // Barrera de la app, independiente de la fase de Meta (§8). El mensaje se
          // queda en la consola para que lo atienda una persona.
          if (!(await esTelefonoTest(supabase, from))) continue;

          // Palabras clave de opt-in / opt-out. Ambas se confirman por mensaje:
          // estamos dentro de la ventana de servicio, así que es gratis y no
          // requiere plantilla.
          const keyword = cuerpo?.trim().toUpperCase();
          if (keyword === "BAJA") {
            const { error } = await supabase
              .from("wa_contacts")
              .update({ opt_in: false, opt_out_at: new Date().toISOString() })
              .eq("phone", from);
            if (error) console.error("opt-out update:", error.message);
            await sendText(
              supabase,
              from,
              "Has estat donat de baixa de les notificacions. " +
                "Escriu ALTA si vols tornar a rebre-les.",
            );
            continue;
          }
          if (keyword === "ALTA") {
            const { error } = await supabase
              .from("wa_contacts")
              .update({ opt_in: true, opt_in_at: new Date().toISOString() })
              .eq("phone", from);
            if (error) console.error("opt-in update:", error.message);
            await sendText(
              supabase,
              from,
              "Alta confirmada. Escriu BAJA per deixar de rebre notificacions.",
            );
            continue;
          }

          // Respuesta de una entidad a una oferta (sí/no). Tiene PRIORIDAD sobre
          // el intake: si el número tiene una oferta pendiente y contesta, se
          // atiende aquí. Así se resuelve el doble rol (un productor que también
          // es entidad y responde a una oferta no cae en el formulario de intake).
          try {
            if (await procesarRespuestaOferta(supabase, from, message)) continue;
          } catch (err) {
            console.error(
              "respuesta-oferta:",
              err instanceof Error ? err.message : String(err),
            );
          }

          // Intake conversacional: solo responde si el teléfono es de un
          // productor registrado. Con cualquier otro contacto no hace nada y el
          // mensaje se queda en la consola para que lo atienda una persona.
          try {
            await procesarIntake(supabase, from, message);
          } catch (err) {
            console.error(
              "intake:",
              err instanceof Error ? err.message : String(err),
            );
          }
        }

        // Estados de mensajes salientes (sent/delivered/read/failed)
        for (const status of value.statuses ?? []) {
          const { error } = await supabase
            .from("wa_messages")
            .update({ status: status.status })
            .eq("wa_message_id", status.id);
          if (error) console.error("status update:", error.message);
        }
      }
    }
  } catch (err) {
    console.error(
      "Error procesando webhook:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return new Response("OK", { status: 200 });
});
