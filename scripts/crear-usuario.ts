// Alta de usuarios de la consola.
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/crear-usuario.ts <email> [contraseña]
//
// Si no se pasa contraseña, se genera una y se muestra por pantalla (solo esa vez).
//
// NO ENVÍA NINGÚN CORREO. Usa la Admin API con `email_confirm: true`, que da el
// email por verificado sin mandar nada. Los flujos que sí enviarían correo
// (`inviteUserByEmail`, magic links, recuperación de contraseña) no se usan
// deliberadamente mientras estemos en pruebas.
//
// El registro público está desactivado (config.toml → enable_signup = false),
// así que esta es la única vía de crear cuentas.

import { createClient } from "npm:@supabase/supabase-js@2";

const [email, passwordArg] = Deno.args;

if (!email) {
  console.error("Uso: deno run -A scripts/crear-usuario.ts <email> [contraseña]");
  Deno.exit(1);
}

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  console.error("La secret key (sb_secret_...) está en el Dashboard → Settings → API Keys.");
  Deno.exit(1);
}

function generarPassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  const chars = [...bytes].map((b) => abc[b % abc.length]);
  // En grupos de cinco, para poder dictarla sin errores.
  return [0, 5, 10].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

const password = passwordArg ?? generarPassword();
const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // <- da el email por verificado y evita el correo
});

if (error) {
  if (error.message.toLowerCase().includes("already")) {
    console.error(`Ya existe un usuario con el email ${email}.`);
    console.error("Para cambiarle la contraseña, hazlo desde el Dashboard → Authentication.");
  } else {
    console.error("No se pudo crear el usuario:", error.message);
  }
  Deno.exit(1);
}

console.log(`\nUsuario creado: ${data.user.email}`);
console.log(`Email verificado sin enviar ningún correo: ${data.user.email_confirmed_at ? "sí" : "NO"}`);
if (!passwordArg) {
  console.log("\n  ┌──────────────────────────────────────────┐");
  console.log(`    Contraseña: ${password}`);
  console.log("  └──────────────────────────────────────────┘");
  console.log("  Guárdala ahora: no se vuelve a mostrar.\n");
}
