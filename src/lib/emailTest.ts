// Lista de correos de prueba para el canal de email (Resend). Análogo a metaTest.ts.
// Ver AGENTS.md §4/§8.

import { supabase } from './supabase'

export interface EmailTestRecipient {
  email: string
  etiqueta: string | null
  created_at: string
}

export async function cargarEmailsTest(): Promise<Set<string>> {
  const { data, error } = await supabase.from('email_test_recipients').select('email')
  if (error) {
    console.error('email_test_recipients select:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.email.toLowerCase()))
}

export async function listarEmailsTest(): Promise<EmailTestRecipient[]> {
  const { data, error } = await supabase
    .from('email_test_recipients')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('email_test_recipients list:', error.message)
    return []
  }
  return data ?? []
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function anadirEmailTest(email: string, etiqueta: string): Promise<string | null> {
  const limpio = email.trim().toLowerCase()
  if (!EMAIL_RE.test(limpio)) return 'Email no válido.'
  const { error } = await supabase
    .from('email_test_recipients')
    .insert({ email: limpio, etiqueta: etiqueta.trim() || null })
  if (error) {
    return error.code === '23505' ? 'Ese email ya está en la lista.' : error.message
  }
  return null
}

export async function borrarEmailTest(email: string): Promise<void> {
  const { error } = await supabase.from('email_test_recipients').delete().eq('email', email)
  if (error) console.error('email_test_recipients delete:', error.message)
}
