import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  anadirNumeroTest, borrarNumeroTest, listarNumerosTest, type MetaTestRecipient,
} from '../lib/metaTest'
import {
  anadirEmailTest, borrarEmailTest, listarEmailsTest, type EmailTestRecipient,
} from '../lib/emailTest'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MsgRow { contact_phone: string; direction: 'inbound' | 'outbound'; created_at: string }
interface ExcRow { id: string; estado: string; kg_total: number | null }

const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']

const PROCESO = [
  { n: 1, titulo: 'Entrada de la oferta', texto: 'El productor escribe por WhatsApp y POMA convierte su excedente en una oferta.' },
  { n: 2, titulo: 'Distribución', texto: 'Se priorizan las entidades por cercanía y capacidad, y se les avisa (WhatsApp o email).' },
  { n: 3, titulo: 'Confirmación', texto: 'Al cubrir los kg la oferta se bloquea y se envía la RECOLLIDA CONFIRMADA.' },
  { n: 4, titulo: 'Cierre', texto: 'Se registran los kg reales y albaranes; lo que no se coloca se marca con su motivo.' },
]

function contarSinContestar(rows: MsgRow[]): number {
  const lastOutbound: Record<string, string> = {}
  for (const r of rows) {
    if (r.direction === 'outbound' && (lastOutbound[r.contact_phone] ?? '') < r.created_at) {
      lastOutbound[r.contact_phone] = r.created_at
    }
  }
  let total = 0
  for (const r of rows) {
    if (r.direction !== 'inbound') continue
    const last = lastOutbound[r.contact_phone]
    if (!last || r.created_at > last) total += 1
  }
  return total
}

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '')

// KPI reutilizable
function Kpi({ titulo, valor, sub, detalle }: {
  titulo: string; valor: number | string; sub: string; detalle: { texto: string; destacado?: boolean }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold leading-none text-primary">{valor}</div>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        <ul className="mt-3 space-y-0.5 border-t pt-2 text-sm">
          {detalle.map((d, i) => (
            <li key={i} className={d.destacado ? 'font-medium text-blue-700' : 'text-muted-foreground'}>{d.texto}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// Gestor de whitelist genérico (Meta y email comparten forma).
function GestorWhitelist({ titulo, ayuda, items, placeholderClave, placeholderEtiqueta, max, onAdd, onDelete }: {
  titulo: string
  ayuda: string
  items: { clave: string; etiqueta: string | null }[]
  placeholderClave: string
  placeholderEtiqueta: string
  max: number
  onAdd: (clave: string, etiqueta: string) => Promise<string | null>
  onDelete: (clave: string) => Promise<void>
}) {
  const [clave, setClave] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {items.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay ninguno.</p>}
          {items.map((r) => (
            <div key={r.clave} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{r.clave}</span>
              <span className="flex-1 text-muted-foreground">{r.etiqueta ?? '—'}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => void onDelete(r.clave)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        {items.length < max && (
          <div className="flex flex-wrap gap-2">
            <Input className="flex-1" placeholder={placeholderClave} value={clave}
              onChange={(e) => { setClave(e.target.value); setError(null) }} />
            <Input className="flex-1" placeholder={placeholderEtiqueta} value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)} />
            <Button onClick={async () => {
              const err = await onAdd(clave, etiqueta)
              if (err) { setError(err); return }
              setClave(''); setEtiqueta('')
            }}>Añadir</Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const [prodPhones, setProdPhones] = useState<(string | null)[]>([])
  const [entidades, setEntidades] = useState<{ telefono: string | null; email: string | null; opt_in: boolean | null }[]>([])
  const [excedentes, setExcedentes] = useState<ExcRow[]>([])
  const [canalKg, setCanalKg] = useState<Record<string, number>>({})
  const [kgConfirmadosTotal, setKgConfirmadosTotal] = useState(0)
  const [mensajes, setMensajes] = useState<MsgRow[]>([])
  const [intakeActivas, setIntakeActivas] = useState(0)
  const [lista, setLista] = useState<MetaTestRecipient[]>([])
  const [listaEmail, setListaEmail] = useState<EmailTestRecipient[]>([])
  const [loading, setLoading] = useState(true)

  const numerosSet = useMemo(() => new Set(lista.map((r) => r.phone)), [lista])

  const cargar = useCallback(async () => {
    setLoading(true)
    const [prod, ent, exc, canal, msg, intake, meta, mails] = await Promise.all([
      supabase.from('productores').select('phone'),
      supabase.from('entidades').select('telefono, email, opt_in'),
      supabase.from('excedentes').select('id, estado, kg_total'),
      supabase.from('canalizaciones').select('excedente_id, kg_confirmados'),
      supabase.from('wa_messages').select('contact_phone, direction, created_at'),
      supabase.from('intake_sessions').select('id'),
      listarNumerosTest(),
      listarEmailsTest(),
    ])
    setProdPhones((prod.data ?? []).map((p) => p.phone))
    setEntidades(ent.data ?? [])
    setExcedentes((exc.data ?? []) as ExcRow[])
    const porExc: Record<string, number> = {}
    let totalKg = 0
    for (const c of canal.data ?? []) {
      const kg = Number(c.kg_confirmados ?? 0)
      totalKg += kg
      if (c.excedente_id) porExc[c.excedente_id] = (porExc[c.excedente_id] ?? 0) + kg
    }
    setCanalKg(porExc)
    setKgConfirmadosTotal(totalKg)
    setMensajes((msg.data as MsgRow[]) ?? [])
    setIntakeActivas((intake.data ?? []).length)
    setLista(meta)
    setListaEmail(mails)
    setLoading(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const kpis = useMemo(() => {
    const ofertas = { activas: 0, bloqueadas: 0, cerradas: 0, noColocadas: 0, canceladas: 0 }
    let pendientes = 0
    for (const e of excedentes) {
      if (e.estado === 'bloqueada') ofertas.bloqueadas += 1
      else if (e.estado === 'cerrada') ofertas.cerradas += 1
      else if (e.estado === 'no_colocada') ofertas.noColocadas += 1
      else if (e.estado === 'cancelada') ofertas.canceladas += 1
      if (['borrador', 'publicada', 'parcial'].includes(e.estado)) ofertas.activas += 1
      if (ACTIVOS.includes(e.estado)) pendientes += Math.max(0, Number(e.kg_total ?? 0) - (canalKg[e.id] ?? 0))
    }
    const conMovil = prodPhones.filter((p) => p && soloDigitos(p).length >= 9).length
    const prodEnMeta = prodPhones.filter((p) => p && numerosSet.has(p)).length
    const entConOptIn = entidades.filter((e) => e.opt_in).length
    const entEnMeta = entidades.filter((e) => numerosSet.has(soloDigitos(e.telefono))).length
    const entConEmail = entidades.filter((e) => e.email).length
    const recibidos = mensajes.filter((m) => m.direction === 'inbound').length
    return {
      ofertas, kg: { canalizados: kgConfirmadosTotal, pendientes },
      productores: { total: prodPhones.length, conMovil, enMeta: prodEnMeta },
      entidades: { total: entidades.length, conOptIn: entConOptIn, enMeta: entEnMeta, conEmail: entConEmail },
      mensajes: { recibidos, sinContestar: contarSinContestar(mensajes), intakeActivas },
    }
  }, [excedentes, canalKg, kgConfirmadosTotal, prodPhones, entidades, mensajes, intakeActivas, numerosSet])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Panel POMA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Canalización de excedentes agrícolas por WhatsApp y email. Envíos limitados a los números/correos de prueba.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cómo funciona</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESO.map((p) => (
            <Card key={p.n}>
              <CardContent className="pt-6">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{p.n}</span>
                <h3 className="mt-2 text-sm font-semibold">{p.titulo}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.texto}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">De un vistazo</h2>
        {loading ? <p className="text-sm text-muted-foreground">Cargando datos…</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi titulo="Ofertas" valor={kpis.ofertas.activas} sub="activas" detalle={[
              { texto: `${kpis.ofertas.bloqueadas} bloquejades` },
              { texto: `${kpis.ofertas.cerradas} tancades` },
              { texto: `${kpis.ofertas.noColocadas} no col·locades` },
              { texto: `${kpis.ofertas.canceladas} cancel·lades` },
            ]} />
            <Kpi titulo="Kg" valor={kpis.kg.canalizados} sub="canalitzats" detalle={[
              { texto: `${kpis.kg.pendientes} pendents en ofertes actives` },
            ]} />
            <Kpi titulo="Productores" valor={kpis.productores.total} sub="en la base" detalle={[
              { texto: `${kpis.productores.conMovil} con móvil` },
              { texto: `${kpis.productores.enMeta} en Meta (pueden recibir)`, destacado: true },
            ]} />
            <Kpi titulo="Entidades" valor={kpis.entidades.total} sub="receptoras" detalle={[
              { texto: `${kpis.entidades.conOptIn} con opt-in` },
              { texto: `${kpis.entidades.conEmail} con email` },
              { texto: `${kpis.entidades.enMeta} en Meta (pueden recibir)`, destacado: true },
            ]} />
            <Kpi titulo="Mensajes" valor={kpis.mensajes.recibidos} sub="recibidos" detalle={[
              { texto: `${kpis.mensajes.sinContestar} sin contestar` },
              { texto: `${kpis.mensajes.intakeActivas} sesiones de intake` },
            ]} />
          </div>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <GestorWhitelist
          titulo="Números de prueba (Meta)"
          ayuda="En test, WhatsApp solo entrega a estos números (máx. 5), dados de alta en Meta. Si está vacía, no se aplica límite."
          items={lista.map((r) => ({ clave: r.phone, etiqueta: r.etiqueta }))}
          placeholderClave="34612345678" placeholderEtiqueta="Etiqueta" max={5}
          onAdd={async (c, e) => { const err = await anadirNumeroTest(c, e); if (!err) setLista(await listarNumerosTest()); return err }}
          onDelete={async (c) => { await borrarNumeroTest(c); setLista(await listarNumerosTest()) }}
        />
        <GestorWhitelist
          titulo="Correos de prueba (email)"
          ayuda="Las ofertas por email solo se mandan a estos correos. Requiere un dominio verificado en Resend. Si está vacía, no se aplica límite."
          items={listaEmail.map((r) => ({ clave: r.email, etiqueta: r.etiqueta }))}
          placeholderClave="correo@dominio.com" placeholderEtiqueta="Etiqueta" max={20}
          onAdd={async (c, e) => { const err = await anadirEmailTest(c, e); if (!err) setListaEmail(await listarEmailsTest()); return err }}
          onDelete={async (c) => { await borrarEmailTest(c); setListaEmail(await listarEmailsTest()) }}
        />
      </section>
    </div>
  )
}
