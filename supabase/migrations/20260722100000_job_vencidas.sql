-- Job de vencidas (POMA, Prompt 8c).
--
-- Marca 'no_colocada' los excedentes cuya fecha de disponibilidad ya venció y que
-- todavía tienen kg sin cubrir. Es la trazabilidad de lo que no se movió.
--
-- Nota: no actúa sobre nada hasta que el panel empiece a normalizar
-- `disponible_hasta` (el intake lo guarda como null porque el productor responde
-- en texto libre). Es correcto: el job simplemente no encuentra candidatos.

create extension if not exists pg_cron;

-- kg pendientes de un excedente = kg_total - suma de kg_confirmados de sus canalizaciones.
create or replace function marcar_excedentes_vencidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  afectados integer;
begin
  with vencidos as (
    select e.id
      from excedentes e
      left join canalizaciones c on c.excedente_id = e.id
     where e.estado in ('borrador', 'publicada', 'parcial')
       and e.disponible_hasta is not null
       -- solo los vencidos hace más de 24 h, para no marcar algo recién caducado
       and e.disponible_hasta < current_date - 1
     group by e.id, e.kg_total
     having coalesce(e.kg_total, 0) - coalesce(sum(c.kg_confirmados), 0) > 0
  )
  update excedentes e
     set estado = 'no_colocada',
         motivo_no_colocada = coalesce(e.motivo_no_colocada, 'vencida sin cubrir')
    from vencidos v
   where e.id = v.id;

  get diagnostics afectados = row_count;
  raise notice 'marcar_excedentes_vencidos: % excedents marcats no_colocada', afectados;
  return afectados;
end;
$$;

-- Programa el job diario a las 06:00. unschedule previo para que la migración sea
-- idempotente si se reaplica.
do $$
begin
  perform cron.unschedule('marcar-vencidas')
    where exists (select 1 from cron.job where jobname = 'marcar-vencidas');
exception when others then null;
end $$;

select cron.schedule('marcar-vencidas', '0 6 * * *', 'select marcar_excedentes_vencidos()');
