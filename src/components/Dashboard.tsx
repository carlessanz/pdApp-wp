import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  anadirNumeroTest,
  borrarNumeroTest,
  listarNumerosTest,
} from '../lib/metaTest'
import type { MetaTestRecipient } from '../lib/metaTest'

// Filas mínimas que carga el dashboard para calcular los KPIs.
interface MsgRow {
  contact_phone: string
  direction: 'inbound' | 'outbound'
  created_at: string
}
interface ExcRow {
  id: string
  estado: string
  kg_total: number | null
}

const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']

// Los 4 momentos del proceso POMA (§8 del manual), en una frase cada uno.
const PROCESO = [
  {
    n: 1,
    titulo: 'Entrada de la oferta',
    texto:
      'El productor escribe por WhatsApp y POMA convierte su excedente en una oferta con identificador propio.',
  },
  {
    n: 2,
    titulo: 'Distribución',
    texto:
      'Se priorizan las entidades sociales por cercanía y capacidad, y se les avisa una a una.',
  },
  {
    n: 3,
    titulo: 'Confirmación',
    texto:
      'Al cubrir los kg la oferta se bloquea y se envía la RECOLLIDA CONFIRMADA.',
  },
  {
    n: 4,
    titulo: 'Cierre',
    texto:
      'Se registran los kg reales y los albaranes; lo que no se coloca se marca con su motivo.',
  },
]

// Cuenta inbound posteriores al último outbound de cada teléfono.
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

export default function Dashboard() {
  const [prodPhones, setProdPhones] = useState<(string | null)[]>([])
  const [entidades, setEntidades] = useState<{ telefono: string | null; opt_in: boolean | null }[]>([])
  const [excedentes, setExcedentes] = useState<ExcRow[]>([])
  const [canalKg, setCanalKg] = useState<Record<string, number>>({})
  const [kgConfirmadosTotal, setKgConfirmadosTotal] = useState(0)
  const [mensajes, setMensajes] = useState<MsgRow[]>([])
  const [intakeActivas, setIntakeActivas] = useState(0)
  const [lista, setLista] = useState<MetaTestRecipient[]>([])
  const [loading, setLoading] = useState(true)

  const numerosSet = useMemo(() => new Set(lista.map((r) => r.phone)), [lista])

  const cargar = useCallback(async () => {
    setLoading(true)
    const [prod, ent, exc, canal, msg, intake, metaLista] = await Promise.all([
      supabase.from('productores').select('phone'),
      supabase.from('entidades').select('telefono, opt_in'),
      supabase.from('excedentes').select('id, estado, kg_total'),
      supabase.from('canalizaciones').select('excedente_id, kg_confirmados'),
      supabase.from('wa_messages').select('contact_phone, direction, created_at'),
      supabase.from('intake_sessions').select('id'),
      listarNumerosTest(),
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
    setLista(metaLista)
    setLoading(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const kpis = useMemo(() => {
    const ofertas = { activas: 0, bloqueadas: 0, cerradas: 0, noColocadas: 0, canceladas: 0 }
    let pendientes = 0
    for (const e of excedentes) {
      if (e.estado === 'bloqueada') ofertas.bloqueadas += 1
      else if (e.estado === 'cerrada') ofertas.cerradas += 1
      else if (e.estado === 'no_colocada') ofertas.noColocadas += 1
      else if (e.estado === 'cancelada') ofertas.canceladas += 1
      if (['borrador', 'publicada', 'parcial'].includes(e.estado)) ofertas.activas += 1
      if (ACTIVOS.includes(e.estado)) {
        pendientes += Math.max(0, Number(e.kg_total ?? 0) - (canalKg[e.id] ?? 0))
      }
    }

    const conMovil = prodPhones.filter((p) => p && soloDigitos(p).length >= 9).length
    const prodEnMeta = prodPhones.filter((p) => p && numerosSet.has(p)).length

    const entConOptIn = entidades.filter((e) => e.opt_in).length
    const entEnMeta = entidades.filter((e) => numerosSet.has(soloDigitos(e.telefono))).length

    const recibidos = mensajes.filter((m) => m.direction === 'inbound').length
    const sinContestar = contarSinContestar(mensajes)

    return {
      ofertas,
      kg: { canalizados: kgConfirmadosTotal, pendientes },
      productores: { total: prodPhones.length, conMovil, enMeta: prodEnMeta },
      entidades: { total: entidades.length, conOptIn: entConOptIn, enMeta: entEnMeta },
      mensajes: { recibidos, sinContestar, intakeActivas },
    }
  }, [excedentes, canalKg, kgConfirmadosTotal, prodPhones, entidades, mensajes, intakeActivas, numerosSet])

  // Gestor de la lista de Meta: alta/baja tocan la BD y refrescan el estado local.
  const [nuevoPhone, setNuevoPhone] = useState('')
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState('')
  const [metaError, setMetaError] = useState<string | null>(null)

  async function anadir() {
    setMetaError(null)
    if (lista.length >= 5) {
      setMetaError('Meta permite como máximo 5 números de prueba.')
      return
    }
    const err = await anadirNumeroTest(nuevoPhone, nuevaEtiqueta)
    if (err) {
      setMetaError(err)
      return
    }
    setNuevoPhone('')
    setNuevaEtiqueta('')
    setLista(await listarNumerosTest())
  }

  async function borrar(phone: string) {
    await borrarNumeroTest(phone)
    setLista(await listarNumerosTest())
  }

  return (
    <main className="dashboard">
      <header className="dashboard-head">
        <h1>Panel POMA</h1>
        <p className="hint">
          Canalización de excedentes agrícolas por WhatsApp. En modo prueba de concepto:
          no sale ningún mensaje real.
        </p>
      </header>

      {/* Guía del proceso */}
      <section className="dash-section">
        <h2>Cómo funciona</h2>
        <div className="proceso-grid">
          {PROCESO.map((p) => (
            <div key={p.n} className="proceso-card">
              <span className="proceso-num">{p.n}</span>
              <h3>{p.titulo}</h3>
              <p>{p.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* KPIs */}
      <section className="dash-section">
        <h2>De un vistazo</h2>
        {loading ? (
          <p className="hint">Cargando datos…</p>
        ) : (
          <div className="kpi-grid">
            <div className="kpi-card">
              <h3>Ofertas</h3>
              <div className="kpi-big">{kpis.ofertas.activas}</div>
              <p className="kpi-sub">activas</p>
              <ul className="kpi-detalle">
                <li>{kpis.ofertas.bloqueadas} bloquejades</li>
                <li>{kpis.ofertas.cerradas} tancades</li>
                <li>{kpis.ofertas.noColocadas} no col·locades</li>
                <li>{kpis.ofertas.canceladas} cancel·lades</li>
              </ul>
            </div>
            <div className="kpi-card">
              <h3>Kg</h3>
              <div className="kpi-big">{kpis.kg.canalizados}</div>
              <p className="kpi-sub">canalitzats</p>
              <ul className="kpi-detalle">
                <li>{kpis.kg.pendientes} pendents en ofertes actives</li>
              </ul>
            </div>
            <div className="kpi-card">
              <h3>Productores</h3>
              <div className="kpi-big">{kpis.productores.total}</div>
              <p className="kpi-sub">en la base</p>
              <ul className="kpi-detalle">
                <li>{kpis.productores.conMovil} con móvil</li>
                <li className="kpi-destacado">{kpis.productores.enMeta} en Meta (pueden recibir)</li>
              </ul>
            </div>
            <div className="kpi-card">
              <h3>Entidades</h3>
              <div className="kpi-big">{kpis.entidades.total}</div>
              <p className="kpi-sub">receptoras</p>
              <ul className="kpi-detalle">
                <li>{kpis.entidades.conOptIn} con opt-in</li>
                <li className="kpi-destacado">{kpis.entidades.enMeta} en Meta (pueden recibir)</li>
              </ul>
            </div>
            <div className="kpi-card">
              <h3>Mensajes</h3>
              <div className="kpi-big">{kpis.mensajes.recibidos}</div>
              <p className="kpi-sub">recibidos</p>
              <ul className="kpi-detalle">
                <li>{kpis.mensajes.sinContestar} sin contestar</li>
                <li>{kpis.mensajes.intakeActivas} sesiones de intake</li>
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* Gestor de la lista de test de Meta */}
      <section className="dash-section">
        <h2>Números de prueba (Meta)</h2>
        <p className="hint dash-hint-left">
          En el entorno de test, WhatsApp solo entrega a estos números (máximo 5). El alta real
          se hace en el panel de Meta, donde el destinatario confirma un código; aquí solo se
          registra cuáles son. Esta lista decide quién puede recibir en toda la app: si está
          vacía, no se aplica ningún límite.
        </p>

        <div className="meta-lista">
          {lista.length === 0 && <p className="hint dash-hint-left">Todavía no hay números.</p>}
          {lista.map((r) => (
            <div key={r.phone} className="meta-fila">
              <span className="meta-fila-phone">+{r.phone}</span>
              <span className="meta-fila-etiqueta">{r.etiqueta ?? '—'}</span>
              <button type="button" className="btn btn-secondary" onClick={() => void borrar(r.phone)}>
                Quitar
              </button>
            </div>
          ))}
        </div>

        {lista.length < 5 && (
          <div className="meta-alta">
            <input
              type="tel"
              placeholder="Teléfono (34612345678)"
              value={nuevoPhone}
              onChange={(e) => {
                setNuevoPhone(e.target.value)
                setMetaError(null)
              }}
            />
            <input
              type="text"
              placeholder="Etiqueta (nombre)"
              value={nuevaEtiqueta}
              onChange={(e) => setNuevaEtiqueta(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={() => void anadir()}>
              Añadir
            </button>
          </div>
        )}
        {metaError && <div className="notice notice-error">{metaError}</div>}
      </section>
    </main>
  )
}
