// Diálogo de aceptación de una entidad a una oferta.
//
// El panel, al enviar una oferta a una entidad, deja una fila 'pendent' en
// `oferta_respuestas`. Cuando la entidad responde por WhatsApp, esta función
// conduce un diálogo corto —SÍ → quants kg → (si venda/maquila) confirmar el preu
// mínim— y deja la fila lista para que el superadmin la apruebe desde el panel y
// la convierta en canalización. Devuelve true si ha gestionado el mensaje: entonces
// el webhook NO sigue con el intake, lo que da prioridad a la respuesta de oferta y
// resuelve el doble rol (un productor que también es entidad y contesta a una oferta
// se atiende aquí).
//
// El estado del diálogo vive en oferta_respuestas.dialeg_pas/dialeg_dades, igual
// que intake_sessions para el intake. Mientras el diálogo está en curso la fila
// sigue 'pendent' (así el emparejamiento "última pendent del teléfono" la sigue
// encontrando); al terminar pasa a 'acceptada'/'rebutjada'.

import { sendBotones, sendText } from "./whatsapp.ts";
import { leerRespuesta } from "./intake.ts";

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

// Botones de confirmación del preu mínim.
const BOTONS_PREU = [
  { id: "accept:preu_si", titulo: "Sí, accepto" },
  { id: "accept:preu_no", titulo: "No" },
];

/** Primer número del texto (acepta "200", "150,5", "uns 300 kg"). */
function parseNumero(texto: string | null): number | null {
  const m = (texto ?? "").match(/\d+([.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

/** Cierra la aceptación: la fila queda 'acceptada' y pendiente de aprobación. */
async function finalizarAceptacion(
  supabase: Cliente,
  from: string,
  filaId: string,
  kg: number,
  preu: number | null,
  nota: string | null,
): Promise<void> {
  const cambios: Record<string, unknown> = {
    estado: "acceptada",
    aprovacio: "pendent",
    kg_solicitados: kg,
    preu_ofert: preu,
    dialeg_pas: "fet",
    respondido_at: new Date().toISOString(),
  };
  if (nota) cambios.mensaje_respuesta = nota;
  const { error } = await supabase.from("oferta_respuestas").update(cambios).eq("id", filaId);
  if (error) console.error("oferta_respuestas finalizar:", error.message);
  await sendText(
    supabase, from,
    `Perfecte, hem registrat que en vols ${kg} kg. L'equip de POMA ho confirmarà i ` +
      "coordinarà la recollida. 🚚",
  );
}

/** Marca la fila 'rebutjada' y cierra el diálogo. */
async function rechazar(
  supabase: Cliente,
  from: string,
  filaId: string,
  texto: string,
): Promise<void> {
  await supabase.from("oferta_respuestas").update({
    estado: "rebutjada",
    dialeg_pas: "fet",
    respondido_at: new Date().toISOString(),
    mensaje_respuesta: texto,
  }).eq("id", filaId);
  await sendText(
    supabase, from,
    "D'acord, gràcies per contestar. Ho tindrem en compte per a properes ofertes. 🙌",
  );
}

export async function procesarRespuestaOferta(
  supabase: Cliente,
  from: string,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<boolean> {
  const { texto, id } = leerRespuesta(message);

  // Los taps interactivos que no son de este diálogo (p. ej. 'familia:' del
  // intake) no se tocan: se dejan pasar al intake.
  if (id && !id.startsWith("accept:")) return false;

  // La respuesta se vincula a la última oferta pendiente enviada a este número.
  const { data: filas } = await supabase
    .from("oferta_respuestas")
    .select("id, excedente_id, dialeg_pas")
    .eq("telefono", from)
    .eq("estado", "pendent")
    .order("enviado_at", { ascending: false })
    .limit(1);
  const fila = (filas ?? [])[0];
  if (!fila) return false;

  const pas: string | null = fila.dialeg_pas ?? null;

  // ---- Paso: quants kg ----
  if (pas === "kg") {
    // Cambio de idea: un "no" claro cancela la aceptación.
    if (clasificar(texto ?? "") === "rebutjada") {
      await rechazar(supabase, from, fila.id, texto ?? "");
      return true;
    }
    const kg = parseNumero(texto);
    if (kg === null || kg <= 0) {
      await sendText(supabase, from, "Escriu quants kg en vols, només el número (p. ex. 200).");
      return true;
    }
    const { data: exc } = await supabase
      .from("excedentes").select("modalitat, preu_minim").eq("id", fila.excedente_id).maybeSingle();
    const conPreu = !!exc && (exc.modalitat === "venda" || exc.modalitat === "maquila") &&
      exc.preu_minim != null;
    if (conPreu) {
      await supabase.from("oferta_respuestas")
        .update({ kg_solicitados: kg, dialeg_pas: "preu" }).eq("id", fila.id);
      await sendBotones(
        supabase, from,
        `El preu mínim d'aquesta oferta és ${Number(exc.preu_minim)} €/kg. Hi estàs d'acord?`,
        BOTONS_PREU,
      );
      return true;
    }
    await finalizarAceptacion(supabase, from, fila.id, kg, null, null);
    return true;
  }

  // ---- Paso: confirmar preu (botones, o un sí/no de texto) ----
  if (pas === "preu") {
    const acepta = id === "accept:preu_si" || clasificar(texto ?? "") === "acceptada";
    const rechaza = id === "accept:preu_no" || clasificar(texto ?? "") === "rebutjada";
    if (!acepta && !rechaza) {
      await sendBotones(
        supabase, from, "Tria una opció: hi estàs d'acord amb el preu mínim?", BOTONS_PREU,
      );
      return true;
    }
    const { data: f2 } = await supabase
      .from("oferta_respuestas").select("kg_solicitados").eq("id", fila.id).maybeSingle();
    const kg = Number(f2?.kg_solicitados ?? 0);
    if (acepta) {
      const { data: exc } = await supabase
        .from("excedentes").select("preu_minim").eq("id", fila.excedente_id).maybeSingle();
      await finalizarAceptacion(supabase, from, fila.id, kg, Number(exc?.preu_minim ?? 0), null);
    } else {
      await finalizarAceptacion(
        supabase, from, fila.id, kg, null,
        "L'entitat no accepta el preu mínim (a revisar per l'equip).",
      );
    }
    return true;
  }

  // ---- Sin diálogo iniciado: clasificar el sí/no inicial ----
  const inicial = clasificar(texto ?? "");
  if (!inicial) return false;

  if (inicial === "rebutjada") {
    await rechazar(supabase, from, fila.id, texto ?? "");
    return true;
  }

  // Aceptación: arranca el diálogo pidiendo kg (la fila sigue 'pendent' para que
  // el próximo mensaje la vuelva a emparejar).
  const { data: exc } = await supabase
    .from("excedentes").select("kg_total").eq("id", fila.excedente_id).maybeSingle();
  const { data: cans } = await supabase
    .from("canalizaciones").select("kg_confirmados").eq("excedente_id", fila.excedente_id);
  const usados = (cans ?? []).reduce(
    (s: number, c: { kg_confirmados: number | null }) => s + Number(c.kg_confirmados ?? 0), 0);
  const disp = Math.max(0, Number(exc?.kg_total ?? 0) - usados);

  await supabase.from("oferta_respuestas")
    .update({ dialeg_pas: "kg", mensaje_respuesta: texto }).eq("id", fila.id);
  await sendText(
    supabase, from,
    `Perfecte! Quants kg en vols?${disp ? ` (disponibles: ${disp} kg aprox)` : ""} ` +
      "Escriu un número.",
  );
  return true;
}
