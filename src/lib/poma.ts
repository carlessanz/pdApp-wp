// Llamada a la Edge Function priorizar-entidades, firmada con la sesión.
// Igual que sendWhatsApp: nunca lanza, devuelve el error en el resultado.

import { supabase, supabaseUrl } from './supabase'

export interface EntidadPuntuada {
  id: string
  nombre: string
  poblacion: string | null
  telefono: string | null
  opt_in: boolean
  puntuacion: number
  motivos: string[]
  pendiente: boolean
}

export interface PriorizacionResult {
  ok: boolean
  ranking: EntidadPuntuada[]
  error: string | null
}

export async function priorizarEntidades(excedenteId: string): Promise<PriorizacionResult> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      return { ok: false, ranking: [], error: 'Sesión caducada. Vuelve a entrar.' }
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/priorizar-entidades`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ excedente_id: excedenteId }),
    })
    const body = (await res.json().catch(() => null)) as
      | { ranking?: EntidadPuntuada[]; error?: string }
      | null
    if (!res.ok) {
      return { ok: false, ranking: [], error: body?.error ?? `Error ${res.status}` }
    }
    return { ok: true, ranking: body?.ranking ?? [], error: null }
  } catch (err) {
    return {
      ok: false,
      ranking: [],
      error: `No se pudo priorizar: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
