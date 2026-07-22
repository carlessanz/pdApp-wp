-- Recordatorio de intake a los 10 min (POMA).
--
-- Si un productor deja una oferta a medias, a los 10 minutos se le manda un aviso
-- "Continuar / Cancel·lar". El envío de WhatsApp solo puede hacerse desde una Edge
-- Function (Deno), no desde Postgres. Como en este proyecto la base NO tenía forma
-- de llamar a una función (no había pg_net), aquí se habilita esa vía:
--
--   pg_cron (cada 2 min) → disparar_recordatorios_intake() → net.http_post → Edge
--   Function `intake-recordatorios` → escanea intake_sessions y envía el aviso.
--
-- El secreto compartido que autentica esa llamada NO va en git: se guarda en
-- app_config (fila insertada con la service key) y en el secreto de la función.

-- 1. Marca de recordatorio ya enviado (evita repetir). guardar() la resetea a null
--    en cada actividad, así el aviso salta 10 min tras la ÚLTIMA interacción.
alter table intake_sessions add column if not exists recordatorio_enviado_at timestamptz;

-- 2. pg_net: peticiones HTTP salientes desde la base. pg_cron ya existe (job de vencidas).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3. Config interna clave/valor para secretos que un job necesita y que no pueden
--    vivir en git. SOLO service_role la ve. Ojo: desde 20260721160000 las tablas
--    nuevas heredan SELECT para `authenticated` por default privileges, así que hay
--    que revocarlo explícitamente aquí.
create table if not exists app_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
revoke all on app_config from authenticated;
grant select, insert, update, delete on app_config to service_role;
-- Sin política RLS: authenticated/anon quedan bloqueados por grant y por RLS;
-- service_role salta RLS y es el único que la usa (Edge Functions y el job).

-- 4. Disparador: pg_cron lo ejecuta cada 2 min. Si el secreto no está configurado,
--    no hace nada (la migración es segura de aplicar antes de poner el secreto).
create or replace function disparar_recordatorios_intake()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  secreto text;
begin
  select value into secreto from app_config where key = 'recordatorios_secret';
  if secreto is null or secreto = '' then
    raise notice 'disparar_recordatorios_intake: sense secret configurat, no-op';
    return;
  end if;
  perform net.http_post(
    url := 'https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1/intake-recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recordatorios-secret', secreto
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- 5. Agenda cada 2 minutos (idempotente, como el job de vencidas).
do $$
begin
  perform cron.unschedule('recordatorios-intake')
    where exists (select 1 from cron.job where jobname = 'recordatorios-intake');
exception when others then null;
end $$;

select cron.schedule('recordatorios-intake', '*/2 * * * *', 'select disparar_recordatorios_intake()');
