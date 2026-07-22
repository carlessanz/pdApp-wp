// Recordatorio de intake a medias (POMA).
//
// La invoca pg_cron cada 2 min vía pg_net (ver 20260722130000_intake_recordatorios.sql).
// Busca sesiones de intake inactivas entre 10 min y 12 h y, si aún no se ha avisado,
// manda al productor un mensaje con botones "Continuar / Cancel·lar" y marca la sesión.
//
// No pasa por whatsapp-send (que exige JWT de usuario y solo hace texto/plantilla):
// llama directamente a sendBotones de _shared, igual que el webhook. En modo PoC
// (WHATSAPP_ENVIO_REAL != true) el envío se simula y queda registrado como 'simulat'.
//
// Se despliega con --no-verify-jwt (la llama un job, no un usuario) y se protege con
// un secreto compartido en la cabecera x-recordatorios-secret (env RECORDATORIOS_SECRET),
// cuyo valor también vive en app_config para que el job lo pueda enviar.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendBotones } from "../_shared/whatsapp.ts";

// Ventana de inactividad: se avisa a partir de 10 min y hasta la caducidad de 12 h
// (a partir de ahí la sesión se descarta sola en el próximo mensaje).
const MIN_INACTIVO_MS = 10 * 60 * 1000;
const CADUCIDAD_MS = 12 * 60 * 60 * 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  // Autenticación por secreto compartido: solo el job (que lo lee de app_config) entra.
  const esperado = Deno.env.get("RECORDATORIOS_SECRET");
  const recibido = req.headers.get("x-recordatorios-secret");
  if (!esperado || recibido !== esperado) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ahora = Date.now();
  const hace10min = new Date(ahora - MIN_INACTIVO_MS).toISOString();
  const hace12h = new Date(ahora - CADUCIDAD_MS).toISOString();

  // Sesiones a medias (paso_actual no nulo), inactivas entre 10 min y 12 h, sin aviso previo.
  const { data: sesiones, error } = await supabase
    .from("intake_sessions")
    .select("id, telefono, paso_actual, updated_at")
    .not("paso_actual", "is", null)
    .lt("updated_at", hace10min)
    .gt("updated_at", hace12h)
    .is("recordatorio_enviado_at", null);

  if (error) {
    console.error("intake_sessions select:", error.message);
    return json({ error: "Error consultando sesiones" }, 500);
  }

  let enviados = 0;
  for (const s of sesiones ?? []) {
    await sendBotones(
      supabase,
      s.telefono,
      "Encara tens una oferta a mig fer 📝\n\nVols continuar on ho vas deixar o cancel·lar-la?",
      [
        { id: "intake:continuar", titulo: "Continuar ▶️" },
        { id: "intake:cancelar", titulo: "Cancel·lar ✖️" },
      ],
    );
    // Solo marca el aviso; no toca updated_at (si no, la ventana de 10 min se reiniciaría).
    const { error: upError } = await supabase
      .from("intake_sessions")
      .update({ recordatorio_enviado_at: new Date().toISOString() })
      .eq("id", s.id);
    if (upError) console.error("intake_sessions update recordatorio:", upError.message);
    else enviados++;
  }

  return json({ ok: true, revisadas: (sesiones ?? []).length, enviados }, 200);
});
