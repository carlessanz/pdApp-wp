import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cargarNumerosTest } from '../lib/metaTest'
import type { Productor } from '../types'

interface Props {
  onSendMessage: (phone: string, name: string | null) => void
  onOpenDetail: (productor: Productor) => void
  onNew: () => void
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

// Un productor casa con la búsqueda si el texto aparece en su nombre, empresa,
// teléfono, población o email.
function casa(p: Productor, q: string): boolean {
  if (!q) return true
  const campos = [p.name, p.empresa, p.phone, p.poblacion, p.email]
  return campos.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function ProducersList({ onSendMessage, onOpenDetail, onNew }: Props) {
  const [producers, setProducers] = useState<Productor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unanswered, setUnanswered] = useState<Record<string, number>>({})
  const [numerosTest, setNumerosTest] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')

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

  // Números dados de alta en Meta: definen quién puede recibir WhatsApp en test.
  useEffect(() => {
    void cargarNumerosTest().then(setNumerosTest)
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

  // Filtra por la búsqueda y separa en dos grupos: los que están dados de alta en
  // Meta (pueden recibir mensajes) y el resto.
  const { enMeta, resto } = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtrados = producers.filter((p) => casa(p, q))
    const enMeta: Productor[] = []
    const resto: Productor[] = []
    for (const p of filtrados) {
      if (p.phone && numerosTest.has(p.phone)) enMeta.push(p)
      else resto.push(p)
    }
    return { enMeta, resto }
  }, [producers, numerosTest, busqueda])

  function fila(productor: Productor, marcarMeta: boolean) {
    const sinContestar = productor.phone ? (unanswered[productor.phone] ?? 0) : 0
    return (
      <tr key={productor.id}>
        <td>
          {productor.name}
          {marcarMeta && <span className="meta-badge">Meta</span>}
          {sinContestar > 0 && (
            <span className="unanswered-badge">{sinContestar} sin contestar</span>
          )}
        </td>
        <td>{productor.email ?? '—'}</td>
        <td>{productor.phone ? `+${productor.phone}` : '—'}</td>
        <td>
          <div className="fila-acciones">
            <button type="button" className="btn btn-secondary" onClick={() => onOpenDetail(productor)}>
              Detalle
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => productor.phone && onSendMessage(productor.phone, productor.name)}
              disabled={!productor.phone}
              title={productor.phone ? undefined : 'Sin teléfono móvil registrado'}
            >
              Enviar mensaje
            </button>
          </div>
        </td>
      </tr>
    )
  }

  function tabla(lista: Productor[], marcarMeta: boolean) {
    return (
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
          <tbody>{lista.map((p) => fila(p, marcarMeta))}</tbody>
        </table>
      </div>
    )
  }

  const sinResultados = !loading && !error && enMeta.length === 0 && resto.length === 0

  return (
    <main className="producers">
      <div className="producers-card">
        <header className="producers-header">
          <div className="producers-header-top">
            <h1>Productores</h1>
            <button type="button" className="btn btn-primary" onClick={onNew}>Nuevo productor</button>
          </div>
          <p className="hint">
            Los de arriba están dados de alta en Meta y pueden recibir WhatsApp; los de abajo, no.
          </p>
        </header>

        <input
          type="search"
          className="buscador"
          placeholder="Buscar por nombre, empresa, teléfono, población o email…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        {loading && <p className="hint">Cargando productores…</p>}
        {error && <div className="notice notice-error">{error}</div>}
        {sinResultados && (
          <p className="hint">
            {producers.length === 0
              ? 'No hay productores registrados.'
              : 'Ningún productor casa con la búsqueda.'}
          </p>
        )}

        {!loading && !error && enMeta.length > 0 && (
          <section className="producers-group">
            <h2 className="producers-group-title">
              Pueden recibir mensajes (en Meta) · {enMeta.length}
            </h2>
            {tabla(enMeta, true)}
          </section>
        )}

        {!loading && !error && enMeta.length > 0 && resto.length > 0 && (
          <hr className="producers-divider" />
        )}

        {!loading && !error && resto.length > 0 && (
          <section className="producers-group">
            <h2 className="producers-group-title">
              No dados de alta en Meta · {resto.length}
            </h2>
            {tabla(resto, false)}
          </section>
        )}
      </div>
    </main>
  )
}
