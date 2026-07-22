// Priorización de entidades receptoras para un excedente.
//
// Función pura y sin dependencias de red: recibe el excedente y las entidades ya
// cargadas, y devuelve el ranking. Así se puede probar aislada.

// --- Pesos (documentados y en un solo sitio para poder ajustarlos) ----------
const PESO_MISMA_AREA = 3;
const PESO_MISMA_POBLACION = 2; // adicional, encima de la misma área
const PESO_TRANSPORT = 1;
const PESO_TORO = 1;
const PESO_FRESCOS = 2;
const UMBRAL_KG_GRANDE = 500; // por encima, la capacidad de transporte pesa doble
const PRIORITAT_MAX = 3; // prioritat 1 es la más alta; suma (3 - prioritat)

// La única familia que NO se considera fresca.
const FAMILIA_NO_FRESCA = "Varis";

// `estat`: qué se considera activo, qué va al final y qué se excluye.
const ESTAT_ACTIVO = "signat";
const ESTATS_EXCLUIDOS = ["no procedeix", ""]; // + cualquiera vacío/nulo

export interface EntidadPriorizable {
  id: string;
  nombre: string;
  poblacion: string | null;
  telefono: string | null;
  opt_in: boolean | null;
  area_geografica: string | null;
  estat: string | null;
  prioritat: number | null;
  productes_frescos: boolean | null;
  transport_plataforma: boolean | null;
  descarrega_toro: boolean | null;
}

export interface ExcedenteContexto {
  familia: string | null;
  area_geografica: string | null; // del excedente/ubicación
  poblacion: string | null;
  kg_total: number | null;
}

export interface EntidadPuntuada {
  id: string;
  nombre: string;
  poblacion: string | null;
  telefono: string | null;
  opt_in: boolean;
  puntuacion: number;
  motivos: string[];
  /** Estat pendiente: candidata pero avisada, va al final del ranking. */
  pendiente: boolean;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Puntúa una entidad frente a un excedente. Devuelve null si se excluye. */
export function puntuarEntidad(
  entidad: EntidadPriorizable,
  excedente: ExcedenteContexto,
): EntidadPuntuada | null {
  const estat = norm(entidad.estat);
  // Excluidas: sin estado o "No procedeix" no entran en el ranking.
  if (ESTATS_EXCLUIDOS.includes(estat)) return null;

  const activo = estat === ESTAT_ACTIVO;
  const pendiente = !activo; // cualquier "Pendent*" que no sea Signat

  let puntuacion = 0;
  const motivos: string[] = [];

  // Proximidad
  const mismaArea = norm(entidad.area_geografica) === norm(excedente.area_geografica) &&
    norm(excedente.area_geografica) !== "";
  if (mismaArea) {
    puntuacion += PESO_MISMA_AREA;
    motivos.push(`Mateixa àrea (${entidad.area_geografica})`);
    if (norm(entidad.poblacion) === norm(excedente.poblacion) && norm(excedente.poblacion) !== "") {
      puntuacion += PESO_MISMA_POBLACION;
      motivos.push(`Mateix municipi (${entidad.poblacion})`);
    }
  }

  // Capacidad, con peso doble para excedentes grandes
  const factorKg = (excedente.kg_total ?? 0) > UMBRAL_KG_GRANDE ? 2 : 1;
  if (entidad.transport_plataforma) {
    puntuacion += PESO_TRANSPORT * factorKg;
    motivos.push(factorKg > 1 ? "Transport amb plataforma (excedent gran)" : "Transport amb plataforma");
  }
  if (entidad.descarrega_toro) {
    puntuacion += PESO_TORO * factorKg;
    motivos.push(factorKg > 1 ? "Descàrrega amb toro (excedent gran)" : "Descàrrega amb toro");
  }

  // Tipo: producto fresco y entidad que acepta frescos
  const esFresco = norm(excedente.familia) !== norm(FAMILIA_NO_FRESCA);
  if (esFresco && entidad.productes_frescos) {
    puntuacion += PESO_FRESCOS;
    motivos.push("Accepta productes frescos");
  }

  // Prioritat (1 = más alta)
  if (entidad.prioritat != null) {
    const p = Math.max(0, PRIORITAT_MAX - entidad.prioritat);
    if (p > 0) {
      puntuacion += p;
      motivos.push(`Prioritat ${entidad.prioritat}`);
    }
  }

  if (pendiente) motivos.push("⚠️ Conveni pendent");
  if (!entidad.opt_in) motivos.push("Sense opt-in: no es pot enviar per API");

  return {
    id: entidad.id,
    nombre: entidad.nombre,
    poblacion: entidad.poblacion,
    telefono: entidad.telefono,
    opt_in: entidad.opt_in ?? false,
    puntuacion,
    motivos,
    pendiente,
  };
}

/**
 * Ordena las entidades candidatas: primero las activas por puntuación
 * descendente, y al final las de conveni pendiente (también por puntuación).
 */
export function priorizar(
  entidades: EntidadPriorizable[],
  excedente: ExcedenteContexto,
): EntidadPuntuada[] {
  const puntuadas = entidades
    .map((e) => puntuarEntidad(e, excedente))
    .filter((e): e is EntidadPuntuada => e !== null);

  return puntuadas.sort((a, b) => {
    if (a.pendiente !== b.pendiente) return a.pendiente ? 1 : -1;
    return b.puntuacion - a.puntuacion;
  });
}
