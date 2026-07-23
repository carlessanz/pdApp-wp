-- Flujo de aceptación de ofertas: la entidad acepta indicando kg (+ preu) y el
-- superadmin la aprueba, convirtiéndola en una canalización.
--
-- Dos ejes en oferta_respuestas:
--   estado    = respuesta de la ENTIDAD   (pendent/acceptada/rebutjada)  [ya existía]
--   aprovacio = decisión del SUPERADMIN   (pendent/aprovada/rebutjada)   [nuevo]
-- Al aprobar se crea una fila en `canalizaciones` y se enlaza (canalizacion_id).
--
-- El diálogo de aceptación por WhatsApp (SÍ → kg → confirmar preu) guarda su
-- estado en dialeg_pas/dialeg_dades, igual que intake_sessions para el intake.
-- Mientras el diálogo está en curso la fila sigue 'pendent' (así el webhook la
-- sigue encontrando como "última pendent" del teléfono); al terminar pasa a
-- 'acceptada'/'rebutjada'.

-- Precio mínimo que fija el productor en el intake (solo venda/maquila; €/kg).
alter table excedentes add column if not exists preu_minim numeric;

-- Datos de la aceptación de la entidad + aprobación del superadmin + diálogo.
alter table oferta_respuestas
  add column if not exists kg_solicitados numeric,
  add column if not exists caixes_solicitades int,
  add column if not exists preu_ofert numeric,
  add column if not exists aprovacio text not null default 'pendent',
  add column if not exists aprovat_at timestamptz,
  add column if not exists motiu_aprovacio text,
  add column if not exists canalizacion_id uuid references canalizaciones(id) on delete set null,
  add column if not exists dialeg_pas text,
  add column if not exists dialeg_dades jsonb not null default '{}';

-- Check del eje de aprobación (separado e idempotente, por si la columna ya existía).
alter table oferta_respuestas drop constraint if exists oferta_respuestas_aprovacio_check;
alter table oferta_respuestas add constraint oferta_respuestas_aprovacio_check
  check (aprovacio in ('pendent', 'aprovada', 'rebutjada'));

-- La política RLS existente ("authenticated gestiona oferta_respuestas" for all
-- using(true) with check(true)) y los GRANT select/insert/update/delete a
-- authenticated ya cubren las columnas nuevas. Realtime ya está activo en la
-- tabla. El webhook escribe con service_role. No hace falta nada más.
