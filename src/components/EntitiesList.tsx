import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cargarNumerosTest } from '../lib/metaTest'
import type { Entidad } from '../types'

// Solo dígitos, para comparar teléfonos con la lista de Meta (E.164 sin '+').
const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')

// Una entidad casa con la búsqueda si el texto aparece en nombre, población,
// área, teléfono, email o contacto.
function casa(e: Entidad, q: string): boolean {
  if (!q) return true
  const campos = [e.nombre, e.poblacion, e.area_geografica, e.telefono, e.email, e.contacto]
  return campos.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function EntitiesList() {
  const [entidades, setEntidades] = useState<Entidad[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numerosTest, setNumerosTest] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('entidades')
      .select('*')
      .order('nombre', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(`No se pudieron cargar las entidades: ${loadError.message}`)
        else setEntidades(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Números dados de alta en Meta: definen qué entidades pueden recibir ofertas.
  useEffect(() => {
    void cargarNumerosTest().then(setNumerosTest)
  }, [])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return entidades.filter((e) => casa(e, q))
  }, [entidades, busqueda])

  return (
    <main className="producers">
      <div className="producers-card">
        <header className="producers-header">
          <h1>Entidades receptoras</h1>
          <p className="hint">
            Entidades sociales que reciben los excedentes. El badge «Meta» marca las que pueden
            recibir mensajes por estar dadas de alta en Meta.
          </p>
        </header>

        <input
          type="search"
          className="buscador"
          placeholder="Buscar por nombre, población, área, teléfono, email o contacto…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />

        {loading && <p className="hint">Cargando entidades…</p>}
        {error && <div className="notice notice-error">{error}</div>}
        {!loading && !error && filtradas.length === 0 && (
          <p className="hint">
            {entidades.length === 0
              ? 'No hay entidades registradas.'
              : 'Ninguna entidad casa con la búsqueda.'}
          </p>
        )}

        {!loading && !error && filtradas.length > 0 && (
          <div className="producers-table-wrap">
            <table className="producers-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Población</th>
                  <th>Área</th>
                  <th>Teléfono</th>
                  <th>Email</th>
                  <th>Prio.</th>
                  <th>Estat</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((e) => {
                  const enMeta = e.telefono != null && numerosTest.has(soloDigitos(e.telefono))
                  return (
                    <tr key={e.id}>
                      <td>
                        {e.nombre}
                        {enMeta && <span className="meta-badge">Meta</span>}
                      </td>
                      <td>{e.poblacion ?? '—'}</td>
                      <td>{e.area_geografica ?? '—'}</td>
                      <td>{e.telefono ? `+${soloDigitos(e.telefono)}` : '—'}</td>
                      <td>{e.email ?? '—'}</td>
                      <td>{e.prioritat ?? '—'}</td>
                      <td>{e.estat ?? '—'}</td>
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
