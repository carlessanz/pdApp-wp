import { publishableKey, supabaseUrl } from './supabase'

export type SendPayload =
  | { to: string; type: 'text'; body: string }
  | {
      to: string
      type: 'template'
      template: string
      language: string
      components: unknown[]
    }

export interface SendResult {
  ok: boolean
  status: number
  data: unknown
}

// Llama a la Edge Function whatsapp-send. Nunca lanza: devuelve el error en `data`.
export async function sendWhatsApp(payload: SendPayload): Promise<SendResult> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const data: unknown = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {
        error: `No se pudo contactar con la Edge Function: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    }
  }
}
