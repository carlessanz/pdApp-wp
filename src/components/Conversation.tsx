import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import type { WaContact, WaMessage } from '../types'

interface Props {
  contact: WaContact
}

interface Notice {
  kind: 'error' | 'warning'
  text: string
}

// Traduce la respuesta de error (de la Edge Function o de la Graph API) a un aviso legible.
// El código 131047 de Meta es el de re-engagement: fuera de la ventana de 24 horas.
function noticeFromError(data: unknown): Notice {
  const payload = data as { error?: unknown; code?: string } | null
  const err = payload?.error

  // Códigos propios de whatsapp-send (reglas de envío y autorización).
  switch (payload?.code) {
    case 'window_closed':
      return {
        kind: 'warning',
        text:
          'Fuera de la ventana de 24 horas: WhatsApp solo permite texto libre después de que ' +
          'el contacto haya escrito. Inicia la conversación con la plantilla o espera su respuesta.',
      }
    case 'no_opt_in':
      return {
        kind: 'warning',
        text:
          'Este contacto no ha dado su consentimiento (opt-in), así que no se le puede enviar ' +
          'una plantilla. Puede darlo escribiendo ALTA por WhatsApp.',
      }
    case 'unknown_contact':
      return { kind: 'error', text: 'El contacto no existe todavía en la base de datos.' }
    case 'unauthorized':
      return {
        kind: 'error',
        text:
          'La consola no está autorizada a enviar. Revisa que VITE_WA_SEND_API_KEY en .env.local ' +
          'coincida con el secreto WHATSAPP_SEND_API_KEY y reinicia el servidor de Vite.',
      }
  }

  if (typeof err === 'string') {
    return { kind: 'error', text: err }
  }
  if (err && typeof err === 'object') {
    const meta = err as { code?: number; message?: string; error_data?: { details?: string } }
    const details = meta.error_data?.details ?? ''
    if (meta.code === 131047 || details.toLowerCase().includes('24 hours')) {
      return {
        kind: 'warning',
        text:
          'Fuera de la ventana de 24 horas: WhatsApp solo permite texto libre después de que ' +
          'el contacto haya escrito. Inicia la conversación con la plantilla o espera su respuesta.',
      }
    }
    return {
      kind: 'error',
      text: `Error de Meta (${meta.code ?? '?'}): ${meta.message ?? 'desconocido'}${
        details ? ` — ${details}` : ''
      }`,
    }
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

    supabase
      .from('wa_messages')
      .select('id, wa_message_id, contact_phone, direction, type, body, status, created_at')
      .eq('contact_phone', contact.phone)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setLoadError(`No se pudieron cargar los mensajes: ${error.message}`)
        else setMessages((data as WaMessage[]) ?? [])
        setLoading(false)
      })

    // Realtime: los INSERT de este contacto (entrantes por el webhook,
    // salientes por whatsapp-send) aparecen al instante.
    const channel = supabase
      .channel(`wa-messages-${contact.phone}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'wa_messages',
          filter: `contact_phone=eq.${contact.phone}`,
        },
        (payload) => {
          const message = payload.new as WaMessage
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message],
          )
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [contact.phone])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      to: contact.phone,
      type: 'template',
      template: 'hello_world',
      language: 'en_US',
      components: [],
    })
    setSending(false)
    if (!result.ok) setNotice(noticeFromError(result.data))
  }

  return (
    <main className="chat">
      <header className="chat-header">
        <div>
          <h2>{contact.name ?? contact.phone}</h2>
          {contact.name && <span className="contact-phone">{contact.phone}</span>}
        </div>
        <span className={`optin-badge ${contact.opt_in ? 'optin-yes' : 'optin-no'}`}>
          {contact.opt_in ? 'Opt-in' : 'Sin consentimiento'}
        </span>
      </header>

      <div className="messages">
        {loading && <p className="hint">Cargando mensajes…</p>}
        {loadError && <div className="notice notice-error">{loadError}</div>}
        {!loading && !loadError && messages.length === 0 && (
          <p className="hint">
            Sin mensajes todavía. Inicia la conversación con la plantilla si el contacto aún
            no te ha escrito.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`bubble-row ${message.direction}`}>
            <div className={`bubble ${message.direction}`}>
              <p>{message.body ?? <em>[{message.type ?? 'sin contenido'}]</em>}</p>
              <span className="bubble-meta">
                {formatTime(message.created_at)}
                {message.direction === 'outbound' && message.status && (
                  <> · {message.status}</>
                )}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {notice && <div className={`notice notice-${notice.kind}`}>{notice.text}</div>}

      <footer className="composer">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSendTemplate}
          disabled={sending}
          title="Envía la plantilla hello_world para abrir la ventana de 24 horas"
        >
          Iniciar con plantilla
        </button>
        <form className="composer-form" onSubmit={handleSendText}>
          <input
            type="text"
            placeholder="Escribe un mensaje…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sending}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
      </footer>
    </main>
  )
}
