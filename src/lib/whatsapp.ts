import { supabase, supabaseUrl } from './supabase'

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
// Va firmada con el token de la sesión de Supabase Auth: la función se despliega
// con verificación de JWT y rechaza cualquier petición sin sesión.
export async function sendWhatsApp(payload: SendPayload): Promise<SendResult> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      return {
        ok: false,
        status: 401,
        data: {
          code: 'unauthorized',
          error: 'Tu sesión ha caducado. Vuelve a entrar para enviar mensajes.',
        },
      }
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body: unknown = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data: body }
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
