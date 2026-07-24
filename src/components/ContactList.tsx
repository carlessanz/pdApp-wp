import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { countUnanswered } from '../lib/mensajes'
import type { MessageRow } from '../lib/mensajes'
import type { WaContact } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

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
  const [unanswered, setUnanswered] = useState<Record<string, number>>({})
  const [tipo, setTipo] = useState<'tots' | 'productors' | 'receptors'>('tots')
  const [prodSet, setProdSet] = useState<Set<string>>(new Set())
  const [entSet, setEntSet] = useState<Set<string>>(new Set())

  // Carga los mensajes para contar los "sin contestar" por contacto y se suscribe a
  // Realtime, de modo que la lista se reordena en cuanto llega un mensaje nuevo.
  useEffect(() => {
    let cancelled = false
    let rows: MessageRow[] = []
    supabase.from('wa_messages').select('contact_phone, direction, created_at')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) { console.error('wa_messages select:', loadError.message); return }
        rows = (data as MessageRow[]) ?? []
        setUnanswered(countUnanswered(rows))
      })
    const channel = supabase
      .channel('wa-messages-contactos')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wa_messages' },
        (payload) => { rows = [...rows, payload.new as MessageRow]; setUnanswered(countUnanswered(rows)) })
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [])

  // Clasifica los contactos como productor y/o receptor cruzando su teléfono con
  // productores.phone y entidades.telefono (normalizado a solo dígitos), para el
  // filtro de tipo. Un contacto puede ser ambos (doble rol) y sale en los dos.
  useEffect(() => {
    const norm = (p: string | null) => (p ?? '').replace(/\D/g, '')
    void Promise.all([
      supabase.from('productores').select('phone'),
      supabase.from('entidades').select('telefono'),
    ]).then(([prod, ent]) => {
      setProdSet(new Set((prod.data ?? []).map((r) => norm(r.phone)).filter(Boolean)))
      setEntSet(new Set((ent.data ?? []).map((r) => norm(r.telefono)).filter(Boolean)))
    })
  }, [])

  // Filtro por tipo (tots/productors/receptors) y por nombre o teléfono; luego se
  // ordena poniendo primero los contactos con mensajes sin contestar (más
  // pendientes arriba), conservando el resto del orden.
  const filtrados = useMemo(() => {
    const norm = (p: string) => p.replace(/\D/g, '')
    const q = busqueda.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    let base = q
      ? contacts.filter((c) =>
          (c.name ?? '').toLowerCase().includes(q) ||
          (qDigits !== '' && c.phone.includes(qDigits)))
      : contacts
    if (tipo === 'productors') base = base.filter((c) => prodSet.has(norm(c.phone)))
    else if (tipo === 'receptors') base = base.filter((c) => entSet.has(norm(c.phone)))
    return [...base].sort((a, b) => (unanswered[b.phone] ?? 0) - (unanswered[a.phone] ?? 0))
  }, [contacts, busqueda, unanswered, tipo, prodSet, entSet])

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
        <div className="space-y-2 px-3 pb-3">
          <Input type="search" placeholder={t('msg.search_contact')} value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)} className="h-8" />
          <div className="flex gap-1">
            {(['tots', 'productors', 'receptors'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setTipo(f)}
                className={cn('flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                  tipo === f ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-muted')}>
                {t(f === 'tots' ? 'msg.filter_all' : f === 'productors' ? 'msg.filter_producers' : 'msg.filter_receivers')}
              </button>
            ))}
          </div>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
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
        {filtrados.map((c) => {
          const pendientes = unanswered[c.phone] ?? 0
          return (
            <button key={c.id} type="button" onClick={() => onSelect(c.phone)}
              className={cn('flex w-full items-center gap-2.5 border-b px-3 py-1.5 text-left hover:bg-muted/50',
                c.phone === selectedPhone && 'bg-secondary/40')}>
              <span className={cn('size-2 shrink-0 rounded-full', c.opt_in ? 'bg-green-500' : 'bg-gray-400')}
                title={c.opt_in ? t('msg.optin') : t('msg.no_consent')} />
              <span className="truncate text-sm font-medium">{c.name ?? c.phone}</span>
              {pendientes > 0 ? (
                <Badge variant="destructive" className="ml-auto shrink-0 px-1.5"
                  title={t('msg.unanswered', { n: pendientes })}>{pendientes}</Badge>
              ) : (
                c.name && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{c.phone}</span>
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
