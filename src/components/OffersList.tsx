import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import type { Excedente } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  onOpen: (excedente: Excedente) => void
}

type KgPorExcedente = Record<string, number>
const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']

function estadoLabel(estado: string): { texto: string; clase: string } {
  switch (estado) {
    case 'publicada': return { texto: 'Publicada', clase: 'bg-blue-100 text-blue-800' }
    case 'parcial': return { texto: 'Parcial', clase: 'bg-yellow-100 text-yellow-800' }
    case 'bloqueada': return { texto: 'Bloquejada', clase: 'bg-green-100 text-green-800' }
    case 'borrador': return { texto: 'Esborrany', clase: 'bg-muted text-muted-foreground' }
    case 'cancelada': return { texto: 'Cancel·lada', clase: 'bg-red-100 text-red-700' }
    case 'no_colocada': return { texto: 'No col·locada', clase: 'bg-muted text-muted-foreground' }
    case 'cerrada': return { texto: 'Tancada', clase: 'bg-muted text-muted-foreground' }
    default: return { texto: estado, clase: 'bg-muted text-muted-foreground' }
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
    } else setOffers(ofertas.data ?? [])
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
    const channel = supabase
      .channel('poma-ofertas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'excedentes' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'canalizaciones' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return offers
    return offers.filter((o) => {
      const campos = [o.id_excedente, o.producto, o.variedad, estadoLabel(o.estado).texto]
      return campos.some((c) => (c ?? '').toLowerCase().includes(q))
    })
  }, [offers, busqueda])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ofertas activas</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">Excedentes en curso, con los kg en vivo.</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder="Buscar por referencia, producto o estado…"
          value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />

        {loading && <p className="text-sm text-muted-foreground">Cargando ofertas…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && offers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hay ofertas activas. Se crean cuando un productor escribe por WhatsApp.
          </p>
        )}
        {!loading && !error && offers.length > 0 && filtradas.length === 0 && (
          <p className="text-sm text-muted-foreground">Ninguna oferta casa con la búsqueda.</p>
        )}

        {filtradas.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Progreso (kg)</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((o) => {
                  const total = Number(o.kg_total ?? 0)
                  const canalizados = kg[o.id] ?? 0
                  const faltan = Math.max(0, total - canalizados)
                  const pct = total > 0 ? Math.min(100, Math.round((canalizados / total) * 100)) : 0
                  const est = estadoLabel(o.estado)
                  return (
                    <TableRow key={o.id}>
                      <TableCell><code className="text-xs">{o.id_excedente ?? '—'}</code></TableCell>
                      <TableCell>{o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}</TableCell>
                      <TableCell className="min-w-40">
                        <div className="h-2 w-36 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-green-600" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {canalizados}/{total} kg{faltan > 0 ? ` · falten ${faltan}` : ' · complet'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', est.clase)}>
                          {est.texto}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => onOpen(o)}>Abrir</Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
