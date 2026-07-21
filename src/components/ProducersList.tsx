import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Productor } from '../types'

interface Props {
  onSendMessage: (productor: Productor) => Promise<void>
}

interface MessageRow {
  contact_phone: string
  direction: 'inbound' | 'outbound'
  created_at: string
}

// Mensajes sin contestar por teléfono: inbound posteriores al último outbound.
function countUnanswered(rows: MessageRow[]): Record<string, number> {
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
    if (!last || row.created_at > last) {
      counts[row.contact_phone] = (counts[row.contact_phone] ?? 0) + 1
    }
  }
  return counts
}

export default function ProducersList({ onSendMessage }: Props) {
  const [producers, setProducers] = useState<Productor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingPhone, setOpeningPhone] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    supabase
      .from('productores')
      .select('*')
      .order('name', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(`No se pudieron cargar los productores: ${loadError.message}`)
        else setProducers(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Carga el historial mínimo de mensajes y se suscribe por Realtime a los nuevos
  // para marcar en rojo los productores con mensajes sin contestar.
  useEffect(() => {
    let cancelled = false
    let rows: MessageRow[] = []

    supabase
      .from('wa_messages')
      .select('contact_phone, direction, created_at')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          console.error('wa_messages select:', loadError.message)
          return
        }
        rows = (data as MessageRow[]) ?? []
        setUnanswered(countUnanswered(rows))
      })

    const channel = supabase
      .channel('wa-messages-productores')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_messages' },
        (payload) => {
          rows = [...rows, payload.new as MessageRow]
          setUnanswered(countUnanswered(rows))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [])

  async function handleSend(productor: Productor) {
    if (!productor.phone) return
    setOpeningPhone(productor.phone)
    await onSendMessage(productor)
  }

  return (
    <main className="producers">
      <div className="producers-card">
        <header className="producers-header">
          <h1>Productores</h1>
          <p className="hint">Selecciona un productor para abrir su conversación de WhatsApp</p>
        </header>
        {loading && <p className="hint">Cargando productores…</p>}
        {error && <div className="notice notice-error">{error}</div>}
        {!loading && !error && producers.length === 0 && (
          <p className="hint">No hay productores registrados.</p>
        )}
        {!loading && !error && producers.length > 0 && (
          <div className="producers-table-wrap">
            <table className="producers-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {producers.map((productor) => {
                  // Muchos productores del Excel no tienen móvil utilizable:
                  // sin él no se les puede escribir por WhatsApp.
                  const sinContestar = productor.phone
                    ? (unanswered[productor.phone] ?? 0)
                    : 0
                  return (
                    <tr key={productor.id}>
                      <td>
                        {productor.name}
                        {sinContestar > 0 && (
                          <span className="unanswered-badge">
                            {sinContestar} sin contestar
                          </span>
                        )}
                      </td>
                      <td>{productor.email ?? '—'}</td>
                      <td>{productor.phone ? `+${productor.phone}` : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleSend(productor)}
                          disabled={openingPhone !== null || !productor.phone}
                          title={
                            productor.phone
                              ? undefined
                              : 'Sin teléfono móvil registrado: no se le puede escribir por WhatsApp'
                          }
                        >
                          {openingPhone === productor.phone ? 'Abriendo…' : 'Enviar mensaje'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
