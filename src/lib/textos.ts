// Textos que el panel compone para copiar y pegar en el grupo de WhatsApp.
// Reproducen el formato que el equipo usa hoy a mano, emojis incluidos.
//
// El de "OFERTA DISPONIBLE" no está aquí: lo genera el intake al crear el
// excedente (supabase/functions/_shared/oferta.ts) y se guarda en
// `excedentes.texto_oferta`, así que el panel solo lo lee.

export function textoRecollidaConfirmada(campos: {
  entitat: string
  dataHora: string
  kgRecollits: string
  kgFalten: string
  comentaris: string
}): string {
  return [
    '🚚 *RECOLLIDA CONFIRMADA*',
    '',
    `🏛️ SDA / ENTITAT: ${campos.entitat}`,
    `📅 DATA i HORA: ${campos.dataHora}`,
    `⚖️ KG RECOLLITS: ${campos.kgRecollits}`,
    `🔴 KG FALTEN RECOLLIR: ${campos.kgFalten}`,
    `👥 Comentaris: ${campos.comentaris}`,
  ].join('\n')
}

// Plantilla del albarán con marcadores. El formato legal definitivo se toma de
// la hoja "ALBARANS" del Excel, que no está en el repo: no se inventan campos
// legales, se dejan para revisar al integrar el PDF definitivo.
export function textoAlbaran(campos: {
  idExcedente: string
  entitat: string
  productor: string
  producte: string
  kgReals: string
  dataRecollida: string
}): string {
  return [
    "ALBARÀ D'ENTREGA — FUNDACIÓ ESPIGOLADORS",
    '(plantilla provisional · pendent del format oficial del full ALBARANS)',
    '',
    `Referència: ${campos.idExcedente}`,
    `Data de recollida: ${campos.dataRecollida}`,
    `Entitat receptora: ${campos.entitat}`,
    `Productor/a d'origen: ${campos.productor}`,
    `Producte: ${campos.producte}`,
    `Quantitat entregada: ${campos.kgReals} kg`,
    '',
    'Signatura entitat: __________________________',
    'Signatura Espigoladors: _____________________',
    '',
    "[TODO: camps legals definitius del full ALBARANS de l'Excel]",
  ].join('\n')
}
