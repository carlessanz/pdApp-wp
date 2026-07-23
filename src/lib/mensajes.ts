// Utilidades de mensajería compartidas entre vistas (ProducersList, ContactList).

export interface MessageRow {
  contact_phone: string
  direction: 'inbound' | 'outbound'
  created_at: string
}

/**
 * Cuenta, por teléfono, los mensajes entrantes posteriores al último saliente:
 * los que están "sin contestar". Devuelve { phone: nº pendientes }.
 */
export function countUnanswered(rows: MessageRow[]): Record<string, number> {
  const lastOutbound: Record<string, string> = {}
  for (const row of rows) {
    if (row.direction === 'outbound' && (lastOutbound[row.contact_phone] ?? '') < row.created_at) {
      lastOutbound[row.contact_phone] = row.created_at
    }
  }
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (row.direction !== 'inbound') continue
    const last = lastOutbound[row.contact_phone]
    if (!last || row.created_at > last) counts[row.contact_phone] = (counts[row.contact_phone] ?? 0) + 1
  }
  return counts
}
