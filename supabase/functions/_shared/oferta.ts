// Cierre del intake: identificador, alta del excedente y texto de la oferta.

import { sendText } from "./whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

interface SesionCompleta {
  id: string;
  telefono: string;
  productor_id: string | null;
  datos_parciales: Record<string, unknown>;
}

// El texto que se publica usa las etiquetas de siempre, no los valores internos.
const ETIQUETA_MODALITAT: Record<string, string> = {
  donacio: "donació",
  venda: "venda",
  maquila: "maquila",
};

/** Tres letras en mayúsculas, sin acentos ni espacios, para el identificador. */
export function siglas(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
}

/**
 * E-AAMMDD-XXX-YYY-N, donde N es el orden de la oferta ese día para ese
 * productor y producto. La unicidad la garantiza el `unique` de la columna:
 * si dos intakes terminan a la vez, el segundo reintenta con N+1.
 */
async function generarId(
  supabase: Cliente,
  productor: string,
  producto: string,
): Promise<string> {
  const hoy = new Date();
  const fecha = [
    String(hoy.getFullYear()).slice(2),
    String(hoy.getMonth() + 1).padStart(2, "0"),
    String(hoy.getDate()).padStart(2, "0"),
  ].join("");
  const prefijo = `E-${fecha}-${siglas(productor)}-${siglas(producto)}`;

  const { data } = await supabase
    .from("excedentes").select("id_excedente").like("id_excedente", `${prefijo}-%`);
  return `${prefijo}-${(data?.length ?? 0) + 1}`;
}

/**
 * Texto que se publica en el grupo de canalizaciones.
 * Reproduce el formato que el equipo usa hoy a mano, emojis incluidos.
 */
export function componerTextoOferta(campos: {
  producte: string;
  productor: string;
  municipi: string;
  ubicacio: string;
  quantitat: string;
  disponible: string;
  horari: string;
  modalitat: string;
  causa: string;
  envasos: string;
  responsable: string;
  observacions: string;
}): string {
  return [
    "📢 *OFERTA DISPONIBLE*",
    "",
    `🌿 PRODUCTE: ${campos.producte}`,
    `👩‍🌾 PRODUCTOR: ${campos.productor}`,
    `📍 MUNICIPI: ${campos.municipi}`,
    `🗺️ UBICACIÓ:`,
    campos.ubicacio,
    `📦 QUANTITAT: ${campos.quantitat}`,
    `📅 DISPONIBLE: ${campos.disponible}`,
    `⏰ HORARI RECOLLIDA: ${campos.horari}`,
    `💰 MODALITAT: ${campos.modalitat}`,
    `🔴 CAUSA: ${campos.causa}`,
    `♻️ ENVASOS: ${campos.envasos}`,
    `👥 RESPONSABLE: ${campos.responsable}`,
    `📝 OBSERVACIONS: ${campos.observacions}`,
  ].join("\n");
}

/** Crea el excedente a partir de una sesión completa y avisa al productor. */
export async function crearExcedenteDesdeSesion(
  supabase: Cliente,
  sesion: SesionCompleta,
  productor: { id: string; name: string },
): Promise<void> {
  const d = sesion.datos_parciales;
  const producto = String(d.producte ?? "");

  // Datos que no se le piden al productor porque ya están en la base.
  const [{ data: prod }, { data: ubicacion }, { data: causa }] = await Promise.all([
    supabase.from("productos").select("eur_kg, familia").eq("nombre", producto).maybeSingle(),
    d.ubicacio
      ? supabase.from("productor_ubicaciones").select("*").eq("id", d.ubicacio).maybeSingle()
      : Promise.resolve({ data: null }),
    d.causa
      ? supabase.from("causas").select("nombre").eq("codigo", d.causa).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: fichaProductor } = await supabase
    .from("productores").select("poblacion, empresa").eq("id", productor.id).maybeSingle();

  const kg = Number(d.kg ?? 0);
  const municipio = ubicacion?.municipio ?? fichaProductor?.poblacion ?? "";
  const idExcedente = await generarId(supabase, productor.name, producto);

  const textoOferta = componerTextoOferta({
    producte: producto,
    productor: fichaProductor?.empresa || productor.name,
    municipi: municipio,
    ubicacio: ubicacion?.gmaps_url ?? "-",
    quantitat: `${kg}kg aprox${d.caixes ? ` · ${d.caixes} caixes` : ""}`,
    disponible: String(d.disponible_fins ?? ""),
    horari: String(d.horari ?? ""),
    modalitat: ETIQUETA_MODALITAT[String(d.modalitat ?? "")] ?? String(d.modalitat ?? ""),
    causa: causa?.nombre ?? String(d.causa ?? ""),
    envasos: String(d.retorn ?? ""),
    // Se asigna en el panel; el productor no lo elige.
    responsable: "",
    observacions: String(d.observacions ?? ""),
  });

  const { error } = await supabase.from("excedentes").insert({
    id_excedente: idExcedente,
    productor_id: productor.id,
    ubicacion_id: d.ubicacio ?? null,
    familia: prod?.familia ?? d.familia ?? null,
    producto,
    variedad: d.varietat ?? null,
    kg_total: kg || null,
    num_caixes: d.caixes ?? null,
    tipo_caixa: d.tipus_caixa ?? null,
    retorn_envasos: d.retorn ?? null,
    modalitat: d.modalitat ?? null,
    causa: causa?.nombre ?? null,
    causa_codigo: d.causa ?? null,
    disponible_hasta: null, // texto libre del productor; se normaliza en el panel
    horari_recollida: d.horari ?? null,
    observacions: d.observacions ?? null,
    valor_eur: kg ? kg * Number(prod?.eur_kg ?? 1) : null,
    texto_oferta: textoOferta,
    estado: "publicada",
  });

  if (error) {
    console.error("excedentes insert:", error.message);
    await sendText(
      supabase, sesion.telefono,
      "Hi ha hagut un problema en registrar l'oferta. Ho revisem i et diem alguna cosa.",
    );
    return;
  }

  await supabase.from("intake_sessions").delete().eq("id", sesion.id);
  await sendText(
    supabase, sesion.telefono,
    `Gràcies! Hem registrat la teva oferta de ${producto} amb la referència ${idExcedente}. ` +
      `T'avisarem quan estigui canalitzada.`,
  );
}
