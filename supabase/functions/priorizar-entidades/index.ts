// Priorización de entidades para un excedente.
// POST { excedente_id } -> ranking de entidades candidatas con puntuación y motivos.
//
// No envía nada. Requiere sesión de Supabase Auth (mismo esquema que whatsapp-send:
// se despliega SIN --no-verify-jwt y además se comprueba getUser).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { priorizar } from "../_shared/priorizacion.ts";
import type { EntidadPriorizable, ExcedenteContexto } from "../_shared/priorizacion.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

function originPermitido(origin: string): boolean {
  return ALLOWED_ORIGINS.some((patron) => {
    if (!patron.includes("*")) return patron === origin;
    const re = new RegExp(
      "^" + patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[A-Za-z0-9-]+") + "$",
    );
    return re.test(origin);
  });
}

function corsPara(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": originPermitido(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // La plataforma valida la firma del JWT; aquí se confirma que hay un usuario real.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  try {
    const { excedente_id } = await req.json();
    if (!excedente_id || typeof excedente_id !== "string") {
      return json({ error: "Falta 'excedente_id'" }, 400);
    }

    const { data: excedente, error: exError } = await supabase
      .from("excedentes")
      .select("familia, producto, kg_total, ubicacion_id, productor_id")
      .eq("id", excedente_id)
      .maybeSingle();
    if (exError) {
      console.error("excedentes select:", exError.message);
      return json({ error: "Error consultando el excedente" }, 500);
    }
    if (!excedente) return json({ error: "Excedente no encontrado" }, 404);

    // El área/población de referencia salen de la ubicación del excedente y, si no,
    // de la ficha del productor.
    let area: string | null = null;
    let poblacion: string | null = null;
    if (excedente.ubicacion_id) {
      const { data: u } = await supabase
        .from("productor_ubicaciones").select("municipio").eq("id", excedente.ubicacion_id).maybeSingle();
      poblacion = u?.municipio ?? null;
    }
    if (excedente.productor_id) {
      const { data: p } = await supabase
        .from("productores").select("area_geografica, poblacion").eq("id", excedente.productor_id).maybeSingle();
      area = p?.area_geografica ?? null;
      poblacion = poblacion ?? p?.poblacion ?? null;
    }

    const { data: entidades, error: entError } = await supabase
      .from("entidades")
      .select(
        "id, nombre, poblacion, telefono, opt_in, area_geografica, estat, prioritat, " +
          "productes_frescos, transport_plataforma, descarrega_toro",
      );
    if (entError) {
      console.error("entidades select:", entError.message);
      return json({ error: "Error consultando las entidades" }, 500);
    }

    const contexto: ExcedenteContexto = {
      familia: excedente.familia,
      area_geografica: area,
      poblacion,
      kg_total: excedente.kg_total,
    };
    const ranking = priorizar(
      (entidades ?? []) as unknown as EntidadPriorizable[],
      contexto,
    );

    return json({ excedente_id, contexto, ranking });
  } catch (err) {
    console.error("priorizar-entidades:", err instanceof Error ? err.message : String(err));
    return json({ error: "Error interno o JSON inválido" }, 500);
  }
});
