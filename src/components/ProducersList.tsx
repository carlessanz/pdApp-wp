import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Productor } from '../types'

interface Props {
  onSendMessage: (productor: Productor) => Promise<void>
}

export default function ProducersList({ onSendMessage }: Props) {
  const [producers, setProducers] = useState<Productor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openingPhone, setOpeningPhone] = useState<string | null>(null)

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

  async function handleSend(productor: Productor) {
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
                {producers.map((productor) => (
                  <tr key={productor.id}>
                    <td>{productor.name}</td>
                    <td>{productor.email ?? '—'}</td>
                    <td>+{productor.phone}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleSend(productor)}
                        disabled={openingPhone !== null}
                      >
                        {openingPhone === productor.phone ? 'Abriendo…' : 'Enviar mensaje'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
