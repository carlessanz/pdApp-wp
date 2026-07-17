import { createClient } from '@supabase/supabase-js'

// Nuevas claves de Supabase: publishable key (sb_publishable_...) en el frontend.
// NO usar la anon key obsoleta.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

if (!supabaseUrl || !publishableKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY. Rellena .env.local y reinicia el servidor de Vite.',
  )
}

export const supabase = createClient(supabaseUrl, publishableKey)
