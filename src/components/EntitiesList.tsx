import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cargarNumerosTest } from '../lib/metaTest'
import type { Entidad } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  onSendMessage: (phone: string, name: string | null) => void
  onOpenDetail: (entidad: Entidad) => void
  onNew: () => void
}

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')

function casa(e: Entidad, q: string): boolean {
  if (!q) return true
  const campos = [e.nombre, e.poblacion, e.area_geografica, e.telefono, e.email, e.contacto]
  return campos.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function EntitiesList({ onSendMessage, onOpenDetail, onNew }: Props) {
  const [entidades, setEntidades] = useState<Entidad[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numerosTest, setNumerosTest] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('entidades').select('*').order('nombre', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(`No se pudieron cargar las entidades: ${loadError.message}`)
        else setEntidades(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void cargarNumerosTest().then(setNumerosTest) }, [])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return entidades.filter((e) => casa(e, q))
  }, [entidades, busqueda])

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Entidades receptoras</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            El badge «Meta» marca las que pueden recibir mensajes.
          </p>
        </div>
        <Button onClick={onNew}><Plus className="size-4" /> Nueva</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder="Buscar por nombre, población, área, teléfono, email o contacto…"
          value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />

        {loading && <p className="text-sm text-muted-foreground">Cargando entidades…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && filtradas.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {entidades.length === 0 ? 'No hay entidades.' : 'Ninguna entidad casa con la búsqueda.'}
          </p>
        )}

        {filtradas.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Población</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Prio.</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((e) => {
                  const tel = soloDigitos(e.telefono)
                  const enMeta = tel !== '' && numerosTest.has(tel)
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">
                        <span className="flex flex-wrap items-center gap-2">
                          {e.nombre}
                          {enMeta && <Badge variant="secondary">Meta</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.poblacion ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {tel ? `+${tel}` : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="max-w-[180px] break-all leading-tight">{e.email ?? '—'}</div>
                      </TableCell>
                      <TableCell>{e.prioritat ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => onOpenDetail(e)}>
                            Detalle
                          </Button>
                          <Button size="sm" disabled={!tel}
                            title={tel ? undefined : 'Sin teléfono'}
                            onClick={() => tel && onSendMessage(tel, e.nombre)}>
                            Mensaje
                          </Button>
                        </div>
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
