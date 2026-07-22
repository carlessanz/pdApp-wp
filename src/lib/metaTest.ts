// Lista de números de prueba de Meta (whitelist de destinatarios).
//
// El entorno de test de la Cloud API solo entrega a ≤5 números dados de alta a
// mano en el panel de Meta; no hay API para consultarlos, así que la app guarda
// su propia copia en `meta_test_recipients` y la usa para saber quién puede
// recibir. Ver AGENTS.md §9/§12.

import { supabase } from './supabase'

export interface MetaTestRecipient {
  phone: string
  etiqueta: string | null
  created_at: string
}

// Devuelve los números de la lista como Set, para comprobar pertenencia en O(1).
export async function cargarNumerosTest(): Promise<Set<string>> {
  const { data, error } = await supabase.from('meta_test_recipients').select('phone')
  if (error) {
    console.error('meta_test_recipients select:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.phone))
}

// Lista completa (con etiqueta y fecha) para el gestor del Dashboard.
export async function listarNumerosTest(): Promise<MetaTestRecipient[]> {
  const { data, error } = await supabase
    .from('meta_test_recipients')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('meta_test_recipients list:', error.message)
    return []
  }
  return data ?? []
}

export async function anadirNumeroTest(phone: string, etiqueta: string): Promise<string | null> {
  const limpio = phone.replace(/\D/g, '')
  if (!/^[1-9]\d{6,14}$/.test(limpio)) {
    return 'Teléfono no válido. Usa E.164 sin «+» (ej. 34612345678).'
  }
  const { error } = await supabase
    .from('meta_test_recipients')
    .insert({ phone: limpio, etiqueta: etiqueta.trim() || null })
  if (error) {
    return error.message.includes('duplicate') || error.code === '23505'
      ? 'Ese número ya está en la lista.'
      : error.message
  }
  return null
}

export async function borrarNumeroTest(phone: string): Promise<void> {
  const { error } = await supabase.from('meta_test_recipients').delete().eq('phone', phone)
  if (error) console.error('meta_test_recipients delete:', error.message)
}
