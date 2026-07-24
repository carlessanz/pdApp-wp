-- El panel (rol `authenticated`) gestiona canalizaciones y actualiza el estado de
-- los excedentes, pero ambas tablas solo tenían política RLS de SELECT para
-- `authenticated` (más `service_role` total). Por eso, al pulsar «Aprovar i
-- canalitzar» (o «Afegir canalització»), el INSERT en `canalizaciones` fallaba con
--   new row violates row-level security policy for table "canalizaciones"
-- y lo mismo habría pasado con el UPDATE de `excedentes.estado` (cancelar, marcar
-- no_colocada, bloquear al cubrir los kg, guardar «disponible fins»).
--
-- Se añaden las políticas que faltaban (con los grants explícitos, idempotentes).
-- Como aún no hay roles (deuda §12.2), cualquier `authenticated` puede hacerlo;
-- al introducir roles habrá que restringir estas políticas al superadmin/técnico.

-- Canalizaciones: el panel las crea (alta y aprobación de aceptaciones), edita
-- (kg reales, albaranes) y podría borrarlas → gestión completa.
grant insert, update, delete on canalizaciones to authenticated;

create policy "authenticated gestiona canalizaciones"
  on canalizaciones for all to authenticated using (true) with check (true);

-- Excedentes: el panel no los crea (los da de alta el webhook vía service_role en
-- el intake) pero sí los actualiza (estado, disponible_hasta, motivo).
grant update on excedentes to authenticated;

create policy "authenticated actualitza excedentes"
  on excedentes for update to authenticated using (true) with check (true);
