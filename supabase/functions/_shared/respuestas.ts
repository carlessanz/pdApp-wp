// Captura de la respuesta de una entidad a una oferta (flujo de aceptación).
//
// El panel, al enviar una oferta a una entidad, deja una fila 'pendent' en
// `oferta_respuestas`. Cuando la entidad responde por WhatsApp, esta función
// interpreta un sí/no y actualiza la fila 'pendent' más reciente de ese teléfono.
// Devuelve true si ha gestionado el mensaje: entonces el webhook NO sigue con el
// intake, lo que da prioridad a la respuesta de oferta y resuelve el doble rol
// (un productor que también es entidad y contesta a una oferta se atiende aquí).

import { sendText } from "./whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

// Normaliza para comparar: quita acentos, signos y espacios de más.
function normalizar(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita diacríticos: í→i (ç se conserva)
    .toLowerCase()
    .replace(/[!¡.,;:·’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Afirmativos y negativos habituales (català/castellà), ya normalizados.
const AFIRMATIVOS = [
  "si", "ok", "okay", "vale", "d acord", "dacord", "accepto", "acceptu",
  "la vull", "ho vull", "vull", "correcte", "perfecte", "endavant", "si la vull",
  "si gracies", "em va be",
];
const NEGATIVOS = [
  "no", "no puc", "no la vull", "no ho vull", "no em va be", "rebutjo",
  "descarto", "ara no", "no gracies", "no interessa",
];

function clasificar(texto: string): "acceptada" | "rebutjada" | null {
  const t = normalizar(texto);
  if (!t) return null;
  // Solo mensajes cortos disparan por "empieza/termina por"; un párrafo largo
  // exige coincidencia exacta (que no se dará) para no crear falsos positivos.
  const corto = t.split(" ").length <= 5;
  const casa = (lista: string[]) =>
    lista.some((p) =>
      t === p || (corto && (t.startsWith(p + " ") || t.endsWith(" " + p)))
    );
  // El negativo va primero: "no la vull" no debe leerse como "vull".
  if (casa(NEGATIVOS)) return "rebutjada";
  if (casa(AFIRMATIVOS)) return "acceptada";
  return null;
}

export async function procesarRespuestaOferta(
  supabase: Cliente,
  from: string,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<boolean> {
  // Solo texto plano: los pasos con opciones del intake llegan como 'interactive'
  // y no deben interpretarse como respuesta a una oferta.
  if (message?.type !== "text") return false;
  const texto: string = message?.text?.body ?? "";
  const estado = clasificar(texto);
  if (!estado) return false;

  // La respuesta se vincula a la última oferta pendiente enviada a este número.
  const { data: filas } = await supabase
    .from("oferta_respuestas")
    .select("id")
    .eq("telefono", from)
    .eq("estado", "pendent")
    .order("enviado_at", { ascending: false })
    .limit(1);
  const fila = (filas ?? [])[0];
  if (!fila) return false;

  const { error } = await supabase
    .from("oferta_respuestas")
    .update({
      estado,
      respondido_at: new Date().toISOString(),
      mensaje_respuesta: texto,
    })
    .eq("id", fila.id);
  if (error) {
    console.error("oferta_respuestas update:", error.message);
    return true; // se reconoció como respuesta aunque el update fallara
  }

  const confirmacion = estado === "acceptada"
    ? "Perfecte! Hem registrat que voleu recollir aquesta oferta. L'equip de POMA es posarà en contacte per coordinar la recollida. 🚚"
    : "D'acord, gràcies per contestar. Ho tindrem en compte per a properes ofertes. 🙌";
  await sendText(supabase, from, confirmacion);
  return true;
}
