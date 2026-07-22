// Llamada a la Edge Function enviar-email, firmada con la sesión. Nunca lanza.

import { supabase, supabaseUrl } from './supabase'

export interface EmailPayload {
  to: string
  subject: string
  html?: string
  text?: string
}

export interface EmailResult {
  ok: boolean
  status: number
  data: unknown
}

export async function enviarEmail(payload: EmailPayload): Promise<EmailResult> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      return { ok: false, status: 401, data: { code: 'unauthorized', error: 'Tu sesión ha caducado.' } }
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/enviar-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body: unknown = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data: body }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: { error: `No se pudo contactar con la función de email: ${err instanceof Error ? err.message : String(err)}` },
    }
  }
}
