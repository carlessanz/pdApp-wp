import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
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
  const campos = [e.nombre, e.poblacion, e.area_geografica, e.telefono, e.email, e.contacto, e.modalitat]
  return campos.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function EntitiesList({ onSendMessage, onOpenDetail, onNew }: Props) {
  const { t } = useT()
  const [entidades, setEntidades] = useState<Entidad[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('entidades').select('*').order('nombre', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        else setEntidades(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Primero las entidades de prueba (pueden recibir), luego el resto — igual que productores.
  const { test, resto } = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const filtradas = entidades.filter((e) => casa(e, q))
    const test: Entidad[] = []
    const resto: Entidad[] = []
    for (const e of filtradas) {
      if (e.es_test) test.push(e)
      else resto.push(e)
    }
    return { test, resto }
  }, [entidades, busqueda])

  function tabla(lista: Entidad[], marcarTest: boolean) {
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('ent.c_name')}</TableHead>
              <TableHead>{t('ent.c_town')}</TableHead>
              <TableHead>{t('ent.c_modality')}</TableHead>
              <TableHead>{t('ent.c_phone')}</TableHead>
              <TableHead>{t('ent.c_email')}</TableHead>
              <TableHead>{t('ent.c_prio')}</TableHead>
              <TableHead className="text-right">{t('ent.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((e) => {
              const tel = soloDigitos(e.telefono)
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {e.nombre}
                      {marcarTest && <Badge variant="secondary">{t('badge.test')}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.poblacion ?? '—'}</TableCell>
                  <TableCell>
                    {e.modalitat ? <Badge variant="outline">{e.modalitat}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{tel ? `+${tel}` : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="max-w-[170px] break-all leading-tight">{e.email ?? '—'}</div>
                  </TableCell>
                  <TableCell>{e.prioritat ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => onOpenDetail(e)}>{t('c.detail')}</Button>
                      <Button size="sm" disabled={!tel} title={tel ? undefined : t('ent.no_phone')}
                        onClick={() => tel && onSendMessage(tel, e.nombre)}>{t('c.message')}</Button>
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

  const vacio = !loading && !error && test.length === 0 && resto.length === 0

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t('ent.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('ent.subtitle')}</p>
        </div>
        <Button onClick={onNew}><Plus className="size-4" /> {t('c.new_f')}</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <Input type="search" placeholder={t('ent.search')} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        {loading && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {vacio && <p className="text-sm text-muted-foreground">{entidades.length === 0 ? t('ent.empty') : t('ent.no_match')}</p>}
        {test.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t('grp.test', { n: test.length })}</h3>
            {tabla(test, true)}
          </section>
        )}
        {resto.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">{t('grp.rest', { n: resto.length })}</h3>
            {tabla(resto, false)}
          </section>
        )}
      </CardContent>
    </Card>
  )
}
