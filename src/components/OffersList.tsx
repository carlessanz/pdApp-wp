import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Excedente } from '../types'

interface Props {
  onOpen: (excedente: Excedente) => void
}

// kg canalizados por excedente (suma de kg_confirmados de sus canalizaciones).
type KgPorExcedente = Record<string, number>

const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']

function estadoLabel(estado: string): { texto: string; clase: string } {
  switch (estado) {
    case 'publicada': return { texto: 'Publicada', clase: 'estado-publicada' }
    case 'parcial': return { texto: 'Parcial', clase: 'estado-parcial' }
    case 'bloqueada': return { texto: 'Bloquejada', clase: 'estado-bloqueada' }
    case 'borrador': return { texto: 'Esborrany', clase: 'estado-borrador' }
    case 'cancelada': return { texto: 'Cancel·lada', clase: 'estado-cancelada' }
    case 'no_colocada': return { texto: 'No col·locada', clase: '' }
    case 'cerrada': return { texto: 'Tancada', clase: '' }
    default: return { texto: estado, clase: '' }
  }
}

export default function OffersList({ onOpen }: Props) {
  const [offers, setOffers] = useState<Excedente[]>([])
  const [kg, setKg] = useState<KgPorExcedente>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [ofertas, canalizaciones] = await Promise.all([
      supabase.from('excedentes').select('*').in('estado', ACTIVOS)
        .order('created_at', { ascending: false }),
      supabase.from('canalizaciones').select('excedente_id, kg_confirmados'),
    ])
    if (ofertas.error) {
      setError(`No se pudieron cargar las ofertas: ${ofertas.error.message}`)
      setOffers([])
    } else {
      setOffers(ofertas.data ?? [])
    }
    const acc: KgPorExcedente = {}
    for (const c of canalizaciones.data ?? []) {
      if (!c.excedente_id) continue
      acc[c.excedente_id] = (acc[c.excedente_id] ?? 0) + Number(c.kg_confirmados ?? 0)
    }
    setKg(acc)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    // Realtime: recarga ante cualquier cambio en ofertas o canalizaciones.
    const channel = supabase
      .channel('poma-ofertas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'excedentes' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'canalizaciones' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  // Filtro client-side por referencia, producto/variedad y estado.
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return offers
    return offers.filter((o) => {
      const campos = [o.id_excedente, o.producto, o.variedad, estadoLabel(o.estado).texto]
      return campos.some((c) => (c ?? '').toLowerCase().includes(q))
    })
  }, [offers, busqueda])

  return (
    <main className="producers">
      <div className="producers-card">
        <header className="producers-header">
          <h1>Ofertas activas</h1>
          <p className="hint">Excedentes en curso, con los kg canalizados en vivo</p>
        </header>
        <input
          type="search"
          className="buscador"
          placeholder="Buscar por referencia, producto o estado…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {loading && <p className="hint">Cargando ofertas…</p>}
        {error && <div className="notice notice-error">{error}</div>}
        {!loading && !error && offers.length === 0 && (
          <p className="hint">No hay ofertas activas. Se crean cuando un productor escribe por WhatsApp.</p>
        )}
        {!loading && !error && offers.length > 0 && filtradas.length === 0 && (
          <p className="hint">Ninguna oferta casa con la búsqueda.</p>
        )}
        {!loading && !error && filtradas.length > 0 && (
          <div className="producers-table-wrap">
            <table className="producers-table">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Producto</th>
                  <th>Progreso (kg)</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((o) => {
                  const total = Number(o.kg_total ?? 0)
                  const canalizados = kg[o.id] ?? 0
                  const faltan = Math.max(0, total - canalizados)
                  const pct = total > 0 ? Math.min(100, Math.round((canalizados / total) * 100)) : 0
                  const est = estadoLabel(o.estado)
                  return (
                    <tr key={o.id}>
                      <td><code>{o.id_excedente ?? '—'}</code></td>
                      <td>{o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}</td>
                      <td>
                        <div className="kg-bar" aria-label={`${canalizados} de ${total} kg`}>
                          <div className="kg-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="kg-text">
                          {canalizados}/{total} kg{faltan > 0 ? ` · falten ${faltan}` : ' · complet'}
                        </span>
                      </td>
                      <td><span className={`estado-badge ${est.clase}`}>{est.texto}</span></td>
                      <td>
                        <button type="button" className="btn btn-primary" onClick={() => onOpen(o)}>
                          Abrir
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
