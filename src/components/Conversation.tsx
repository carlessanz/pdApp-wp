import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import { plantillaPrimerContacte } from '../lib/plantillas'
import type { RolContacte } from '../lib/plantillas'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import type { WaContact, WaMessage } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  contact: WaContact
}

interface Notice {
  kind: 'error' | 'warning'
  text: string
}

type Tfn = (key: string, params?: Record<string, string | number>) => string

function noticeFromError(data: unknown, t: Tfn): Notice {
  const payload = data as { error?: unknown; code?: string } | null
  const err = payload?.error
  switch (payload?.code) {
    case 'window_closed': return { kind: 'warning', text: t('msg.w_closed') }
    case 'no_opt_in': return { kind: 'warning', text: t('msg.w_optin') }
    case 'no_test_user': return { kind: 'warning', text: t('msg.w_no_test') }
    case 'unknown_contact': return { kind: 'error', text: t('msg.w_unknown') }
    case 'unauthorized': return { kind: 'error', text: t('msg.w_unauth') }
  }
  if (typeof err === 'string') return { kind: 'error', text: err }
  if (err && typeof err === 'object') {
    const meta = err as { code?: number; message?: string; error_data?: { details?: string } }
    const details = meta.error_data?.details ?? ''
    if (meta.code === 131047 || details.toLowerCase().includes('24 hours')) {
      return { kind: 'warning', text: t('msg.w_closed') }
    }
    return { kind: 'error', text: `Meta (${meta.code ?? '?'}): ${meta.message ?? '?'}${details ? ` — ${details}` : ''}` }
  }
  return { kind: 'error', text: 'Error' }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === new Date().toDateString()) return time
  return `${date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${time}`
}

export default function Conversation({ contact }: Props) {
  const { t } = useT()
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    supabase.from('wa_messages')
      .select('id, wa_message_id, contact_phone, direction, type, body, status, created_at')
      .eq('contact_phone', contact.phone).order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setLoadError(error.message)
        else setMessages((data as WaMessage[]) ?? [])
        setLoading(false)
      })
    const channel = supabase
      .channel(`wa-messages-${contact.phone}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: `contact_phone=eq.${contact.phone}` },
        (payload) => {
          const message = payload.new as WaMessage
          setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message])
        })
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [contact.phone])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function handleSendText(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setNotice(null)
    const result = await sendWhatsApp({ to: contact.phone, type: 'text', body })
    setSending(false)
    if (result.ok) setDraft('')
    else setNotice(noticeFromError(result.data, t))
  }

  async function handleSendTemplate() {
    if (sending) return
    setSending(true)
    setNotice(null)
    // Rol del destinatario para elegir la plantilla catalana adecuada. La
    // entidad tiene prioridad si el número es a la vez productor y entidad: el
    // primer contacto manual suele ser para pedir aceptación de una oferta.
    const [ent, prod] = await Promise.all([
      supabase.from('entidades').select('id').eq('telefono', contact.phone).maybeSingle(),
      supabase.from('productores').select('id').eq('phone', contact.phone).maybeSingle(),
    ])
    const rol: RolContacte = ent.data ? 'entitat' : prod.data ? 'productor' : null
    const plantilla = plantillaPrimerContacte(rol)
    const result = await sendWhatsApp({
      to: contact.phone, type: 'template',
      template: plantilla.name, language: plantilla.language, components: [],
    })
    setSending(false)
    if (!result.ok) setNotice(noticeFromError(result.data, t))
  }

  const ventanaAbierta = contact.last_inbound_at != null &&
    Date.now() - new Date(contact.last_inbound_at).getTime() < 24 * 60 * 60 * 1000

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center justify-between border-b bg-card px-5 py-3">
        <div>
          <h2 className="font-semibold">{contact.name ?? contact.phone}</h2>
          {contact.name && <span className="text-xs text-muted-foreground">{contact.phone}</span>}
        </div>
        <Badge variant={contact.opt_in ? 'default' : 'secondary'}>
          {contact.opt_in ? t('msg.optin') : t('msg.no_consent')}
        </Badge>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-5">
        {loading && <p className="text-sm text-muted-foreground">{t('msg.loading')}</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('msg.no_messages')}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
              m.direction === 'outbound' ? 'rounded-br-sm bg-secondary text-secondary-foreground' : 'rounded-bl-sm bg-card')}>
              <p className="whitespace-pre-wrap break-words">{m.body ?? <em>[{m.type ?? '—'}]</em>}</p>
              <span className="mt-1 block text-right text-[0.65rem] text-muted-foreground">
                {formatTime(m.created_at)}
                {m.direction === 'outbound' && m.status && <> · {m.status}</>}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {notice && (
        <div className={cn('mx-5 rounded-md px-3 py-2 text-sm',
          notice.kind === 'warning' ? 'bg-yellow-50 text-yellow-800' : 'bg-red-50 text-red-700')}>
          {notice.text}
        </div>
      )}

      {!ventanaAbierta && (
        <div className="mx-5 mb-1 flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>{t('msg.banner', { name: contact.name ?? t('msg.this_contact') })}</span>
        </div>
      )}

      <footer className="flex items-center gap-2 border-t bg-card px-5 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={ventanaAbierta ? 'outline' : 'default'}
              onClick={handleSendTemplate} disabled={sending}>
              {ventanaAbierta ? t('msg.template') : t('msg.first_msg')}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-center">{t('msg.tooltip')}</TooltipContent>
        </Tooltip>
        <form className="flex flex-1 gap-2" onSubmit={handleSendText}>
          <Input placeholder={ventanaAbierta ? t('msg.write_ph') : t('msg.start_first_ph')}
            value={draft} onChange={(e) => setDraft(e.target.value)} disabled={sending || !ventanaAbierta} />
          <Button type="submit" disabled={sending || !draft.trim() || !ventanaAbierta}>
            {sending ? t('c.sending') : t('c.send')}
          </Button>
        </form>
      </footer>
    </main>
  )
}
