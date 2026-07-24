// Construye el array `components` de la plantilla `oferta_excedent` (Cloud API de
// Meta) a partir de los datos de una oferta. El mapeo de las 7 variables está en
// supabase/functions/_shared/plantillas-meta.md (§1). Solo se envía el componente
// `body` (el header de la plantilla es texto fijo sin variable). Meta rechaza
// parámetros vacíos, así que cada variable lleva un fallback.

export interface DatosOfertaPlantilla {
  producto: string | null
  variedad: string | null
  productor: string | null
  municipi: string | null
  kg: number | null
  caixes: number | null
  disponible: string | null
  horari: string | null
  responsable?: string | null
}

function orDefault(v: string | null | undefined, fallback: string): string {
  const s = (v ?? '').trim()
  return s === '' ? fallback : s
}

/** Devuelve los `components` (solo `body`, 7 variables) de `oferta_excedent`. */
export function construirComponentsOferta(d: DatosOfertaPlantilla): unknown[] {
  const producte = orDefault(d.variedad ? `${d.producto} · ${d.variedad}` : d.producto, '—')
  const quantitat = d.kg
    ? `${d.kg} kg${d.caixes ? ` · ${d.caixes} caixes` : ''}`
    : 'a convenir'
  const textos = [
    producte,
    orDefault(d.productor, '—'),
    orDefault(d.municipi, '—'),
    quantitat,
    orDefault(d.disponible, 'consultar'),
    orDefault(d.horari, 'a convenir'),
    orDefault(d.responsable, 'Equip POMA'),
  ]
  return [{ type: 'body', parameters: textos.map((text) => ({ type: 'text', text })) }]
}
