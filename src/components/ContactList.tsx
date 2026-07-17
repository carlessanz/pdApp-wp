import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { WaContact } from '../types'

interface Props {
  contacts: WaContact[]
  loading: boolean
  error: string | null
  selectedPhone: string | null
  onSelect: (phone: string) => void
  onReload: () => void
  onBack: () => void
  /** Modo conversación única (desde Productores): oculta el alta manual de contactos */
  single?: boolean
}

// E.164 sin el símbolo +: solo dígitos, ej. 34612345678
const E164_SIN_MAS = /^[1-9]\d{6,14}$/

export default function ContactList({
  contacts,
  loading,
  error,
  selectedPhone,
  onSelect,
  onReload,
  onBack,
  single = false,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const cleanPhone = phone.trim()
    if (!E164_SIN_MAS.test(cleanPhone)) {
      setFormError('Teléfono inválido: formato E.164 sin +, ej. 34612345678')
      return
    }
    setSaving(true)
    const { error: insertError } = await supabase.from('wa_contacts').insert({
      phone: cleanPhone,
      name: name.trim() || null,
      opt_in: true,
      opt_in_at: new Date().toISOString(),
    })
    setSaving(false)
    if (insertError) {
      setFormError(
        insertError.code === '23505'
          ? 'Ya existe un contacto con ese teléfono'
          : `No se pudo crear el contacto: ${insertError.message}`,
      )
      return
    }
    setName('')
    setPhone('')
    setShowForm(false)
    onReload()
    onSelect(cleanPhone)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-back">
        <button type="button" className="btn-link" onClick={onBack}>
          ← Productores
        </button>
      </div>
      <header className="sidebar-header">
        <h1>PDApp</h1>
        {!single && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setShowForm((v) => !v)
              setFormError(null)
            }}
          >
            {showForm ? 'Cancelar' : 'Añadir contacto'}
          </button>
        )}
      </header>

      {!single && showForm && (
        <form className="contact-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Nombre (opcional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          <input
            type="tel"
            placeholder="Teléfono E.164 sin +, ej. 34612345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={saving}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar contacto'}
          </button>
          {formError && <p className="notice notice-error">{formError}</p>}
        </form>
      )}

      <div className="contact-list">
        {loading && <p className="hint">Cargando contactos…</p>}
        {error && (
          <div className="notice notice-error">
            {error}{' '}
            <button type="button" className="btn-link" onClick={onReload}>
              Reintentar
            </button>
          </div>
        )}
        {!loading && !error && contacts.length === 0 && (
          <p className="hint">
            {single ? 'Cargando la conversación…' : 'No hay contactos todavía. Añade el primero.'}
          </p>
        )}
        {contacts.map((contact) => (
          <button
            key={contact.id}
            type="button"
            className={`contact-row${contact.phone === selectedPhone ? ' selected' : ''}`}
            onClick={() => onSelect(contact.phone)}
          >
            <span
              className={`optin-dot ${contact.opt_in ? 'optin-yes' : 'optin-no'}`}
              title={contact.opt_in ? 'Con consentimiento (opt-in)' : 'Sin consentimiento'}
            />
            <span className="contact-info">
              <span className="contact-name">{contact.name ?? contact.phone}</span>
              {contact.name && <span className="contact-phone">{contact.phone}</span>}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
