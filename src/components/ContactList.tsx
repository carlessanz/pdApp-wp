import { useState } from 'react'
import type { FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import type { WaContact } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Props {
  contacts: WaContact[]
  loading: boolean
  error: string | null
  selectedPhone: string | null
  onSelect: (phone: string) => void
  onReload: () => void
}

const E164_SIN_MAS = /^[1-9]\d{6,14}$/

export default function ContactList({ contacts, loading, error, selectedPhone, onSelect, onReload }: Props) {
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
      setFormError('Teléfono inválido: E.164 sin +, ej. 34612345678')
      return
    }
    setSaving(true)
    const { error: insertError } = await supabase.from('wa_contacts').insert({
      phone: cleanPhone, name: name.trim() || null, opt_in: true, opt_in_at: new Date().toISOString(),
    })
    setSaving(false)
    if (insertError) {
      setFormError(insertError.code === '23505' ? 'Ya existe un contacto con ese teléfono'
        : `No se pudo crear: ${insertError.message}`)
      return
    }
    setName(''); setPhone(''); setShowForm(false)
    onReload(); onSelect(cleanPhone)
  }

  return (
    <aside className="flex w-80 flex-shrink-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="font-semibold">Contactos</h1>
        <Button size="sm" variant={showForm ? 'outline' : 'default'}
          onClick={() => { setShowForm((v) => !v); setFormError(null) }}>
          {showForm ? 'Cancelar' : <><Plus className="size-4" /> Añadir</>}
        </Button>
      </div>

      {showForm && (
        <form className="grid gap-2 border-b bg-muted/40 p-4" onSubmit={handleSubmit}>
          <Input placeholder="Nombre (opcional)" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          <Input type="tel" placeholder="34612345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} required />
          <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar contacto'}</Button>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
        {error && (
          <div className="p-4 text-sm text-destructive">
            {error} <button type="button" className="underline" onClick={onReload}>Reintentar</button>
          </div>
        )}
        {!loading && !error && contacts.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No hay contactos todavía.</p>
        )}
        {contacts.map((c) => (
          <button key={c.id} type="button" onClick={() => onSelect(c.phone)}
            className={cn('flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/50',
              c.phone === selectedPhone && 'bg-secondary/40')}>
            <span className={cn('size-2.5 flex-shrink-0 rounded-full', c.opt_in ? 'bg-green-500' : 'bg-gray-400')}
              title={c.opt_in ? 'Con opt-in' : 'Sin consentimiento'} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{c.name ?? c.phone}</span>
              {c.name && <span className="text-xs text-muted-foreground">{c.phone}</span>}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
