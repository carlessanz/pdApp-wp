import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CampoDef } from '../lib/crudCampos'

type Registro = Record<string, unknown> & { id: string }

interface Props {
  titulo: string // singular: "Productor" / "Entidad"
  volverLabel: string // "Productores" / "Entidades"
  tabla: 'productores' | 'entidades'
  campos: CampoDef[]
  registro: Registro | null // null => alta de una ficha nueva
  nombreKey: string // 'name' / 'nombre'
  telefonoKey?: string // 'phone' / 'telefono'
  onBack: () => void
  onSaved: () => void
  onSendMessage?: (phone: string, name: string | null) => void
}

function mensajeError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Ya existe una ficha con ese teléfono, email o nombre (deben ser únicos).'
  return error.message
}

export default function RecordDetail({
  titulo, volverLabel, tabla, campos, registro, nombreKey, telefonoKey, onBack, onSaved, onSendMessage,
}: Props) {
  const esNuevo = registro == null
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...(registro ?? {}) }))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  // Deja cada campo con el tipo que espera la BD; los vacíos van a null.
  function normalizar(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const c of campos) {
      const tipo = c.tipo ?? 'text'
      let v = form[c.key]
      if (tipo === 'list') {
        if (typeof v === 'string') {
          const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
          v = arr.length ? arr : null
        } else if (Array.isArray(v)) {
          v = v.length ? v : null
        } else v = null
      } else if (tipo === 'number') {
        v = v == null || v === '' ? null : Number(v)
      } else if (tipo === 'bool') {
        v = Boolean(v)
      } else if (tipo === 'boolnull') {
        v = v == null ? null : Boolean(v)
      } else {
        const s = typeof v === 'string' ? v.trim() : v
        v = s === '' || s == null ? null : s
      }
      out[c.key] = v
    }
    return out
  }

  async function guardar() {
    setError(null)
    const datos = normalizar()
    if (!datos[nombreKey]) {
      setError('El nombre es obligatorio.')
      return
    }
    setGuardando(true)
    const resp = registro
      ? await supabase.from(tabla).update(datos).eq('id', registro.id)
      : await supabase.from(tabla).insert(datos)
    setGuardando(false)
    if (resp.error) {
      setError(mensajeError(resp.error))
      return
    }
    onSaved()
  }

  async function borrar() {
    if (!registro) return
    const nombre = String(form[nombreKey] ?? 'esta ficha')
    if (!window.confirm(`¿Seguro que quieres borrar «${nombre}»? Es irreversible.`)) return
    setError(null)
    setGuardando(true)
    const { error: delError } = await supabase.from(tabla).delete().eq('id', registro.id)
    setGuardando(false)
    if (delError) {
      setError(mensajeError(delError))
      return
    }
    onSaved()
  }

  function enviarMensaje() {
    const tel = telefonoKey ? (form[telefonoKey] as string | null) : null
    const limpio = (tel ?? '').replace(/\D/g, '')
    if (!limpio) return
    onSendMessage?.(limpio, (form[nombreKey] as string) ?? null)
  }

  const telValor = telefonoKey ? String(form[telefonoKey] ?? '').replace(/\D/g, '') : ''

  function renderControl(c: CampoDef) {
    const tipo = c.tipo ?? 'text'
    const v = form[c.key]
    if (tipo === 'textarea') {
      return <textarea rows={3} value={(v as string) ?? ''} onChange={(e) => set(c.key, e.target.value)} />
    }
    if (tipo === 'number') {
      return (
        <input type="number" value={v == null || v === '' ? '' : String(v)}
          onChange={(e) => set(c.key, e.target.value === '' ? null : Number(e.target.value))} />
      )
    }
    if (tipo === 'bool') {
      return (
        <select value={v ? 'si' : 'no'} onChange={(e) => set(c.key, e.target.value === 'si')}>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      )
    }
    if (tipo === 'boolnull') {
      return (
        <select value={v == null ? '' : v ? 'si' : 'no'}
          onChange={(e) => set(c.key, e.target.value === '' ? null : e.target.value === 'si')}>
          <option value="">—</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      )
    }
    if (tipo === 'list') {
      const texto = Array.isArray(v) ? (v as string[]).join(', ') : ((v as string) ?? '')
      return <input type="text" value={texto} onChange={(e) => set(c.key, e.target.value)} />
    }
    return (
      <input type={tipo === 'email' ? 'email' : 'text'} value={(v as string) ?? ''}
        onChange={(e) => set(c.key, e.target.value)} />
    )
  }

  return (
    <main className="offer-detail">
      <div className="sidebar-back">
        <button type="button" className="btn-link" onClick={onBack}>← {volverLabel}</button>
      </div>

      <header className="offer-head">
        <div>
          <h1>{esNuevo ? `Nuevo ${titulo.toLowerCase()}` : String(form[nombreKey] ?? titulo)}</h1>
          <p className="hint">{esNuevo ? 'Alta de una ficha nueva' : `Editando ${titulo.toLowerCase()}`}</p>
        </div>
        <div className="detail-actions">
          {telefonoKey && telValor && onSendMessage && (
            <button type="button" className="btn btn-secondary" onClick={enviarMensaje}>Enviar mensaje</button>
          )}
          <button type="button" className="btn btn-primary" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </header>

      {error && <div className="notice notice-error">{error}</div>}

      <section className="offer-block">
        <div className="detail-grid">
          {campos.map((c) => (
            <label key={c.key} className={`detail-field${c.ancho === 'full' ? ' detail-field-full' : ''}`}>
              <span className="detail-label">{c.label}</span>
              {renderControl(c)}
            </label>
          ))}
        </div>
      </section>

      {!esNuevo && (
        <section className="offer-block offer-acciones">
          <button type="button" className="btn btn-danger" disabled={guardando} onClick={() => void borrar()}>
            Borrar {titulo.toLowerCase()}
          </button>
        </section>
      )}
    </main>
  )
}
