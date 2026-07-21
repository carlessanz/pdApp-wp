// Importación idempotente de los datos maestros del Excel ARA.
//
//   deno run -A scripts/import-ara.ts            # importa
//   deno run -A scripts/import-ara.ts --dry-run  # solo analiza, no escribe
//
// Lee los CSV de scripts/data/ (fuera de git: contienen datos personales) y
// vuelca las listas maestras, los productores y las entidades receptoras.
// Se puede ejecutar tantas veces como haga falta: actualiza en vez de duplicar.
//
// Variables de entorno necesarias: SUPABASE_URL y SB_SECRET_KEY.

import { parse } from "jsr:@std/csv@1/parse";
import { createClient } from "npm:@supabase/supabase-js@2";

const DATA_DIR = new URL("./data/", import.meta.url);
const DRY_RUN = Deno.args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

/**
 * Extrae todos los móviles españoles de una celda del Excel.
 *
 * El campo es texto libre y trae de todo: espacios entre grupos
 * ("667 805 583"), nombres pegados ("675838766 Rufino"), extensiones
 * ("93 263 91 00 (ext. 9196)") y hasta tres números en la misma celda
 * ("670038564 (Julia) 664755419 (Quim)").
 *
 * Por eso NO se puede quitar todo lo que no sea dígito de golpe: dos números
 * seguidos se fundirían en uno de 18 dígitos. Se buscan secuencias de 9 dígitos
 * tolerando separadores internos.
 *
 * Devuelve E.164 sin '+' (34XXXXXXXXX). El primero va a `phone`, el resto a
 * `telefono_alt`.
 */
export function extraerTelefonos(raw: string | undefined): string[] {
  if (!raw) return [];
  // Fuera los paréntesis con su contenido (nombres y extensiones).
  let s = raw.replace(/\([^)]*\)/g, " ");
  s = s.replace(/ext\.?\s*\d+/gi, " ");

  const out: string[] = [];
  for (const m of s.matchAll(/(?:\d[\s.\-]*){9,}/g)) {
    let d = m[0].replace(/\D/g, "");
    // Una misma coincidencia puede contener varios números encadenados.
    while (d.length >= 9) {
      if (d.startsWith("34") && d.length >= 11) {
        out.push(d.slice(0, 11));
        d = d.slice(11);
      } else if (/^[6789]/.test(d)) {
        out.push("34" + d.slice(0, 9));
        d = d.slice(9);
      } else {
        d = d.slice(1);
      }
    }
  }
  return [...new Set(out)];
}

/** Erratas de familia detectadas en productos.csv, contra la lista maestra. */
const FAMILIAS_CORREGIDAS: Record<string, string> = {
  "fruita seca": "Fruita Seca",
  "fruit vermell": "Fruita Vermella",
  "hort tub/bul/arr": "Horta Tub/Bul/Arr",
};

function normalizarFamilia(f: string): string {
  return FAMILIAS_CORREGIDAS[f.trim().toLowerCase()] ?? f.trim();
}

/**
 * Los campos de capacidad de sda.csv son texto libre ("SI", "no",
 * "Si (Punt solidari)", "1 furgo", "Transpalet"). Se deriva el boolean solo
 * cuando el texto es concluyente; en el resto queda null y se conserva el
 * original en la columna _txt.
 */
function derivarBoolean(txt: string): boolean | null {
  const t = txt.trim().toLowerCase();
  if (!t) return null;
  if (/\bs[ií]\b/.test(t)) return true;
  if (t.startsWith("no")) return false;
  return null;
}

/** "2022-05-03 00:00:00" -> "2022-05-03". Un año suelto ("2022") no es fecha. */
function parsearFecha(v: string): string | null {
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function parsearNumero(v: string): number | null {
  const n = Number(v.trim().replace(",", "."));
  return v.trim() && Number.isFinite(n) ? n : null;
}

const limpio = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function leerCsv(nombre: string): Promise<string[][]> {
  const texto = await Deno.readTextFile(new URL(nombre, DATA_DIR));
  const filas = parse(texto) as string[][];
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

interface Resumen {
  tabla: string;
  altas: number;
  actualizadas: number;
  descartadas: number;
}
const resumenes: Resumen[] = [];
const avisos: string[] = [];

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!DRY_RUN && (!url || !key)) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}
const supabase = DRY_RUN ? null : createClient(url!, key!);

// deno-lint-ignore no-explicit-any
async function upsert(tabla: string, filas: any[], onConflict: string) {
  if (DRY_RUN || filas.length === 0) return;
  const { error } = await supabase!.from(tabla).upsert(filas, { onConflict });
  if (error) {
    console.error(`  ✗ ${tabla}: ${error.message}`);
    Deno.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. causas.csv  ->  causas
// ---------------------------------------------------------------------------
async function importarCausas() {
  const [, ...filas] = await leerCsv("causas.csv");
  const rows = filas.map((f) => ({ codigo: f[0].trim(), nombre: f[1].trim() }));
  await upsert("causas", rows, "codigo");
  resumenes.push({ tabla: "causas", altas: rows.length, actualizadas: 0, descartadas: 0 });
}

// ---------------------------------------------------------------------------
// 2. productos.csv  ->  productos
// ---------------------------------------------------------------------------
async function importarProductos() {
  const [, ...filas] = await leerCsv("productos.csv");
  const porNombre = new Map<string, { nombre: string; familia: string; eur_kg: number }>();
  let duplicados = 0;
  for (const f of filas) {
    const nombre = f[0].trim();
    if (porNombre.has(nombre)) duplicados++;
    porNombre.set(nombre, {
      nombre,
      familia: normalizarFamilia(f[1] ?? ""),
      eur_kg: parsearNumero(f[2] ?? "") ?? 1,
    });
  }
  if (duplicados) avisos.push(`productos: ${duplicados} duplicado(s) fusionado(s) por nombre`);
  const rows = [...porNombre.values()];
  await upsert("productos", rows, "nombre");
  resumenes.push({
    tabla: "productos",
    altas: rows.length,
    actualizadas: 0,
    descartadas: duplicados,
  });
}

// ---------------------------------------------------------------------------
// 3. factores_conversion.csv  ->  factores_conversion
// ---------------------------------------------------------------------------
async function importarFactores() {
  const [, ...filas] = await leerCsv("factores_conversion.csv");
  const rows = filas.map((f) => ({
    producto: f[0].trim(),
    kg_por_unidad: parsearNumero(f[1] ?? ""),
  }));
  await upsert("factores_conversion", rows, "producto");
  resumenes.push({
    tabla: "factores_conversion",
    altas: rows.length,
    actualizadas: 0,
    descartadas: 0,
  });
}

// ---------------------------------------------------------------------------
// 4. sda.csv  ->  entidades   (clave natural: nombre)
// ---------------------------------------------------------------------------
async function importarEntidades() {
  const [, ...filas] = await leerCsv("sda.csv");

  // `entidades.nombre` no tiene constraint único, así que el upsert por
  // conflicto no sirve: se resuelve con lookup previo.
  const existentes = new Map<string, string>();
  if (!DRY_RUN) {
    const { data, error } = await supabase!.from("entidades").select("id, nombre");
    if (error) throw new Error(`entidades select: ${error.message}`);
    for (const e of data ?? []) existentes.set(e.nombre, e.id);
  }

  let altas = 0, actualizadas = 0, descartadas = 0;
  for (const f of filas) {
    const nombre = (f[1] ?? "").trim();
    if (!nombre) {
      descartadas++;
      continue;
    }
    const fila = {
      nombre,
      data_alta: limpio(f[0]),
      familia: limpio(f[2]),
      prioritat: parsearNumero(f[3] ?? ""),
      codigo: limpio(f[4]),
      estat: limpio(f[5]),
      comentarios: limpio(f[6]),
      gestio: limpio(f[7]),
      area_geografica: limpio(f[8]),
      poblacion: limpio(f[9]),
      direccion: limpio(f[10]),
      codigo_postal: limpio(f[11]),
      horario: limpio(f[12]),
      nif: limpio(f[13]),
      telefono: extraerTelefonos(f[14])[0] ?? null,
      contacto: limpio(f[15]),
      telefono2: extraerTelefonos(f[16])[0] ?? null,
      email: limpio(f[17]),
      contacto2: limpio(f[18]),
      telefono3: extraerTelefonos(f[19])[0] ?? null,
      email2: limpio(f[20]),
      calendari_repartiment: limpio(f[21]),
      productes_frescos: derivarBoolean(f[22] ?? ""),
      productes_frescos_txt: limpio(f[22]),
      transport_plataforma: derivarBoolean(f[23] ?? ""),
      transport_plataforma_txt: limpio(f[23]),
      descarrega_toro: derivarBoolean(f[24] ?? ""),
      descarrega_toro_txt: limpio(f[24]),
    };

    const id = existentes.get(nombre);
    if (DRY_RUN) {
      altas++;
    } else if (id) {
      const { error } = await supabase!.from("entidades").update(fila).eq("id", id);
      if (error) throw new Error(`entidades update ${nombre}: ${error.message}`);
      actualizadas++;
    } else {
      const { error } = await supabase!.from("entidades").insert(fila);
      if (error) throw new Error(`entidades insert ${nombre}: ${error.message}`);
      altas++;
    }
  }
  resumenes.push({ tabla: "entidades", altas, actualizadas, descartadas });
}

// ---------------------------------------------------------------------------
// 5. prod_actius.csv  ->  productores  (+ productor_ubicaciones)
//
// OJO: la cabecera de este CSV está DESPLAZADA respecto a los datos (la primera
// columna real es una fecha de alta que no figura en la cabecera). Se importa
// por POSICIÓN, ignorando la cabecera. Mapeo verificado columna a columna:
//   [0] data_alta       [1] name        [2] empresa      [3] codigo
//   [4] comentario      [5] visitado    [6] conveni      [7] tipo_empresa
//   [8] phone           [9] email       [10] direccion   [11] codigo_postal
//   [12] nif            [13] area_geo   [14] poblacion   [15] lat  [16] lng
// ---------------------------------------------------------------------------
async function importarProductores() {
  const [, ...filas] = await leerCsv("prod_actius.csv");

  // El Excel tiene códigos repetidos que apuntan a productores DISTINTOS
  // (p. ej. CN038 = "Institut les Salines" y también "Pasion"). Usarlos como
  // clave fusionaría fichas y perdería productores, así que para esos códigos
  // se cae a (name + poblacion).
  const vecesPorCodigo = new Map<string, number>();
  for (const f of filas) {
    const c = (f[3] ?? "").trim();
    if (c) vecesPorCodigo.set(c, (vecesPorCodigo.get(c) ?? 0) + 1);
  }
  const codigosAmbiguos = new Set(
    [...vecesPorCodigo].filter(([, n]) => n > 1).map(([c]) => c),
  );
  if (codigosAmbiguos.size) {
    avisos.push(
      `productores: ${codigosAmbiguos.size} código(s) duplicado(s) en el Excel ` +
        `(${[...codigosAmbiguos].join(", ")}); se usa nombre+población como clave`,
    );
  }

  // Emails repetidos: la columna es UNIQUE, así que solo el primero lo conserva.
  const vecesPorEmail = new Map<string, number>();
  for (const f of filas) {
    const e = (f[9] ?? "").trim().toLowerCase();
    if (e) vecesPorEmail.set(e, (vecesPorEmail.get(e) ?? 0) + 1);
  }

  const existentes = new Map<string, string>();
  if (!DRY_RUN) {
    const { data, error } = await supabase!
      .from("productores")
      .select("id, codigo, name, poblacion");
    if (error) throw new Error(`productores select: ${error.message}`);
    for (const p of data ?? []) {
      if (p.codigo && !codigosAmbiguos.has(p.codigo)) existentes.set(`c:${p.codigo}`, p.id);
      existentes.set(`n:${p.name}|${p.poblacion ?? ""}`, p.id);
    }
  }

  const telefonosUsados = new Set<string>();
  const emailsUsados = new Set<string>();
  // Los fijos (prefijo 8/9) se importan igual, pero no reciben WhatsApp:
  // conviene saber cuántos son para no contarlos como productores alcanzables.
  let fijos = 0;
  const ubicaciones: Array<{ clave: string; lat: number; lng: number; municipio: string | null }> = [];
  let altas = 0, actualizadas = 0, descartadas = 0;
  let sinTelefono = 0, colisiones = 0;

  for (const f of filas) {
    const name = (f[1] ?? "").trim() || (f[2] ?? "").trim();
    if (!name) {
      descartadas++;
      continue;
    }
    const codigo = limpio(f[3]);
    const poblacion = limpio(f[14]);

    // Teléfono: el primero al campo principal, el resto quedan anotados.
    const tels = extraerTelefonos(f[8]);
    let phone: string | null = null;
    for (const t of tels) {
      if (!telefonosUsados.has(t)) {
        phone = t;
        telefonosUsados.add(t);
        break;
      }
    }
    if (tels.length > 0 && phone === null) {
      colisiones++;
      avisos.push(`productores: "${name}" comparte teléfono ${tels[0]} con otra ficha (phone=null)`);
    }
    if (tels.length === 0) sinTelefono++;
    if (phone && !/^34[67]/.test(phone)) fijos++;
    const resto = tels.filter((t) => t !== phone);

    // Email es UNIQUE: los repetidos y los vacíos van a null.
    const emailRaw = (f[9] ?? "").trim().toLowerCase();
    let email: string | null = null;
    if (emailRaw && (vecesPorEmail.get(emailRaw) ?? 0) === 1 && !emailsUsados.has(emailRaw)) {
      email = (f[9] ?? "").trim();
      emailsUsados.add(emailRaw);
    }

    // Los teléfonos sobrantes se anotan aparte. Si no se pudo extraer ninguno
    // pero la celda tenía texto ("Josep Biosca (alcalde) i Mariona Solà"), se
    // conserva en crudo: es información de contacto que no queremos perder.
    const telefonoAlt = resto.length > 0
      ? resto.join(" / ")
      : (phone === null ? limpio(f[8]) : null);

    const fila = {
      name,
      email,
      phone,
      telefono_alt: telefonoAlt,
      data_alta: parsearFecha(f[0] ?? ""),
      empresa: limpio(f[2]),
      codigo,
      comentario: limpio(f[4]),
      visitado: limpio(f[5]),
      conveni: limpio(f[6]),
      tipo_empresa: limpio(f[7]),
      direccion: limpio(f[10]),
      codigo_postal: limpio(f[11]),
      nif: limpio(f[12]),
      area_geografica: limpio(f[13]),
      poblacion,
      // La columna "Producte" no existe en este export del Excel.
      // TODO: reimportar cuando se reexporte con la columna incluida.
      productos_habituales: null,
      activo: true,
    };

    const clave = codigo && !codigosAmbiguos.has(codigo)
      ? `c:${codigo}`
      : `n:${name}|${poblacion ?? ""}`;

    let id = existentes.get(clave);
    if (DRY_RUN) {
      altas++;
    } else if (id) {
      const { error } = await supabase!.from("productores").update(fila).eq("id", id);
      if (error) throw new Error(`productores update ${name}: ${error.message}`);
      actualizadas++;
    } else {
      const { data, error } = await supabase!
        .from("productores")
        .insert(fila)
        .select("id")
        .single();
      if (error) throw new Error(`productores insert ${name}: ${error.message}`);
      id = data.id;
      existentes.set(clave, id!);
      altas++;
    }

    // Ubicación principal, solo si ambas coordenadas son numéricas.
    const lat = parsearNumero(f[15] ?? "");
    const lng = parsearNumero(f[16] ?? "");
    if (lat !== null && lng !== null) {
      ubicaciones.push({ clave: id ?? clave, lat, lng, municipio: poblacion });
    }
  }

  resumenes.push({ tabla: "productores", altas, actualizadas, descartadas });
  avisos.push(`productores: ${sinTelefono} sin teléfono utilizable (no podrán usar el intake)`);
  if (fijos) {
    avisos.push(
      `productores: ${fijos} con teléfono FIJO (8/9), que no recibe WhatsApp; ` +
        `tampoco podrán usar el intake`,
    );
  }
  if (colisiones) avisos.push(`productores: ${colisiones} colisión(es) de teléfono`);

  // Ubicaciones principales
  let ubiAltas = 0;
  if (!DRY_RUN) {
    for (const u of ubicaciones) {
      const { data: ya } = await supabase!
        .from("productor_ubicaciones")
        .select("id")
        .eq("productor_id", u.clave)
        .eq("es_principal", true)
        .maybeSingle();
      const fila = {
        productor_id: u.clave,
        alias: "Principal",
        coord_lat: u.lat,
        coord_lng: u.lng,
        municipio: u.municipio,
        es_principal: true,
      };
      if (ya) {
        await supabase!.from("productor_ubicaciones").update(fila).eq("id", ya.id);
      } else {
        await supabase!.from("productor_ubicaciones").insert(fila);
        ubiAltas++;
      }
    }
  } else {
    ubiAltas = ubicaciones.length;
  }
  resumenes.push({
    tabla: "productor_ubicaciones",
    altas: ubiAltas,
    actualizadas: 0,
    descartadas: 0,
  });
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------
if (DRY_RUN) console.log("MODO DRY-RUN: no se escribe nada en la base de datos.\n");

await importarCausas();
await importarProductos();
await importarFactores();
await importarEntidades();
await importarProductores();

console.log("\nResumen de la importación");
console.table(resumenes);
if (avisos.length) {
  console.log("Avisos:");
  for (const a of avisos) console.log(`  · ${a}`);
}
