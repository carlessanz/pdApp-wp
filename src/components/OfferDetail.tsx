import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import { priorizarEntidades } from '../lib/poma'
import type { EntidadPuntuada } from '../lib/poma'
import { textoRecollidaConfirmada, textoAlbaran } from '../lib/textos'
import type { Canalizacion, Excedente } from '../types'

interface Props {
  excedente: Excedente
  onBack: () => void
}

// Copia al portapapeles y avisa brevemente.
function useCopiar(): [string | null, (texto: string, id: string) => void] {
  const [copiado, setCopiado] = useState<string | null>(null)
  const copiar = useCallback((texto: string, id: string) => {
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(id)
      setTimeout(() => setCopiado(null), 1500)
    })
  }, [])
  return [copiado, copiar]
}

export default function OfferDetail({ excedente, onBack }: Props) {
  const [exc, setExc] = useState<Excedente>(excedente)
  const [canalizaciones, setCanalizaciones] = useState<Canalizacion[]>([])
  const [ranking, setRanking] = useState<EntidadPuntuada[]>([])
  const [rankingError, setRankingError] = useState<string | null>(null)
  const [cargandoRanking, setCargandoRanking] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, copiar] = useCopiar()

  const canalizados = canalizaciones.reduce((s, c) => s + Number(c.kg_confirmados ?? 0), 0)
  const total = Number(exc.kg_total ?? 0)
  const faltan = Math.max(0, total - canalizados)

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

  // Fija disponible_hasta (el intake lo deja null: el productor responde en texto libre).
  async function guardarFecha(valor: string) {
    await supabase.from('excedentes').update({ disponible_hasta: valor || null }).eq('id', excedente.id)
    await recargar()
  }

  // Marca/desmarca el opt-in de una entidad. Es la mecánica de consentimiento en la PoC.
  async function toggleOptIn(entidadId: string, actual: boolean) {
    await supabase.from('entidades').update({ opt_in: !actual }).eq('id', entidadId)
    const r = await priorizarEntidades(excedente.id)
    setRanking(r.ranking)
  }

  // "Enviar por API": en modo PoC no sale nada (queda 'simulat'); igualmente traza.
  async function enviarOferta(ent: EntidadPuntuada) {
    if (!ent.telefono || !ent.opt_in) return
    setAviso(null)
    const r = await sendWhatsApp({
      to: ent.telefono, type: 'template', template: 'oferta_excedent',
      language: 'ca', components: [],
    })
    if (r.ok) {
      setAviso(`Oferta enviada a ${ent.nombre} (mode PoC: registrada com a simulada).`)
    } else {
      const data = r.data as { error?: unknown; code?: string } | null
      const err = data?.error
      // 131030: destinatario fuera de los 5 de test.
      const meta = (typeof err === 'object' && err) as { code?: number } | null
      setAviso(
        meta?.code === 131030
          ? `${ent.nombre} no está en los 5 números de prueba de Meta.`
          : typeof err === 'string' ? err : 'No se pudo enviar.',
      )
    }
  }

  async function altaCanalizacion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    const entidad_id = String(fd.get('entidad') || '')
    const kg_confirmados = Number(fd.get('kg') || 0)
    if (!entidad_id || !kg_confirmados) return

    await supabase.from('canalizaciones').insert({
      excedente_id: excedente.id,
      entidad_id,
      kg_confirmados,
      caixes_entregades: Number(fd.get('caixes') || 0) || null,
      comentarios: String(fd.get('comentarios') || '') || null,
    })

    // Recalcular y bloquear si se cubren los kg.
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

  const nombrePorId = (id: string | null) =>
    ranking.find((e) => e.id === id)?.nombre ?? id ?? '—'

  const vencida = exc.disponible_hasta != null &&
    new Date(exc.disponible_hasta) < new Date() && faltan > 0

  return (
    <main className="offer-detail">
      <div className="sidebar-back">
        <button type="button" className="btn-link" onClick={onBack}>← Ofertas</button>
      </div>

      <header className="offer-head">
        <div>
          <h1><code>{exc.id_excedente}</code></h1>
          <p className="hint">{exc.producto}{exc.variedad ? ` · ${exc.variedad}` : ''} — {exc.estado}</p>
        </div>
        <div className="offer-kg">
          <strong>{canalizados}/{total} kg</strong>
          <span className="hint">{faltan > 0 ? `falten ${faltan}` : 'complet'}</span>
        </div>
      </header>

      {aviso && <div className="notice notice-warning">{aviso}</div>}

      {/* Texto de la oferta, listo para copiar */}
      {exc.texto_oferta && (
        <section className="offer-block">
          <div className="offer-block-head">
            <h2>Texto de la oferta</h2>
            <button type="button" className="btn btn-secondary"
              onClick={() => copiar(exc.texto_oferta ?? '', 'oferta')}>
              {copiado === 'oferta' ? 'Copiado ✓' : 'Copiar texto para el grupo'}
            </button>
          </div>
          <pre className="offer-text">{exc.texto_oferta}</pre>
        </section>
      )}

      {/* Fecha de disponibilidad (la usa el job de vencidas) */}
      <section className="offer-block">
        <h2>Disponible hasta</h2>
        <input type="date" defaultValue={exc.disponible_hasta ?? ''}
          onChange={(ev) => void guardarFecha(ev.target.value)} />
        {vencida && <span className="notice notice-warning"> Vencida con kg sin cubrir</span>}
      </section>

      {/* Priorización de entidades */}
      <section className="offer-block">
        <h2>Entidades priorizadas</h2>
        {cargandoRanking && <p className="hint">Calculando…</p>}
        {rankingError && <div className="notice notice-error">{rankingError}</div>}
        {!cargandoRanking && !rankingError && (
          <div className="rank-list">
            {ranking.slice(0, 15).map((ent) => (
              <div key={ent.id} className={`rank-row${ent.pendiente ? ' rank-pendiente' : ''}`}>
                <div className="rank-main">
                  <span className="rank-score">{ent.puntuacion}</span>
                  <div>
                    <div className="rank-nombre">{ent.nombre}{ent.poblacion ? ` · ${ent.poblacion}` : ''}</div>
                    <div className="rank-motivos">{ent.motivos.join(' · ') || 'Sin coincidencias'}</div>
                  </div>
                </div>
                <div className="rank-actions">
                  <label className="optin-toggle">
                    <input type="checkbox" checked={ent.opt_in}
                      onChange={() => void toggleOptIn(ent.id, ent.opt_in)} />
                    opt-in
                  </label>
                  <button type="button" className="btn btn-primary"
                    disabled={!ent.opt_in || !ent.telefono}
                    title={!ent.opt_in ? 'Sin opt-in' : !ent.telefono ? 'Sin teléfono' : undefined}
                    onClick={() => void enviarOferta(ent)}>
                    Enviar per API
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Canalizaciones */}
      <section className="offer-block">
        <h2>Canalizaciones</h2>
        {canalizaciones.length === 0 && <p className="hint">Ninguna todavía.</p>}
        {canalizaciones.map((c) => {
          const difiere = c.kg_reales != null && Number(c.kg_reales) !== Number(c.kg_confirmados)
          return (
            <div key={c.id} className="canal-row">
              <span>{nombrePorId(c.entidad_id)}</span>
              <span>{c.kg_confirmados} kg conf.</span>
              <label className="canal-reales">
                reales:
                <input type="number" defaultValue={c.kg_reales ?? ''} className={difiere ? 'difiere' : ''}
                  onBlur={(ev) => ev.target.value && void guardarKgReales(c.id, Number(ev.target.value))} />
              </label>
              {difiere && <span className="notice notice-warning">difiere</span>}
              <button type="button" className="btn btn-secondary"
                onClick={() => copiar(textoAlbaran({
                  idExcedente: exc.id_excedente ?? '', entitat: nombrePorId(c.entidad_id),
                  productor: '', producte: exc.producto ?? '',
                  kgReals: String(c.kg_reales ?? c.kg_confirmados ?? ''),
                  dataRecollida: c.data_hora_recollida?.slice(0, 10) ?? '',
                }), `alb-${c.id}`)}>
                {copiado === `alb-${c.id}` ? 'Copiado ✓' : 'Generar albarà'}
              </button>
            </div>
          )
        })}

        <form className="canal-form" onSubmit={altaCanalizacion}>
          <select name="entidad" required defaultValue="">
            <option value="" disabled>Entidad…</option>
            {ranking.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <input name="kg" type="number" placeholder="kg" required />
          <input name="caixes" type="number" placeholder="caixes" />
          <input name="comentarios" type="text" placeholder="comentarios" />
          <button type="submit" className="btn btn-primary">Añadir</button>
        </form>
      </section>

      {/* Bloqueada: RECOLLIDA CONFIRMADA */}
      {exc.estado === 'bloqueada' && (
        <section className="offer-block">
          <div className="offer-block-head">
            <h2>Recollida confirmada</h2>
            <button type="button" className="btn btn-secondary"
              onClick={() => copiar(textoRecollidaConfirmada({
                entitat: canalizaciones.map((c) => nombrePorId(c.entidad_id)).join(', '),
                dataHora: '', kgRecollits: String(canalizados),
                kgFalten: String(faltan), comentaris: '',
              }), 'recollida')}>
              {copiado === 'recollida' ? 'Copiado ✓' : 'Copiar RECOLLIDA CONFIRMADA'}
            </button>
          </div>
        </section>
      )}

      {/* Marcar no colocada */}
      {exc.estado !== 'no_colocada' && exc.estado !== 'cerrada' && (
        <section className="offer-block">
          <button type="button" className="btn btn-danger" onClick={() => void marcarNoColocada()}>
            Marcar como no colocada
          </button>
        </section>
      )}
    </main>
  )
}
