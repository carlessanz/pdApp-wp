// Recuperación de contraseña por email (vía Resend).
//
// Se despliega con --no-verify-jwt (la llama un usuario NO autenticado desde el
// login). Genera el enlace de recuperación con la Admin API (generateLink, que
// NO usa el mailer nativo de Supabase) y lo envía por Resend. Responde SIEMPRE
// 200 genérico para no filtrar si el email existe o no.
//
// El enlace lleva a APP_URL; al abrirse, el cliente de Supabase detecta el token
// del hash y dispara PASSWORD_RECOVERY (ver AuthGate). APP_URL debe estar en la
// allow-list de redirects de Auth (Management API, no config push; ver §9).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/resend.ts";

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
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405, cors);

  try {
    const { email } = await req.json().catch(() => ({}));
    if (email && typeof email === "string") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SB_SECRET_KEY")!,
      );
      const redirectTo = Deno.env.get("APP_URL") ?? ALLOWED_ORIGINS[0];
      const { data, error } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      const link = (data?.properties as { action_link?: string } | undefined)?.action_link;
      if (error) {
        // Email inexistente u otro: no se revela al cliente (respuesta genérica).
        console.error("generateLink:", error.message);
      } else if (link) {
        await sendEmail({
          to: email,
          subject: "Recuperació de contrasenya · POMA",
          html: `<!doctype html><html><body style="margin:0;background:#F9FAFD;font-family:'Space Grotesk',-apple-system,Segoe UI,Roboto,sans-serif;color:#234C66">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <h1 style="font-size:22px;margin:0 0 8px">Recupera la teva contrasenya</h1>
    <p style="font-size:15px;line-height:1.5">Has demanat restablir la contrasenya del panell de POMA. Fes clic al botó per triar-ne una de nova:</p>
    <p style="margin:24px 0"><a href="${link}" style="background:#234C66;color:#E0EBC7;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;display:inline-block">Restablir contrasenya</a></p>
    <p style="font-size:13px;color:#8A9FAC">Si no has estat tu, ignora aquest correu. L'enllaç caduca aviat.</p>
  </div></body></html>`,
          text: `Restableix la teva contrasenya de POMA obrint aquest enllaç: ${link}`,
        });
      }
    }
  } catch (err) {
    console.error("recuperar-password:", err instanceof Error ? err.message : String(err));
  }

  // Respuesta genérica siempre.
  return json({ ok: true }, 200, cors);
});
