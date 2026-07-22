import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import { enviarEmail } from '../lib/email'
import { priorizarEntidades } from '../lib/poma'
import type { EntidadPuntuada } from '../lib/poma'
import { cargarNumerosTest } from '../lib/metaTest'
import { cargarEmailsTest } from '../lib/emailTest'
import { textoRecollidaConfirmada, textoAlbaran } from '../lib/textos'
import type { Canalizacion, Excedente } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  excedente: Excedente
  onBack: () => void
}

function ofertaHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-family:'Space Grotesk',sans-serif;color:#234C66"><pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.5;background:#fff;border:1px solid #E0EBC7;border-radius:12px;padding:16px">${esc}</pre></div>`
}

export default function OfferDetail({ excedente, onBack }: Props) {
  const [exc, setExc] = useState<Excedente>(excedente)
  const [canalizaciones, setCanalizaciones] = useState<Canalizacion[]>([])
  const [ranking, setRanking] = useState<EntidadPuntuada[]>([])
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [cargandoRanking, setCargandoRanking] = useState(true)
  const [numerosTest, setNumerosTest] = useState<Set<string>>(new Set())
  const [emailsTest, setEmailsTest] = useState<Set<string>>(new Set())
  const [emailPorEntidad, setEmailPorEntidad] = useState<Record<string, string | null>>({})
  const [copiado, setCopiado] = useState<string | null>(null)

  const canalizados = canalizaciones.reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
  const total = Number(exc.kg_total ?? 0)
  const faltan = Math.max(0, total - canalizados)

  const copiar = useCallback((texto: string, id: string) => {
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(id)
      toast.success('Copiado al portapapeles.')
      setTimeout(() => setCopiado(null), 1500)
    })
  }, [])

  const recargar = useCallback(async () => {
    const [e, c] = await Promise.all([
      supabase.from('excedentes').select('*').eq('id', excedente.id).single(),
      supabase.from('canalizaciones').select('*').eq('excedente_id', excedente.id)
        .order('created_at', { ascending: true }),
    ])
    if (e.data) setExc(e.data)
    setCanalizaciones(c.data ?? [])
  }, [excedente.id])

  useEffect(() => { void recargar() }, [recargar])

  useEffect(() => {
    setCargandoRanking(true)
    void priorizarEntidades(excedente.id).then((r) => {
      setRanking(r.ranking)
      setRankingError(r.error)
      setCargandoRanking(false)
    })
  }, [excedente.id])

  useEffect(() => {
    void cargarNumerosTest().then(setNumerosTest)
    void cargarEmailsTest().then(setEmailsTest)
    void supabase.from('entidades').select('id, email').then(({ data }) => {
      const map: Record<string, string | null> = {}
      for (const e of data ?? []) map[e.id] = e.email
      setEmailPorEntidad(map)
    })
  }, [])

  async function guardarFecha(valor: string) {
    await supabase.from('excedentes').update({ disponible_hasta: valor || null }).eq('id', excedente.id)
    await recargar()
  }

  async function toggleOptIn(entidadId: string, actual: boolean) {
    await supabase.from('entidades').update({ opt_in: !actual }).eq('id', entidadId)
    const r = await priorizarEntidades(excedente.id)
    setRanking(r.ranking)
  }

  // Envío por WhatsApp: texto de la oferta dentro de la ventana de 24 h.
  async function enviarOfertaWhatsApp(ent: EntidadPuntuada) {
    if (!ent.telefono || !ent.opt_in || !numerosTest.has(ent.telefono)) return
    if (!exc.texto_oferta) { toast.error('La oferta no tiene texto generado.'); return }
    const r = await sendWhatsApp({ to: ent.telefono, type: 'text', body: exc.texto_oferta })
    if (r.ok) { toast.success(`Oferta enviada a ${ent.nombre} por WhatsApp.`); return }
    const data = r.data as { error?: unknown; code?: string } | null
    if (data?.code === 'no_test_recipient') toast.error(`${ent.nombre} no está en los números de prueba de Meta.`)
    else if (data?.code === 'unknown_contact') toast.error(`${ent.nombre} debe escribir «hola» al número primero.`)
    else if (data?.code === 'window_closed') toast.error(`Ventana de 24h cerrada con ${ent.nombre}.`)
    else toast.error('No se pudo enviar por WhatsApp.')
  }

  // Envío por email vía Resend.
  async function enviarOfertaEmail(ent: EntidadPuntuada) {
    const email = emailPorEntidad[ent.id]
    if (!email || !emailsTest.has(email.toLowerCase())) return
    if (!exc.texto_oferta) { toast.error('La oferta no tiene texto generado.'); return }
    const r = await enviarEmail({
      to: email,
      subject: `Oferta d'excedent disponible: ${exc.producto ?? ''}`,
      text: exc.texto_oferta,
      html: ofertaHtml(exc.texto_oferta),
    })
    if (r.ok) { toast.success(`Oferta enviada a ${ent.nombre} por email.`); return }
    const data = r.data as { code?: string } | null
    if (data?.code === 'no_test_recipient') toast.error(`${email} no está en la lista de correos de prueba.`)
    else toast.error('No se pudo enviar el email.')
  }

  async function altaCanalizacion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const entidad_id = String(fd.get('entidad') || '')
    const kg_confirmados = Number(fd.get('kg') || 0)
    if (!entidad_id || !kg_confirmados) return
    await supabase.from('canalizaciones').insert({
      excedente_id: excedente.id, entidad_id, kg_confirmados,
      caixes_entregades: Number(fd.get('caixes') || 0) || null,
      comentarios: String(fd.get('comentarios') || '') || null,
    })
    const nuevoCanalizado = canalizados + kg_confirmados
    if (total > 0 && nuevoCanalizado >= total) {
      await supabase.from('excedentes').update({ estado: 'bloqueada' }).eq('id', excedente.id)
    } else if (exc.estado === 'publicada') {
      await supabase.from('excedentes').update({ estado: 'parcial' }).eq('id', excedente.id)
    }
    form.reset()
    await recargar()
  }

  async function guardarKgReales(canalId: string, kgReales: number) {
    await supabase.from('canalizaciones').update({ kg_reales: kgReales }).eq('id', canalId)
    await recargar()
  }

  async function marcarNoColocada() {
    const motivo = window.prompt('Motiu pel qual no s’ha col·locat:')
    if (!motivo) return
    await supabase.from('excedentes')
      .update({ estado: 'no_colocada', motivo_no_colocada: motivo }).eq('id', excedente.id)
    await recargar()
  }

  async function cancelarOferta() {
    if (!window.confirm('¿Seguro que quieres cancelar esta oferta? Quedará marcada como cancelada.')) return
    await supabase.from('excedentes').update({ estado: 'cancelada' }).eq('id', excedente.id)
    await recargar()
  }

  const nombrePorId = (id: string | null) => ranking.find((e) => e.id === id)?.nombre ?? id ?? '—'
  const vencida = exc.disponible_hasta != null && new Date(exc.disponible_hasta) < new Date() && faltan > 0

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> Ofertas
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold"><code>{exc.id_excedente}</code></h1>
          <p className="text-sm text-muted-foreground">
            {exc.producto}{exc.variedad ? ` · ${exc.variedad}` : ''} — {exc.estado}
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{canalizados}/{total} kg</div>
          <span className="text-sm text-muted-foreground">{faltan > 0 ? `falten ${faltan}` : 'complet'}</span>
        </div>
      </div>

      {exc.texto_oferta && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Texto de la oferta</CardTitle>
            <Button variant="outline" size="sm" onClick={() => copiar(exc.texto_oferta ?? '', 'oferta')}>
              {copiado === 'oferta' ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copiar para el grupo
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{exc.texto_oferta}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Disponible hasta</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <Input type="date" className="w-auto" defaultValue={exc.disponible_hasta ?? ''}
            onChange={(ev) => void guardarFecha(ev.target.value)} />
          {vencida && <span className="text-sm text-destructive">Vencida con kg sin cubrir</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Entidades priorizadas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cargandoRanking && <p className="text-sm text-muted-foreground">Calculando…</p>}
          {rankingError && <p className="text-sm text-destructive">{rankingError}</p>}
          {!cargandoRanking && !rankingError && ranking.slice(0, 15).map((ent) => {
            const enMeta = ent.telefono != null && numerosTest.has(ent.telefono)
            const email = emailPorEntidad[ent.id]
            const enEmail = email != null && emailsTest.has(email.toLowerCase())
            return (
              <div key={ent.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 ${ent.pendiente ? 'bg-yellow-50 opacity-80' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-lg font-bold text-primary">{ent.puntuacion}</span>
                  <div>
                    <div className="font-medium">{ent.nombre}{ent.poblacion ? ` · ${ent.poblacion}` : ''}</div>
                    <div className="text-xs text-muted-foreground">{ent.motivos.join(' · ') || 'Sin coincidencias'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" checked={ent.opt_in} onChange={() => void toggleOptIn(ent.id, ent.opt_in)} />
                    opt-in
                  </label>
                  <Button size="sm" disabled={!ent.opt_in || !enMeta}
                    title={!ent.opt_in ? 'Sin opt-in' : !enMeta ? 'No está en Meta' : undefined}
                    onClick={() => void enviarOfertaWhatsApp(ent)}>WhatsApp</Button>
                  <Button size="sm" variant="outline" disabled={!enEmail}
                    title={!email ? 'Sin email' : !enEmail ? 'Email no está en la lista de test' : undefined}
                    onClick={() => void enviarOfertaEmail(ent)}>Email</Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Canalizaciones</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {canalizaciones.length === 0 && <p className="text-sm text-muted-foreground">Ninguna todavía.</p>}
          {canalizaciones.map((c) => {
            const difiere = c.kg_reales != null && Number(c.kg_reales) !== Number(c.kg_confirmados)
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-b pb-2 text-sm">
                <span className="font-medium">{nombrePorId(c.entidad_id)}</span>
                <span>{c.kg_confirmados} kg conf.</span>
                <label className="flex items-center gap-1">
                  reales:
                  <Input type="number" defaultValue={c.kg_reales ?? ''} className={`h-8 w-20 ${difiere ? 'border-accent' : ''}`}
                    onBlur={(ev) => ev.target.value && void guardarKgReales(c.id, Number(ev.target.value))} />
                </label>
                {difiere && <span className="text-xs text-accent">difiere</span>}
                <Button variant="outline" size="sm"
                  onClick={() => copiar(textoAlbaran({
                    idExcedente: exc.id_excedente ?? '', entitat: nombrePorId(c.entidad_id),
                    productor: '', producte: exc.producto ?? '',
                    kgReals: String(c.kg_reales ?? c.kg_confirmados ?? ''),
                    dataRecollida: c.data_hora_recollida?.slice(0, 10) ?? '',
                  }), `alb-${c.id}`)}>Albarà</Button>
              </div>
            )
          })}
          <form className="flex flex-wrap items-center gap-2 pt-2" onSubmit={altaCanalizacion}>
            <select name="entidad" required defaultValue=""
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="" disabled>Entidad…</option>
              {ranking.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <Input name="kg" type="number" placeholder="kg" required className="w-24" />
            <Input name="caixes" type="number" placeholder="caixes" className="w-24" />
            <Input name="comentarios" type="text" placeholder="comentarios" className="w-40" />
            <Button type="submit">Añadir</Button>
          </form>
        </CardContent>
      </Card>

      {exc.estado === 'bloqueada' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recollida confirmada</CardTitle>
            <Button variant="outline" size="sm"
              onClick={() => copiar(textoRecollidaConfirmada({
                entitat: canalizaciones.map((c) => nombrePorId(c.entidad_id)).join(', '),
                dataHora: '', kgRecollits: String(canalizados), kgFalten: String(faltan), comentaris: '',
              }), 'recollida')}>
              {copiado === 'recollida' ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copiar RECOLLIDA CONFIRMADA
            </Button>
          </CardHeader>
        </Card>
      )}

      {exc.estado !== 'no_colocada' && exc.estado !== 'cerrada' && exc.estado !== 'cancelada' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={() => void marcarNoColocada()}>Marcar como no colocada</Button>
          <Button variant="destructive" onClick={() => void cancelarOferta()}>Cancelar oferta</Button>
        </div>
      )}
    </div>
  )
}
