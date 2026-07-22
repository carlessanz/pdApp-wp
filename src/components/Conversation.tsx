import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import { cn } from '../lib/utils'
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

function noticeFromError(data: unknown): Notice {
  const payload = data as { error?: unknown; code?: string } | null
  const err = payload?.error
  switch (payload?.code) {
    case 'window_closed':
      return { kind: 'warning', text: 'Fuera de la ventana de 24 horas: solo se puede escribir texto libre después de que el contacto haya escrito.' }
    case 'no_opt_in':
      return { kind: 'warning', text: 'Este contacto no ha dado opt-in; no se le puede enviar una plantilla. Puede darlo escribiendo ALTA.' }
    case 'unknown_contact':
      return { kind: 'error', text: 'El contacto no existe todavía en la base de datos.' }
    case 'unauthorized':
      return { kind: 'error', text: 'Tu sesión ha caducado o no tienes permiso. Vuelve a iniciar sesión.' }
  }
  if (typeof err === 'string') return { kind: 'error', text: err }
  if (err && typeof err === 'object') {
    const meta = err as { code?: number; message?: string; error_data?: { details?: string } }
    const details = meta.error_data?.details ?? ''
    if (meta.code === 131047 || details.toLowerCase().includes('24 hours')) {
      return { kind: 'warning', text: 'Fuera de la ventana de 24 horas: espera a que el contacto escriba o usa una plantilla.' }
    }
    return { kind: 'error', text: `Error de Meta (${meta.code ?? '?'}): ${meta.message ?? 'desconocido'}${details ? ` — ${details}` : ''}` }
  }
  return { kind: 'error', text: 'Error desconocido al enviar el mensaje' }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === new Date().toDateString()) return time
  return `${date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${time}`
}

export default function Conversation({ contact }: Props) {
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
        if (error) setLoadError(`No se pudieron cargar los mensajes: ${error.message}`)
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
    else setNotice(noticeFromError(result.data))
  }

  async function handleSendTemplate() {
    if (sending) return
    setSending(true)
    setNotice(null)
    const result = await sendWhatsApp({
      to: contact.phone, type: 'template', template: 'hello_world', language: 'en_US', components: [],
    })
    setSending(false)
    if (!result.ok) setNotice(noticeFromError(result.data))
  }

  // La ventana de servicio de 24 h se abre cuando el contacto escribe. Fuera de
  // ella WhatsApp NO permite texto libre: hay que iniciar con una plantilla.
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
          {contact.opt_in ? 'Opt-in' : 'Sin consentimiento'}
        </Badge>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-5">
        {loading && <p className="text-sm text-muted-foreground">Cargando mensajes…</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin mensajes todavía.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
              m.direction === 'outbound' ? 'rounded-br-sm bg-secondary text-secondary-foreground' : 'rounded-bl-sm bg-card',
            )}>
              <p className="whitespace-pre-wrap break-words">{m.body ?? <em>[{m.type ?? 'sin contenido'}]</em>}</p>
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

      {/* Fuera de la ventana de 24 h: no se puede escribir texto libre, solo iniciar con plantilla. */}
      {!ventanaAbierta && (
        <div className="mx-5 mb-1 flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>{contact.name ?? 'Este contacto'}</strong> aún no te ha escrito, así que WhatsApp
            no deja enviarle texto libre. Pulsa <strong>«Enviar 1r mensaje»</strong> para hacer el primer
            contacto; cuando responda se abre la ventana de 24 h y ya podrás escribirle.
            {' '}<em>En el entorno de test la plantilla es «hello_world»; una de bienvenida propia requiere aprobarla en Meta.</em>
          </span>
        </div>
      )}

      <footer className="flex items-center gap-2 border-t bg-card px-5 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={ventanaAbierta ? 'outline' : 'default'}
              onClick={handleSendTemplate} disabled={sending}>
              {ventanaAbierta ? 'Plantilla' : 'Enviar 1r mensaje'}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-center">
            WhatsApp no te deja escribir tú primero. Este botón envía una <strong>plantilla aprobada</strong>
            {' '}(en el entorno de test, «hello_world») para hacer el primer contacto. Cuando la persona
            responda, se abre la ventana de 24 h y ya podrás escribirle con normalidad.
          </TooltipContent>
        </Tooltip>
        <form className="flex flex-1 gap-2" onSubmit={handleSendText}>
          <Input
            placeholder={ventanaAbierta ? 'Escribe un mensaje…' : 'Primero inicia con la plantilla…'}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            disabled={sending || !ventanaAbierta} />
          <Button type="submit" disabled={sending || !draft.trim() || !ventanaAbierta}>
            {sending ? 'Enviando…' : 'Enviar'}
          </Button>
        </form>
      </footer>
    </main>
  )
}
