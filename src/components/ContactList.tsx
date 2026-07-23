import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
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
  const { t } = useT()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // Filtro por nombre o teléfono (sobre lo ya cargado).
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return contacts
    const qDigits = q.replace(/\D/g, '')
    return contacts.filter((c) =>
      (c.name ?? '').toLowerCase().includes(q) ||
      (qDigits !== '' && c.phone.includes(qDigits)))
  }, [contacts, busqueda])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const cleanPhone = phone.trim()
    if (!E164_SIN_MAS.test(cleanPhone)) {
      setFormError(t('msg.phone_invalid'))
      return
    }
    setSaving(true)
    const { error: insertError } = await supabase.from('wa_contacts').insert({
      phone: cleanPhone, name: name.trim() || null, opt_in: true, opt_in_at: new Date().toISOString(),
    })
    setSaving(false)
    if (insertError) {
      setFormError(insertError.code === '23505' ? t('msg.exists') : insertError.message)
      return
    }
    setName(''); setPhone(''); setShowForm(false)
    onReload(); onSelect(cleanPhone)
  }

  return (
    <aside className="flex h-full w-full flex-col border-r bg-card">
      <div className="border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="font-semibold">{t('msg.contacts')}</h1>
          <Button size="sm" variant={showForm ? 'outline' : 'default'}
            onClick={() => { setShowForm((v) => !v); setFormError(null) }}>
            {showForm ? t('c.cancel') : <><Plus className="size-4" /> {t('c.add')}</>}
          </Button>
        </div>
        <div className="px-3 pb-3">
          <Input type="search" placeholder={t('msg.search_contact')} value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)} className="h-8" />
        </div>
      </div>

      {showForm && (
        <form className="grid gap-2 border-b bg-muted/40 p-4" onSubmit={handleSubmit}>
          <Input placeholder={t('msg.name_ph')} value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
          <Input type="tel" placeholder="34612345678" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={saving} required />
          <Button type="submit" disabled={saving}>{saving ? t('c.saving') : t('msg.save_contact')}</Button>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-4 text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && (
          <div className="p-4 text-sm text-destructive">
            {error} <button type="button" className="underline" onClick={onReload}>{t('msg.retry')}</button>
          </div>
        )}
        {!loading && !error && contacts.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('msg.no_contacts')}</p>
        )}
        {!loading && !error && contacts.length > 0 && filtrados.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('msg.no_match_contact')}</p>
        )}
        {filtrados.map((c) => (
          <button key={c.id} type="button" onClick={() => onSelect(c.phone)}
            className={cn('flex w-full items-center gap-2.5 border-b px-3 py-1.5 text-left hover:bg-muted/50',
              c.phone === selectedPhone && 'bg-secondary/40')}>
            <span className={cn('size-2 flex-shrink-0 rounded-full', c.opt_in ? 'bg-green-500' : 'bg-gray-400')}
              title={c.opt_in ? t('msg.optin') : t('msg.no_consent')} />
            <span className="truncate text-sm font-medium">{c.name ?? c.phone}</span>
            {c.name && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{c.phone}</span>}
          </button>
        ))}
      </div>
    </aside>
  )
}
