// Selección de la plantilla de "primer contacte" (mensaje fuera de la ventana de 24 h).
//
// El primer mensaje a alguien que aún no nos ha escrito debe ir por PLANTILLA
// aprobada por Meta. En el número de test solo `hello_world` (en_US) está
// aprobada; las plantillas catalanas "respon OK" (una para productores, otra
// para entidades) están redactadas en
// supabase/functions/_shared/plantillas-meta.md y requieren un número de
// producción para que Meta las apruebe. Mientras tanto este módulo devuelve
// siempre el fallback, así el botón de primer contacto sigue funcionando en test.
// Cuando Meta apruebe las catalanas, poner PLANTILLES_CA_APROVADES = true.

export type RolContacte = 'productor' | 'entitat' | null

export interface PlantillaRef {
  name: string
  language: string
}

// Cambiar a true cuando `salutacio_productor` y `salutacio_entitat` estén
// aprobadas en Meta (requiere número de producción).
export const PLANTILLES_CA_APROVADES = false

const PLANTILLES: Record<'productor' | 'entitat' | 'fallback', PlantillaRef> = {
  productor: { name: 'salutacio_productor', language: 'ca' },
  entitat: { name: 'salutacio_entitat', language: 'ca' },
  fallback: { name: 'hello_world', language: 'en_US' },
}

/** Devuelve la plantilla de primer contacto según el rol del destinatario. */
export function plantillaPrimerContacte(rol: RolContacte): PlantillaRef {
  if (!PLANTILLES_CA_APROVADES) return PLANTILLES.fallback
  return rol === 'entitat' ? PLANTILLES.entitat : PLANTILLES.productor
}
