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
 * Convierte la respuesta libre del productor a "Fins quin dia està disponible?"
 * en una fecha ISO (YYYY-MM-DD) para `excedentes.disponible_hasta`. Reconoce
 * dd/mm y dd/mm/aaaa con separadores `/`, `-` o `.` (p. ej. "23/07", "23-7",
 * "23.07.2026"). Sin año usa el actual; si esa fecha ya pasó, salta al siguiente.
 * Devuelve null si no reconoce una fecha (el panel la normaliza a mano, como
 * hasta ahora, y el texto de la oferta ya muestra el original).
 */
export function parseDisponibleFins(texto: string): string | null {
  const m = texto.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  const hoy = new Date();
  let anio = m[3] ? Number(m[3]) : hoy.getFullYear();
  if (anio < 100) anio += 2000; // "26" → 2026
  // Sin año explícito y con la fecha ya pasada, se entiende el año siguiente.
  if (!m[3]) {
    const finAny = new Date(anio, mes - 1, dia);
    const hoySolo = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    if (finAny < hoySolo) anio += 1;
  }
  // Rechaza fechas inexistentes (31/02, 30/02…).
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
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
  preu?: string;
  causa: string;
  envasos: string;
  responsable: string;
  observacions: string;
}): string {
  const lineas = [
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
  ];
  // Preu mínim solo en venda/maquila (el productor lo fija en l'intake).
  if (campos.preu) lineas.push(`💶 PREU MÍNIM: ${campos.preu}`);
  lineas.push(
    `🔴 CAUSA: ${campos.causa}`,
    `♻️ ENVASOS: ${campos.envasos}`,
    `👥 RESPONSABLE: ${campos.responsable}`,
    `📝 OBSERVACIONS: ${campos.observacions}`,
    "",
    "✅ Per acceptar aquesta oferta respon *SÍ* (o *NO* per descartar-la).",
  );
  return lineas.join("\n");
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
  const preuMinim = d.preu_minim != null ? Number(d.preu_minim) : null;
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
    preu: preuMinim != null ? `${preuMinim} €/kg` : undefined,
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
    preu_minim: preuMinim,
    causa: causa?.nombre ?? null,
    causa_codigo: d.causa ?? null,
    // Se intenta parsear la respuesta libre ("23/07"); si no es una fecha
    // reconocible queda null y el panel la normaliza a mano.
    disponible_hasta: parseDisponibleFins(String(d.disponible_fins ?? "")),
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
