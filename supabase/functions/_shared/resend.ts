// Envío de correo vía Resend (https://resend.com), compartido por las Edge
// Functions que mandan email (ofertas y recuperación de contraseña).
//
// Nunca lanza: devuelve { ok, status, data }, como _shared/whatsapp.ts.
//
// Requiere los secrets RESEND_API_KEY y RESEND_FROM (remitente de un dominio
// VERIFICADO en Resend; sin dominio verificado Resend solo entrega al correo
// propietario de la cuenta). Ver AGENTS.md §10.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Por defecto, el remitente de pruebas de Resend (solo entrega al owner).
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "POMA <onboarding@resend.dev>";

export interface EmailPayload {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface EmailResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    console.error("[resend] Falta RESEND_API_KEY: no se envía email.");
    return { ok: false, status: 500, data: { error: "email_no_configurado" } };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: payload.to,
        subject: payload.subject,
        ...(payload.html ? { html: payload.html } : {}),
        ...(payload.text ? { text: payload.text } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) console.error("[resend] error", res.status, JSON.stringify(data));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error("[resend] fetch falló:", err instanceof Error ? err.message : String(err));
    return { ok: false, status: 0, data: { error: String(err) } };
  }
}

// Envuelve un texto plano (el de la oferta, con emojis y saltos) en un HTML
// simple con la identidad de POMA, para que el correo se vea decente.
export function textoAHtml(titulo: string, cuerpo: string): string {
  const escapado = cuerpo
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><body style="margin:0;background:#F9FAFD;font-family:'Space Grotesk',-apple-system,Segoe UI,Roboto,sans-serif;color:#234C66">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <h1 style="color:#234C66;font-size:22px;margin:0 0 16px">${titulo}</h1>
    <pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.5;background:#fff;border:1px solid #E0EBC7;border-radius:12px;padding:16px;margin:0">${escapado}</pre>
    <p style="color:#8A9FAC;font-size:12px;margin-top:16px">POMA · Espigoladors — aprofitament d'excedents alimentaris</p>
  </div></body></html>`;
}
