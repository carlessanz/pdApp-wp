// Webhook de WhatsApp Cloud API (Meta).
// GET: verificación del webhook. POST: recepción de mensajes y estados.
// Se despliega con --no-verify-jwt: Meta no envía JWT; la autenticidad
// se valida con la firma X-Hub-Signature-256.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

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
          const body: string | null =
            message.type === "text" ? (message.text?.body ?? null) : null;

          // Crear el contacto si no existe (sin tocar los existentes)
          const { error: contactError } = await supabase
            .from("wa_contacts")
            .upsert(
              { phone: from, name: null, opt_in: false },
              { onConflict: "phone", ignoreDuplicates: true },
            );
          if (contactError) console.error("wa_contacts upsert:", contactError.message);

          const { error: messageError } = await supabase.from("wa_messages").insert({
            wa_message_id: message.id,
            contact_phone: from,
            direction: "inbound",
            type: message.type ?? null,
            body,
            status: "received",
            raw: message,
          });
          if (messageError) console.error("wa_messages insert:", messageError.message);

          // Palabras clave de opt-in / opt-out
          const keyword = body?.trim().toUpperCase();
          if (keyword === "BAJA") {
            const { error } = await supabase
              .from("wa_contacts")
              .update({ opt_in: false, opt_out_at: new Date().toISOString() })
              .eq("phone", from);
            if (error) console.error("opt-out update:", error.message);
          } else if (keyword === "ALTA") {
            const { error } = await supabase
              .from("wa_contacts")
              .update({ opt_in: true, opt_in_at: new Date().toISOString() })
              .eq("phone", from);
            if (error) console.error("opt-in update:", error.message);
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
