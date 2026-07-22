// Escribe un valor en la tabla app_config (clave/valor solo para service_role).
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/set-config.ts <key> <value>
//
// Se usa para secretos que un job de la base necesita y que NO pueden vivir en git
// (p. ej. `recordatorios_secret`, el que el cron pasa a la Edge Function
// intake-recordatorios). Ver AGENTS.md §4/§5. Requiere la service key porque
// app_config está bloqueada para authenticated/anon.

import { createClient } from "npm:@supabase/supabase-js@2";

const [key, value] = Deno.args;

if (!key || value === undefined) {
  console.error("Uso: deno run -A scripts/set-config.ts <key> <value>");
  Deno.exit(1);
}

const url = Deno.env.get("SUPABASE_URL");
const secret = Deno.env.get("SB_SECRET_KEY");
if (!url || !secret) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { error } = await admin
  .from("app_config")
  .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

if (error) {
  console.error("No se pudo escribir en app_config:", error.message);
  Deno.exit(1);
}

console.log(`app_config['${key}'] actualizado (${value.length} caracteres).`);
