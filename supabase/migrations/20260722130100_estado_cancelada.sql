-- Nuevo estado 'cancelada' para las ofertas ya creadas.
--
-- Un excedente que el productor cancela (o que el técnico anula desde el panel) ya
-- no debe seguir "publicada" ni confundirse con "no_colocada" (que es no haber
-- encontrado destino). Se amplía el check de estados con 'cancelada'.
-- (Un intake a medias no llega aquí: se borra la sesión sin crear excedente.)

alter table excedentes drop constraint if exists excedentes_estado_check;
alter table excedentes add constraint excedentes_estado_check
  check (estado in (
    'borrador', 'publicada', 'parcial', 'bloqueada', 'cerrada', 'no_colocada', 'cancelada'
  ));
