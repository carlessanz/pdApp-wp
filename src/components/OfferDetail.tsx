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
import { useT } from '../lib/i18n'
import { textoRecollidaConfirmada, textoAlbaran } from '../lib/textos'
import type { Canalizacion, Excedente, OfertaRespuesta } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  excedente: Excedente
  onBack: () => void
}

// Escapa el texto para HTML y convierte los saltos de línea en <br> (para el
// portapapeles: el <div> del clipboard no interpreta el LF suelto como salto).
function textoAHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function ofertaHtml(texto: string): string {
  const esc = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-family:'Space Grotesk',sans-serif;color:#234C66"><pre style="white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.5;background:#fff;border:1px solid #E0EBC7;border-radius:12px;padding:16px">${esc}</pre></div>`
}

// Fila de oferta_respuestas con el nombre de la entidad (embed de PostgREST).
type RespuestaConEntidad = OfertaRespuesta & {
  entidades: { nombre: string; poblacion: string | null } | null
}

function fechaCorta(iso: string): string {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${dia} ${hora}`
}

function estadoRespuestaClases(estado: string): string {
  switch (estado) {
    case 'acceptada': return 'bg-green-100 text-green-800'
    case 'rebutjada': return 'bg-red-100 text-red-700'
    default: return 'bg-muted text-muted-foreground'
  }
}

export default function OfferDetail({ excedente, onBack }: Props) {
  const { t } = useT()
  const [exc, setExc] = useState<Excedente>(excedente)
  const [canalizaciones, setCanalizaciones] = useState<Canalizacion[]>([])
  const [respuestas, setRespuestas] = useState<RespuestaConEntidad[]>([])
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
    const marcar = () => {
      setCopiado(id)
      toast.success(t('od.copied'))
      setTimeout(() => setCopiado(null), 1500)
    }
    // Se copia text/plain (con los saltos de línea reales) y, además, text/html
    // con <br>: algunos destinos (WhatsApp Web, correo, documentos) colapsan el
    // salto de línea suelto al pegar solo texto plano, y con la versión HTML lo
    // conservan. Si el navegador no soporta ClipboardItem, se cae a writeText.
    const html = `<div style="white-space:pre-wrap">${textoAHtml(texto)}</div>`
    try {
      if ('write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/plain': new Blob([texto], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })
        void navigator.clipboard.write([item]).then(marcar, () => {
          void navigator.clipboard.writeText(texto).then(marcar)
        })
        return
      }
    } catch {
      // Navegador sin ClipboardItem: se usa el fallback de abajo.
    }
    void navigator.clipboard.writeText(texto).then(marcar)
  }, [t])

  const recargar = useCallback(async () => {
    const [e, c] = await Promise.all([
      supabase.from('excedentes').select('*').eq('id', excedente.id).single(),
      supabase.from('canalizaciones').select('*').eq('excedente_id', excedente.id).order('created_at', { ascending: true }),
    ])
    if (e.data) setExc(e.data)
    setCanalizaciones(c.data ?? [])
  }, [excedente.id])

  useEffect(() => { void recargar() }, [recargar])

  const recargarRespuestas = useCallback(async () => {
    const { data } = await supabase
      .from('oferta_respuestas')
      .select('*, entidades(nombre, poblacion)')
      .eq('excedente_id', excedente.id)
      .order('enviado_at', { ascending: false })
    setRespuestas((data as RespuestaConEntidad[]) ?? [])
  }, [excedente.id])

  useEffect(() => {
    void recargarRespuestas()
    // La entidad responde por WhatsApp → el webhook actualiza la fila → aquí se
    // refleja en vivo, sin recargar la página.
    const channel = supabase
      .channel(`oferta-respuestas-${excedente.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'oferta_respuestas', filter: `excedente_id=eq.${excedente.id}` },
        () => { void recargarRespuestas() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [excedente.id, recargarRespuestas])

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

  // Deja constancia de que la oferta se envió a la entidad, en estado 'pendent'.
  // La respuesta por WhatsApp la actualizará el webhook; onConflict hace que
  // reenviar a la misma entidad reinicie la fila en vez de duplicarla.
  async function registrarEnvio(ent: EntidadPuntuada, canal: 'whatsapp' | 'email') {
    const { error } = await supabase.from('oferta_respuestas').upsert({
      excedente_id: excedente.id,
      entidad_id: ent.id,
      telefono: ent.telefono,
      canal,
      estado: 'pendent',
      enviado_at: new Date().toISOString(),
      respondido_at: null,
      mensaje_respuesta: null,
    }, { onConflict: 'excedente_id,entidad_id' })
    if (error) console.error('oferta_respuestas upsert:', error.message)
    await recargarRespuestas()
  }

  // Marcado manual (imprescindible para el email, que no tiene respuesta automática).
  async function marcarRespuesta(id: string, estado: 'pendent' | 'acceptada' | 'rebutjada') {
    await supabase.from('oferta_respuestas').update({
      estado,
      respondido_at: estado === 'pendent' ? null : new Date().toISOString(),
    }).eq('id', id)
    await recargarRespuestas()
  }

  async function enviarOfertaWhatsApp(ent: EntidadPuntuada) {
    if (!ent.telefono || !ent.opt_in || !numerosTest.has(ent.telefono)) return
    if (!exc.texto_oferta) { toast.error(t('od.no_text')); return }
    const r = await sendWhatsApp({ to: ent.telefono, type: 'text', body: exc.texto_oferta })
    if (r.ok) { await registrarEnvio(ent, 'whatsapp'); toast.success(t('od.sent_wa', { name: ent.nombre })); return }
    const data = r.data as { code?: string } | null
    if (data?.code === 'no_test_recipient') toast.error(t('od.no_test_meta', { name: ent.nombre }))
    else if (data?.code === 'unknown_contact') toast.error(t('od.must_write', { name: ent.nombre }))
    else if (data?.code === 'window_closed') toast.error(t('od.window_closed', { name: ent.nombre }))
    else toast.error(t('od.no_send_wa'))
  }

  async function enviarOfertaEmail(ent: EntidadPuntuada) {
    const email = emailPorEntidad[ent.id]
    if (!email || !emailsTest.has(email.toLowerCase())) return
    if (!exc.texto_oferta) { toast.error(t('od.no_text')); return }
    const r = await enviarEmail({
      to: email, subject: `Oferta d'excedent: ${exc.producto ?? ''}`,
      text: exc.texto_oferta, html: ofertaHtml(exc.texto_oferta),
    })
    if (r.ok) { await registrarEnvio(ent, 'email'); toast.success(t('od.sent_email', { name: ent.nombre })); return }
    const data = r.data as { code?: string } | null
    if (data?.code === 'no_test_recipient') toast.error(t('od.email_no_test', { email }))
    else toast.error(t('od.no_send_email'))
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
    const motivo = window.prompt(t('od.prompt_uncoll'))
    if (!motivo) return
    await supabase.from('excedentes').update({ estado: 'no_colocada', motivo_no_colocada: motivo }).eq('id', excedente.id)
    await recargar()
  }

  async function cancelarOferta() {
    if (!window.confirm(t('od.confirm_cancel'))) return
    await supabase.from('excedentes').update({ estado: 'cancelada' }).eq('id', excedente.id)
    await recargar()
  }

  const nombrePorId = (id: string | null) => ranking.find((e) => e.id === id)?.nombre ?? id ?? '—'
  const vencida = exc.disponible_hasta != null && new Date(exc.disponible_hasta) < new Date() && faltan > 0

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t('od.back')}
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
          <span className="text-sm text-muted-foreground">{faltan > 0 ? t('off.falten', { n: faltan }) : t('off.complet')}</span>
        </div>
      </div>

      {exc.texto_oferta && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('od.offer_text')}</CardTitle>
            <Button variant="outline" size="sm" onClick={() => copiar(exc.texto_oferta ?? '', 'oferta')}>
              {copiado === 'oferta' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {t('od.copy_group')}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{exc.texto_oferta}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.available_until')}</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <Input type="date" className="w-auto" defaultValue={exc.disponible_hasta ?? ''}
            onChange={(ev) => void guardarFecha(ev.target.value)} />
          {vencida && <span className="text-sm text-destructive">{t('od.expired')}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.prioritized')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cargandoRanking && <p className="text-sm text-muted-foreground">{t('od.calculating')}</p>}
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
                    <div className="text-xs text-muted-foreground">{ent.motivos.join(' · ') || t('od.no_match_ent')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" checked={ent.opt_in} onChange={() => void toggleOptIn(ent.id, ent.opt_in)} />
                    {t('od.optin')}
                  </label>
                  <Button size="sm" disabled={!ent.opt_in || !enMeta}
                    title={!ent.opt_in ? t('od.no_optin') : !enMeta ? t('od.not_meta') : undefined}
                    onClick={() => void enviarOfertaWhatsApp(ent)}>{t('od.whatsapp')}</Button>
                  <Button size="sm" variant="outline" disabled={!enEmail}
                    title={!email ? t('od.no_email') : !enEmail ? t('od.email_not_test') : undefined}
                    onClick={() => void enviarOfertaEmail(ent)}>{t('od.email')}</Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.responses')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {respuestas.length === 0 && <p className="text-sm text-muted-foreground">{t('od.resp_none')}</p>}
          {respuestas.map((r) => {
            const nombre = r.entidades?.nombre ?? r.telefono ?? '—'
            const cuando = r.respondido_at ?? r.enviado_at
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estadoRespuestaClases(r.estado)}`}>
                    {t(`od.rs_${r.estado}`)}
                  </span>
                  <div>
                    <div className="font-medium">{nombre}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`od.ch_${r.canal}`)} · {fechaCorta(cuando)}
                      {r.mensaje_respuesta ? ` · «${r.mensaje_respuesta}»` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={r.estado === 'acceptada'}
                    onClick={() => void marcarRespuesta(r.id, 'acceptada')}>{t('od.rs_accept')}</Button>
                  <Button size="sm" variant="outline" disabled={r.estado === 'rebutjada'}
                    onClick={() => void marcarRespuesta(r.id, 'rebutjada')}>{t('od.rs_reject')}</Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('od.channelings')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {canalizaciones.length === 0 && <p className="text-sm text-muted-foreground">{t('od.none_yet')}</p>}
          {canalizaciones.map((c) => {
            const difiere = c.kg_reales != null && Number(c.kg_reales) !== Number(c.kg_confirmados)
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 border-b pb-2 text-sm">
                <span className="font-medium">{nombrePorId(c.entidad_id)}</span>
                <span>{c.kg_confirmados} kg</span>
                <label className="flex items-center gap-1">
                  {t('od.reals')}
                  <Input type="number" defaultValue={c.kg_reales ?? ''} className={`h-8 w-20 ${difiere ? 'border-accent' : ''}`}
                    onBlur={(ev) => ev.target.value && void guardarKgReales(c.id, Number(ev.target.value))} />
                </label>
                {difiere && <span className="text-xs text-accent">{t('od.differs')}</span>}
                <Button variant="outline" size="sm"
                  onClick={() => copiar(textoAlbaran({
                    idExcedente: exc.id_excedente ?? '', entitat: nombrePorId(c.entidad_id),
                    productor: '', producte: exc.producto ?? '',
                    kgReals: String(c.kg_reales ?? c.kg_confirmados ?? ''),
                    dataRecollida: c.data_hora_recollida?.slice(0, 10) ?? '',
                  }), `alb-${c.id}`)}>{t('od.albara')}</Button>
              </div>
            )
          })}
          <form className="flex flex-wrap items-center gap-2 pt-2" onSubmit={altaCanalizacion}>
            <select name="entidad" required defaultValue=""
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="" disabled>{t('od.entity_ph')}</option>
              {ranking.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
            <Input name="kg" type="number" placeholder={t('od.kg_ph')} required className="w-24" />
            <Input name="caixes" type="number" placeholder={t('od.boxes_ph')} className="w-24" />
            <Input name="comentarios" type="text" placeholder={t('od.comments_ph')} className="w-40" />
            <Button type="submit">{t('c.add')}</Button>
          </form>
        </CardContent>
      </Card>

      {exc.estado === 'bloqueada' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('od.recollida')}</CardTitle>
            <Button variant="outline" size="sm"
              onClick={() => copiar(textoRecollidaConfirmada({
                entitat: canalizaciones.map((c) => nombrePorId(c.entidad_id)).join(', '),
                dataHora: '', kgRecollits: String(canalizados), kgFalten: String(faltan), comentaris: '',
              }), 'recollida')}>
              {copiado === 'recollida' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {t('od.copy_recollida')}
            </Button>
          </CardHeader>
        </Card>
      )}

      {exc.estado !== 'no_colocada' && exc.estado !== 'cerrada' && exc.estado !== 'cancelada' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={() => void marcarNoColocada()}>{t('od.mark_uncoll')}</Button>
          <Button variant="destructive" onClick={() => void cancelarOferta()}>{t('od.cancel_offer')}</Button>
        </div>
      )}
    </div>
  )
}
