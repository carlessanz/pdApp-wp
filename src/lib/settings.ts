// Configuración global de la app (tabla `app_settings`). Hoy: el **modo test**, que
// cuando está activo hace que la plataforma solo envíe WhatsApp/email a los usuarios
// marcados `es_test`. Fail-safe igual que en el servidor: ante cualquier duda, ON.

import { supabase } from './supabase'

/** ¿Modo test activo? Solo un `'false'` explícito lo apaga (default ON). */
export async function getTestMode(): Promise<boolean> {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', 'test_mode').maybeSingle()
  return data?.value !== 'false'
}

/** Guarda el modo test. Devuelve el mensaje de error o null. */
export async function setTestMode(activo: boolean): Promise<string | null> {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'test_mode', value: activo ? 'true' : 'false', updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  return error?.message ?? null
}
