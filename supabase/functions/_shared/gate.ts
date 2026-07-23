// Gate "solo usuarios de prueba" (es_test): fuente de verdad de la app para
// permitir el envío, INDEPENDIENTE de la fase de Meta (AGENTS.md §8). Solo se envía
// a un teléfono/correo que pertenezca a un productor o entidad con es_test = true.
// Lo usan el webhook (respuestas + intake), whatsapp-send (ofertas) y enviar-email.

// deno-lint-ignore no-explicit-any
type Cliente = any;

/** ¿El teléfono es de un productor o entidad marcado es_test? */
export async function esTelefonoTest(supabase: Cliente, to: string): Promise<boolean> {
  const [prod, ent] = await Promise.all([
    supabase.from("productores").select("id").eq("phone", to).eq("es_test", true).limit(1),
    supabase.from("entidades").select("id").eq("telefono", to).eq("es_test", true).limit(1),
  ]);
  return (prod.data ?? []).length > 0 || (ent.data ?? []).length > 0;
}

/** ¿El correo es de una entidad marcada es_test? (email no es único en entidades) */
export async function esEmailTest(supabase: Cliente, email: string): Promise<boolean> {
  const { data } = await supabase
    .from("entidades").select("id").ilike("email", email).eq("es_test", true).limit(1);
  return (data ?? []).length > 0;
}

/**
 * ¿Está activo el "modo test" global? (`app_settings.test_mode`, gestionado desde
 * Configuración). Si lo está, la app SOLO envía a los usuarios `es_test`.
 * **Fail-safe**: si falta la fila o hay error de lectura, devuelve `true` (se
 * comporta como activo: NO se envía a no-test). Solo un `'false'` explícito lo apaga.
 */
export async function modoTestActivo(supabase: Cliente): Promise<boolean> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "test_mode").maybeSingle();
  return data?.value !== "false";
}
