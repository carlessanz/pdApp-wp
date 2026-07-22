// Motor del intake conversacional de POMA.
//
// Un productor escribe al número de POMA y, paso a paso, compone una oferta de
// excedente. El estado vive en `intake_sessions` (una fila por teléfono), de modo
// que cada mensaje entrante se interpreta según el paso en curso.
//
// Todo ocurre dentro de la ventana de servicio de 24 h —la abre el propio
// productor al escribir—, así que no hacen falta plantillas ni opt-in.
//
// Vive fuera de `whatsapp-webhook/index.ts` a propósito: son trece pasos con
// paginación, reintentos y caducidad, y embutirlos en el bucle del webhook lo
// haría inmanejable.

import { sendBotones, sendLista, sendText } from "./whatsapp.ts";
import type { FilaLista } from "./whatsapp.ts";
import { crearExcedenteDesdeSesion } from "./oferta.ts";

// Una sesión sin actividad se da por abandonada y se empieza de cero.
const CADUCIDAD_HORAS = 12;
// Tras dos respuestas que no encajan, se ofrece cancelar en vez de insistir.
const MAX_INTENTOS = 2;
// Se dejan 9 opciones visibles y la décima fila es "Més…".
const OPCIONES_POR_PAGINA = 9;

const TIPOS_CAIXA = [
  "Rígida FE",
  "Plegable FE",
  "Palot",
  "Retornable",
  "Productor/a",
  "No retorn",
];

// Orden de los pasos. `familia` solo sirve para acotar `producte`.
const PASOS = [
  "familia",
  "producte",
  "varietat",
  "kg",
  "caixes",
  "tipus_caixa",
  "retorn",
  "ubicacio",
  "disponible_fins",
  "horari",
  "modalitat",
  "causa",
  "observacions",
] as const;
type Paso = typeof PASOS[number];

interface Sesion {
  id: string;
  telefono: string;
  productor_id: string | null;
  paso_actual: string | null;
  datos_parciales: Record<string, unknown>;
  updated_at: string;
}

// deno-lint-ignore no-explicit-any
type Cliente = any;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Extrae lo que ha respondido el usuario, sea texto o pulsación interactiva. */
export function leerRespuesta(
  // deno-lint-ignore no-explicit-any
  message: any,
): { texto: string | null; id: string | null } {
  if (message?.type === "interactive") {
    const i = message.interactive ?? {};
    const r = i.button_reply ?? i.list_reply;
    return { texto: r?.title ?? null, id: r?.id ?? null };
  }
  return { texto: message?.text?.body ?? null, id: null };
}

export function esCancelar(texto: string | null): boolean {
  const t = (texto ?? "").trim().toUpperCase().replace("·", "");
  return t === "CANCELLAR" || t === "CANCELAR";
}

function siguientePaso(paso: Paso): Paso | null {
  const i = PASOS.indexOf(paso);
  return i >= 0 && i < PASOS.length - 1 ? PASOS[i + 1] : null;
}

/** Trocea las opciones en páginas de 9 y añade "Més…" cuando queda resto. */
export function paginar(
  opciones: FilaLista[],
  pagina: number,
  prefijoMas: string,
): FilaLista[] {
  const inicio = pagina * OPCIONES_POR_PAGINA;
  const trozo = opciones.slice(inicio, inicio + OPCIONES_POR_PAGINA);
  if (inicio + OPCIONES_POR_PAGINA < opciones.length) {
    trozo.push({ id: `${prefijoMas}:mes`, titulo: "Més…" });
  }
  return trozo;
}

async function guardar(
  supabase: Cliente,
  sesion: Sesion,
  cambios: Partial<Sesion> & { datos_parciales?: Record<string, unknown> },
): Promise<void> {
  // Cada actividad reinicia el reloj del recordatorio: se reenviará 10 min
  // después de la última interacción, no de la creación de la sesión.
  const { error } = await supabase
    .from("intake_sessions")
    .update({ ...cambios, updated_at: new Date().toISOString(), recordatorio_enviado_at: null })
    .eq("id", sesion.id);
  if (error) console.error("intake_sessions update:", error.message);
}

// ---------------------------------------------------------------------------
// Preguntas
// ---------------------------------------------------------------------------

async function preguntar(
  supabase: Cliente,
  sesion: Sesion,
  paso: Paso,
  pagina = 0,
): Promise<void> {
  const to = sesion.telefono;
  const datos = sesion.datos_parciales ?? {};

  switch (paso) {
    case "familia": {
      const { data } = await supabase.from("productos").select("familia");
      const familias = [...new Set((data ?? []).map((p: { familia: string }) => p.familia))]
        .filter(Boolean).sort() as string[];
      await sendLista(
        supabase, to,
        "De quina família és el producte?",
        "Tria família",
        paginar(familias.map((f) => ({ id: `familia:${f}`, titulo: f })), pagina, "familia"),
      );
      return;
    }
    case "producte": {
      const { data } = await supabase
        .from("productos").select("nombre").eq("familia", datos.familia).order("nombre");
      const productos = (data ?? []).map((p: { nombre: string }) => p.nombre) as string[];
      await sendLista(
        supabase, to,
        `Quin producte de ${datos.familia}?`,
        "Tria producte",
        paginar(productos.map((n) => ({ id: `producte:${n}`, titulo: n })), pagina, "producte"),
      );
      return;
    }
    case "varietat":
      await sendText(supabase, to, "Quina varietat és? (escriu '-' si no aplica)");
      return;
    case "kg":
      await sendText(
        supabase, to,
        "Quants kg aproximadament? Si ho tens en unitats o manats, digue-ho i ho convertim.",
      );
      return;
    case "caixes":
      await sendText(supabase, to, "Quantes caixes són? (escriu '-' si no ho saps)");
      return;
    case "tipus_caixa":
      await sendLista(
        supabase, to, "Quin tipus de caixa?", "Tria tipus",
        TIPOS_CAIXA.map((t) => ({ id: `tipus_caixa:${t}`, titulo: t })),
      );
      return;
    case "retorn":
      await sendBotones(supabase, to, "Cal retornar els envasos?", [
        { id: "retorn:Sí", titulo: "Sí" },
        { id: "retorn:No", titulo: "No" },
        { id: "retorn:Caixes pròpies", titulo: "Caixes pròpies" },
      ]);
      return;
    case "ubicacio": {
      const { data } = await supabase
        .from("productor_ubicaciones")
        .select("id, alias, municipio")
        .eq("productor_id", sesion.productor_id);
      const ubis = (data ?? []) as Array<{ id: string; alias: string; municipio: string }>;
      // Con cero ubicaciones no se puede enviar una lista vacía: Meta la rechaza.
      if (ubis.length === 0) {
        await sendText(
          supabase, to,
          "On es recull? Comparteix un punt de Google Maps (enganxa l'enllaç).",
        );
        return;
      }
      const filas: FilaLista[] = ubis.map((u) => ({
        id: `ubicacio:${u.id}`,
        titulo: u.alias ?? u.municipio ?? "Ubicació",
        descripcion: u.municipio ?? undefined,
      }));
      filas.push({ id: "ubicacio:nova", titulo: "Comparteix un punt" });
      await sendLista(supabase, to, "On es recull?", "Tria ubicació", filas);
      return;
    }
    case "disponible_fins":
      await sendText(supabase, to, "Fins quin dia està disponible? (per exemple 23/07)");
      return;
    case "horari":
      await sendText(supabase, to, "Quin horari de recollida va bé? (matí, tarda, hores…)");
      return;
    case "modalitat":
      await sendBotones(supabase, to, "Quina modalitat és?", [
        { id: "modalitat:donacio", titulo: "Donació" },
        { id: "modalitat:venda", titulo: "Venda" },
        { id: "modalitat:maquila", titulo: "Maquila" },
      ]);
      return;
    case "causa": {
      const { data } = await supabase.from("causas").select("codigo, nombre").order("nombre");
      const causas = (data ?? []) as Array<{ codigo: string; nombre: string }>;
      await sendLista(
        supabase, to, "Quina és la causa de l'excedent?", "Tria causa",
        paginar(
          causas.map((c) => ({ id: `causa:${c.codigo}`, titulo: c.nombre, descripcion: c.codigo })),
          pagina, "causa",
        ),
      );
      return;
    }
    case "observacions":
      await sendText(supabase, to, "Alguna observació? (escriu '-' si no n'hi ha)");
      return;
  }
}

// ---------------------------------------------------------------------------
// Interpretación de respuestas
// ---------------------------------------------------------------------------

/** Devuelve el valor validado, o null si la respuesta no encaja con el paso. */
async function interpretar(
  supabase: Cliente,
  sesion: Sesion,
  paso: Paso,
  texto: string | null,
  id: string | null,
): Promise<unknown | null> {
  // Los pasos con opciones exigen pulsación: el id lleva el valor.
  const conOpciones: Paso[] = [
    "familia", "producte", "tipus_caixa", "retorn", "modalitat", "causa",
  ];
  if (conOpciones.includes(paso)) {
    if (!id?.startsWith(`${paso}:`)) return null;
    return id.slice(paso.length + 1);
  }

  const t = (texto ?? "").trim();

  switch (paso) {
    case "kg": {
      // Acepta "150", "150-200", "20 manats"… Se queda con el primer número y,
      // si menciona unidades o manats, aplica el factor de conversión.
      const num = t.match(/\d+([.,]\d+)?/);
      if (!num) return null;
      let kg = Number(num[0].replace(",", "."));
      if (/unitat|manat|u\b/i.test(t)) {
        const { data } = await supabase
          .from("factores_conversion").select("producto, kg_por_unidad");
        const producto = String(sesion.datos_parciales.producte ?? "").toUpperCase();
        const factor = (data ?? []).find((f: { producto: string }) =>
          f.producto.toUpperCase().startsWith(producto.slice(0, 4))
        );
        if (factor?.kg_por_unidad) kg = kg * Number(factor.kg_por_unidad);
      }
      return kg;
    }
    case "caixes":
      if (t === "-") return null_ok();
      return t.match(/\d+/) ? Number(t.match(/\d+/)![0]) : null;
    case "ubicacio": {
      if (id?.startsWith("ubicacio:") && id !== "ubicacio:nova") {
        return id.slice("ubicacio:".length);
      }
      // Un enlace de Google Maps crea una ubicación nueva para el productor.
      const enlace = t.match(/https?:\/\/\S*(maps\.app\.goo\.gl|google\.[a-z.]+\/maps)\S*/i);
      if (!enlace) return null;
      const { data: ficha } = await supabase
        .from("productores").select("poblacion").eq("id", sesion.productor_id).maybeSingle();
      const { data, error } = await supabase
        .from("productor_ubicaciones")
        .insert({
          productor_id: sesion.productor_id,
          alias: "Compartida per WhatsApp",
          gmaps_url: enlace[0],
          municipio: ficha?.poblacion ?? null,
        })
        .select("id").single();
      if (error) {
        console.error("productor_ubicaciones insert:", error.message);
        return null;
      }
      return data.id;
    }
    case "varietat":
    case "observacions":
      return t === "" ? null : (t === "-" ? null_ok() : t);
    default:
      return t === "" ? null : t;
  }
}

// Distingue "respondió válidamente que no aplica" de "no entendí la respuesta".
const OMITIDO = Symbol("omitido");
function null_ok(): unknown {
  return OMITIDO;
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/**
 * Procesa un mensaje entrante dentro del flujo de intake.
 * Devuelve true si lo ha gestionado (y el webhook no debe hacer nada más).
 */
export async function procesarIntake(
  supabase: Cliente,
  from: string,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<boolean> {
  // Solo se atiende a productores dados de alta.
  const { data: productor } = await supabase
    .from("productores").select("id, name").eq("phone", from).maybeSingle();
  if (!productor) return false;

  const { texto, id } = leerRespuesta(message);

  const { data: sesiones } = await supabase
    .from("intake_sessions").select("*").eq("telefono", from)
    .order("updated_at", { ascending: false }).limit(1);
  let sesion: Sesion | null = (sesiones ?? [])[0] ?? null;

  // Sesión olvidada: se descarta y se empieza como si no hubiera nada.
  if (sesion && Date.now() - new Date(sesion.updated_at).getTime() > CADUCIDAD_HORAS * 3600_000) {
    await supabase.from("intake_sessions").delete().eq("id", sesion.id);
    sesion = null;
  }

  // Cancelar en cualquier momento: por palabra clave o por el botón del recordatorio.
  if (esCancelar(texto) || id === "intake:cancelar") {
    if (sesion) await supabase.from("intake_sessions").delete().eq("id", sesion.id);
    await sendText(supabase, from, "D'acord, ho hem cancel·lat. Escriu quan vulguis. 👋");
    return true;
  }

  // Botón "Continuar" del recordatorio: se reanuda el paso donde se dejó.
  if (id === "intake:continuar" && sesion) {
    const datos = { ...(sesion.datos_parciales ?? {}) };
    datos._intentos = 0;
    await guardar(supabase, sesion, { datos_parciales: datos });
    const pasoActual = (sesion.paso_actual ?? "familia") as Paso;
    await preguntar(supabase, { ...sesion, datos_parciales: datos }, pasoActual);
    return true;
  }

  // Sin sesión: se pregunta antes de arrancar, para no secuestrar con un
  // formulario a quien solo quería comentar algo.
  if (!sesion) {
    if (id === "intake:no") {
      await sendText(supabase, from, "Cap problema. Si més tard tens excedent, escriu-nos.");
      return true;
    }
    if (id === "intake:si") {
      const { data, error } = await supabase
        .from("intake_sessions")
        .insert({
          telefono: from,
          productor_id: productor.id,
          paso_actual: "familia",
          datos_parciales: {},
        })
        .select("*").single();
      if (error) {
        console.error("intake_sessions insert:", error.message);
        return true;
      }
      await preguntar(supabase, data as Sesion, "familia");
      return true;
    }
    await sendBotones(
      supabase, from,
      `Hola ${productor.name}! 👋 Sóc l'assistent d'excedents d'Espigoladors.\n\n` +
        "T'ajudo a publicar un excedent en un moment: et faré unes preguntes senzilles " +
        "(producte, quantitat, ubicació…) i crearé l'oferta automàticament. 🥬📦\n\n" +
        "✍️ Escriu *CANCEL·LAR* quan vulguis per aturar el procés.\n\n" +
        "Vols oferir un excedent ara?",
      [
        { id: "intake:si", titulo: "Sí" },
        { id: "intake:no", titulo: "Ara no" },
      ],
    );
    return true;
  }

  const paso = (sesion.paso_actual ?? "familia") as Paso;
  const datos = { ...(sesion.datos_parciales ?? {}) };

  // "Més…": misma pregunta, página siguiente.
  if (id === `${paso}:mes`) {
    const pagina = Number(datos[`_pagina_${paso}`] ?? 0) + 1;
    datos[`_pagina_${paso}`] = pagina;
    await guardar(supabase, sesion, { datos_parciales: datos });
    await preguntar(supabase, { ...sesion, datos_parciales: datos }, paso, pagina);
    return true;
  }

  const valor = await interpretar(supabase, sesion, paso, texto, id);

  if (valor === null) {
    const intentos = Number(datos._intentos ?? 0) + 1;
    datos._intentos = intentos;
    await guardar(supabase, sesion, { datos_parciales: datos });
    if (intentos > MAX_INTENTOS) {
      await sendText(
        supabase, from,
        "No acabo d'entendre la resposta. Escriu CANCEL·LAR per començar de nou.",
      );
    } else {
      await preguntar(supabase, { ...sesion, datos_parciales: datos }, paso);
    }
    return true;
  }

  datos[paso] = valor === OMITIDO ? null : valor;
  datos._intentos = 0;

  const siguiente = siguientePaso(paso);
  if (siguiente) {
    await guardar(supabase, sesion, { paso_actual: siguiente, datos_parciales: datos });
    await preguntar(supabase, { ...sesion, datos_parciales: datos }, siguiente);
    return true;
  }

  // Último paso contestado: se crea la oferta.
  await guardar(supabase, sesion, { datos_parciales: datos });
  await crearExcedenteDesdeSesion(supabase, { ...sesion, datos_parciales: datos }, productor);
  return true;
}
