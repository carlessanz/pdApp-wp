-- Respuestas de las entidades a las ofertas (flujo de aceptación).
--
-- Cuando el panel envía una oferta a una entidad (WhatsApp o email) deja aquí una
-- fila 'pendent'. Si la entidad responde por WhatsApp "sí"/"no", el webhook
-- (procesarRespuestaOferta, _shared/respuestas.ts) la actualiza a
-- 'acceptada'/'rebutjada'. La respuesta se vincula a la ÚLTIMA fila 'pendent' de
-- ese teléfono (la más reciente por enviado_at). Es una tabla DISTINTA de
-- `canalizaciones`: aquella registra kg, esta registra el sí/no de la entidad.

create table if not exists oferta_respuestas (
  id uuid primary key default gen_random_uuid(),
  excedente_id uuid not null references excedentes(id) on delete cascade,
  entidad_id uuid references entidades(id) on delete set null,
  telefono text,                          -- E.164 sin '+', para casar la respuesta entrante
  canal text not null default 'whatsapp' check (canal in ('whatsapp', 'email')),
  estado text not null default 'pendent' check (estado in ('pendent', 'acceptada', 'rebutjada')),
  mensaje_respuesta text,                 -- el texto crudo con que respondió la entidad
  enviado_at timestamptz not null default now(),
  respondido_at timestamptz,
  created_at timestamptz not null default now(),
  -- Reenviar una oferta a la misma entidad actualiza la fila, no la duplica.
  unique (excedente_id, entidad_id)
);

-- El webhook busca la fila 'pendent' más reciente por teléfono.
create index if not exists oferta_respuestas_telefono_estado_idx
  on oferta_respuestas (telefono, estado);

alter table oferta_respuestas enable row level security;

-- El equipo (authenticated) la gestiona desde el panel: registra el envío y
-- puede marcar a mano el estado (imprescindible para las respuestas por email,
-- que no tienen entrada automática). El webhook escribe con service_role.
-- anon no tiene ningún privilegio (coherente con 20260721160000_auth_authenticated).
grant select, insert, update, delete on oferta_respuestas to authenticated;

create policy "authenticated gestiona oferta_respuestas"
  on oferta_respuestas for all to authenticated
  using (true) with check (true);

-- Realtime: el detalle de la oferta ve la respuesta en cuanto llega.
alter publication supabase_realtime add table oferta_respuestas;
