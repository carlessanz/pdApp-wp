// Envío de correo (ofertas por email) vía Resend.
//
// Requiere sesión de Supabase Auth (se despliega CON verify_jwt y además comprueba
// getUser). Gate de test: si `email_test_recipients` tiene filas y el destinatario
// no está en ella, rechaza con 403 (tabla vacía = sin restricción). El envío en sí
// vive en _shared/resend.ts.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/resend.ts";
import { esEmailTest } from "../_shared/gate.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

function originPermitido(origin: string): boolean {
  return ALLOWED_ORIGINS.some((patron) => {
    if (!patron.includes("*")) return patron === origin;
    const re = new RegExp(
      "^" + patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[A-Za-z0-9-]+") + "$",
    );
    return re.test(origin);
  });
}

function corsPara(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": originPermitido(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = (body: unknown, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  try {
    const input = await req.json();
    const { to, subject, html, text } = input;
    if (!to || typeof to !== "string") {
      return responder({ error: "Falta 'to' (email destino)" }, 400);
    }
    if (!subject || typeof subject !== "string") {
      return responder({ error: "Falta 'subject'" }, 400);
    }
    if ((!html || typeof html !== "string") && (!text || typeof text !== "string")) {
      return responder({ error: "Falta 'html' o 'text'" }, 400);
    }

    // Gate "solo usuarios de prueba" (es_test): fuente de verdad de la app,
    // independiente de la fase de Meta. Solo se envía al correo de una entidad
    // marcada es_test (§8).
    if (!(await esEmailTest(supabase, to))) {
      return responder(
        {
          error: `${to} no es de una entidad de prueba (es_test).`,
          code: "no_test_user",
        },
        403,
      );
    }

    // Gate de la lista de test de email (misma lógica que meta_test_recipients).
    const { data: enLista, error: listaError } = await supabase
      .from("email_test_recipients").select("email").eq("email", to).maybeSingle();
    if (listaError) {
      console.error("email_test_recipients select:", listaError.message);
      return responder({ error: "Error consultando la lista de test de email" }, 500);
    }
    if (!enLista) {
      const { count, error: countError } = await supabase
        .from("email_test_recipients").select("email", { count: "exact", head: true });
      if (countError) {
        console.error("email_test_recipients count:", countError.message);
        return responder({ error: "Error consultando la lista de test de email" }, 500);
      }
      if ((count ?? 0) > 0) {
        return responder(
          {
            error: `${to} no está en la lista de correos de prueba.`,
            code: "no_test_recipient",
          },
          403,
        );
      }
    }

    const r = await sendEmail({ to, subject, html, text });
    if (!r.ok) return responder(r.data, r.status === 0 ? 502 : r.status);
    return responder({ ok: true, data: r.data }, 200);
  } catch (err) {
    console.error("enviar-email:", err instanceof Error ? err.message : String(err));
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
