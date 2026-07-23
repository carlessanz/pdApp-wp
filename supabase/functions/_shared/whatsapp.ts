// Envío de mensajes por la Cloud API de Meta, compartido entre las Edge Functions.
//
// Aquí solo vive la llamada a la Graph API y el registro del saliente. Las reglas
// de negocio (ventana de 24 h, opt-in) son de quien llama: `whatsapp-send` las
// aplica antes, y el intake del webhook trabaja siempre dentro de la ventana
// porque responde a un mensaje que acaba de llegar.

const API_VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0";

// Modo prueba de concepto: mientras esto no sea exactamente "true", NO se envía
// nada por WhatsApp. Es seguro por omisión: si el secreto no está configurado,
// no sale ningún mensaje. Los salientes se registran igualmente en wa_messages
// con status='simulat' para verlos en la consola. Se activa el envío real
// poniendo WHATSAPP_ENVIO_REAL=true en los secretos, sin tocar código.
const ENVIO_REAL = Deno.env.get("WHATSAPP_ENVIO_REAL") === "true";

// WhatsApp acepta como máximo 3 botones y 10 filas por lista interactiva.
export const MAX_BOTONES = 3;
export const MAX_FILAS_LISTA = 10;

export interface Boton {
  id: string;
  titulo: string;
}

export interface FilaLista {
  id: string;
  titulo: string;
  descripcion?: string;
}

export interface RespuestaMeta {
  ok: boolean;
  /** Código HTTP de Meta, para poder reenviarlo tal cual al cliente. */
  status: number;
  waMessageId: string | null;
  data: unknown;
  /** true si no se contactó con Meta (modo prueba de concepto). */
  simulado?: boolean;
}

async function enviar(payload: Record<string, unknown>): Promise<RespuestaMeta> {
  if (!ENVIO_REAL) {
    // Modo PoC: no se contacta con Meta. Se devuelve una respuesta simulada para
    // que el flujo (intake, panel) continúe con normalidad.
    // deno-lint-ignore no-explicit-any
    const to = (payload as any)?.to ?? "?";
    console.log(`[SIMULADO] no se envía a ${to} (WHATSAPP_ENVIO_REAL != true)`);
    return {
      ok: true,
      status: 200,
      waMessageId: `sim-${crypto.randomUUID()}`,
      data: { simulado: true },
      simulado: true,
    };
  }
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Graph API:", JSON.stringify(data));
    return { ok: false, status: res.status, waMessageId: null, data };
  }
  return {
    ok: true,
    status: res.status,
    // deno-lint-ignore no-explicit-any
    waMessageId: (data as any)?.messages?.[0]?.id ?? null,
    data,
  };
}

/** Deja constancia del saliente para que aparezca en la conversación de la consola. */
export async function registrarSaliente(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  tipo: string,
  body: string | null,
  waMessageId: string | null,
  raw?: unknown,
): Promise<void> {
  // Los mensajes simulados llevan un id "sim-…" (los reales, el wamid de Meta):
  // se distinguen en la consola con status 'simulat'.
  const simulado = waMessageId?.startsWith("sim-") ?? false;
  const { error } = await supabase.from("wa_messages").upsert(
    {
      wa_message_id: waMessageId,
      contact_phone: to,
      direction: "outbound",
      type: tipo,
      body,
      status: simulado ? "simulat" : "sent",
      ...(raw === undefined ? {} : { raw }),
    },
    { onConflict: "wa_message_id", ignoreDuplicates: true },
  );
  if (error) console.error("registrarSaliente:", error.message);
}

export async function sendText(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  body: string,
): Promise<RespuestaMeta> {
  const r = await enviar({ to, type: "text", text: { body, preview_url: false } });
  if (r.ok) await registrarSaliente(supabase, to, "text", body, r.waMessageId, r.data);
  return r;
}

// Texto legible de las plantillas para la CONSOLA (el destinatario recibe el
// contenido real que renderiza Meta; aquí solo dejamos algo entendible en el hilo,
// no el nombre "crudo" de la plantilla).
const TEXTO_PLANTILLA: Record<string, string> = {
  hello_world: "Hello world! (plantilla de Meta, només en anglès al número de prova)",
};

export async function sendTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  nombre: string,
  idioma: string,
  components: unknown[] = [],
): Promise<RespuestaMeta> {
  const r = await enviar({
    to,
    type: "template",
    template: { name: nombre, language: { code: idioma }, components },
  });
  const bodyConsola = TEXTO_PLANTILLA[nombre] ?? `[plantilla: ${nombre}]`;
  if (r.ok) await registrarSaliente(supabase, to, "template", bodyConsola, r.waMessageId, r.data);
  return r;
}

/** Pregunta con hasta 3 botones. */
export async function sendBotones(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  texto: string,
  botones: Boton[],
): Promise<RespuestaMeta> {
  const r = await enviar({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto },
      action: {
        buttons: botones.slice(0, MAX_BOTONES).map((b) => ({
          type: "reply",
          // Meta limita el título del botón a 20 caracteres.
          reply: { id: b.id, title: b.titulo.slice(0, 20) },
        })),
      },
    },
  });
  if (r.ok) await registrarSaliente(supabase, to, "interactive", texto, r.waMessageId);
  return r;
}

/** Pregunta con lista desplegable, hasta 10 filas. */
export async function sendLista(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  texto: string,
  etiquetaBoton: string,
  filas: FilaLista[],
): Promise<RespuestaMeta> {
  const r = await enviar({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: texto },
      action: {
        // El botón que abre la lista admite 20 caracteres.
        button: etiquetaBoton.slice(0, 20),
        sections: [{
          rows: filas.slice(0, MAX_FILAS_LISTA).map((f) => ({
            id: f.id,
            // Meta limita el título de fila a 24 caracteres y la descripción a 72.
            title: f.titulo.slice(0, 24),
            ...(f.descripcion ? { description: f.descripcion.slice(0, 72) } : {}),
          })),
        }],
      },
    },
  });
  if (r.ok) await registrarSaliente(supabase, to, "interactive", texto, r.waMessageId);
  return r;
}
