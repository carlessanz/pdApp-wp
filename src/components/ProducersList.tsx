import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cargarNumerosTest } from '../lib/metaTest'
import type { Productor } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

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
    supabase.from('productores').select('*').order('name', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(`No se pudieron cargar los productores: ${loadError.message}`)
        else setProducers(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void cargarNumerosTest().then(setNumerosTest) }, [])

  useEffect(() => {
    let cancelled = false
    let rows: MessageRow[] = []
    supabase.from('wa_messages').select('contact_phone, direction, created_at')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) { console.error('wa_messages select:', loadError.message); return }
        rows = (data as MessageRow[]) ?? []
        setUnanswered(countUnanswered(rows))
      })
    const channel = supabase
      .channel('wa-messages-productores')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages' },
        (payload) => {
          rows = [...rows, payload.new as MessageRow]
          setUnanswered(countUnanswered(rows))
        })
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [])

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

  function tabla(lista: Productor[], marcarMeta: boolean) {
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((p) => {
              const sinContestar = p.phone ? (unanswered[p.phone] ?? 0) : 0
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {p.name}
                      {marcarMeta && <Badge variant="secondary">Meta</Badge>}
                      {sinContestar > 0 && (
                        <Badge variant="destructive">{sinContestar} sin contestar</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="max-w-[180px] break-all leading-tight">{p.email ?? '—'}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {p.phone ? `+${p.phone}` : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => onOpenDetail(p)}>
                        Detalle
                      </Button>
                      <Button size="sm" disabled={!p.phone}
                        title={p.phone ? undefined : 'Sin teléfono móvil'}
                        onClick={() => p.phone && onSendMessage(p.phone, p.name)}>
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
    )
  }

  const vacio = !loading && !error && enMeta.length === 0 && resto.length === 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Productores</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Arriba, los dados de alta en Meta (pueden recibir WhatsApp); abajo, el resto.
          </p>
        </div>
        <Button onClick={onNew}><Plus className="size-4" /> Nuevo</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder="Buscar por nombre, empresa, teléfono, población o email…"
          value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />

        {loading && <p className="text-sm text-muted-foreground">Cargando productores…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {vacio && (
          <p className="text-sm text-muted-foreground">
            {producers.length === 0 ? 'No hay productores.' : 'Ningún productor casa con la búsqueda.'}
          </p>
        )}

        {enMeta.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Pueden recibir (en Meta) · {enMeta.length}</h3>
            {tabla(enMeta, true)}
          </section>
        )}
        {resto.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              No dados de alta en Meta · {resto.length}
            </h3>
            {tabla(resto, false)}
          </section>
        )}
      </CardContent>
    </Card>
  )
}
