-- Modelo de datos de POMA (canalización de excedentes agrícolas).
-- Una OFERTA de excedente (id_excedente único) se reparte en varias CANALIZACIONES,
-- una por entidad receptora. Replica la pestaña "Aprofitat" del Excel ARA.

-- ---------------------------------------------------------------------------
-- 1. Ampliación de productores (ya existente; NO se recrea)
-- ---------------------------------------------------------------------------
alter table productores
  add column empresa text,
  add column codigo text,
  add column comentario text,
  add column visitado text,
  add column conveni text,
  add column tipo_empresa text,
  add column telefono_alt text,
  add column direccion text,
  add column codigo_postal text,
  add column nif text,
  add column area_geografica text,
  add column poblacion text,
  add column productos_habituales text[],
  add column data_alta date,
  add column activo boolean default true;

-- 58 de los 339 productores del Excel no tienen teléfono utilizable y aun así
-- queremos conservar su ficha (sin teléfono no podrán usar el intake, nada más).
alter table productores alter column phone drop not null;

-- ---------------------------------------------------------------------------
-- 2. Tablas nuevas
-- ---------------------------------------------------------------------------

-- Un productor puede tener varias ubicaciones de recogida.
create table productor_ubicaciones (
  id uuid primary key default gen_random_uuid(),
  productor_id uuid references productores,
  alias text,
  gmaps_url text,
  coord_lat numeric,
  coord_lng numeric,
  municipio text,
  es_principal boolean default false
);

-- Entidades sociales receptoras (hoja SDA del Excel).
create table entidades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text,
  familia text,
  prioritat int,
  estat text,
  gestio text,
  comentarios text,
  area_geografica text,
  poblacion text,
  direccion text,
  codigo_postal text,
  horario text,
  nif text,
  telefono text,
  telefono2 text,
  telefono3 text,
  email text,
  email2 text,
  contacto text,
  contacto2 text,
  calendari_repartiment text,
  -- Los tres campos de capacidad vienen como texto libre en el Excel
  -- ("Si (Punt solidari)", "1 furgo", "NO"): se conserva el original y se
  -- deriva el boolean, que queda null cuando el texto no es concluyente.
  productes_frescos boolean,
  productes_frescos_txt text,
  transport_plataforma boolean,
  transport_plataforma_txt text,
  descarrega_toro boolean,
  descarrega_toro_txt text,
  data_alta text,
  opt_in boolean default false,
  created_at timestamptz default now()
);

-- Cabecera de la oferta de excedente.
create table excedentes (
  id uuid primary key default gen_random_uuid(),
  id_excedente text unique,
  productor_id uuid references productores,
  ubicacion_id uuid references productor_ubicaciones,
  familia text,
  producto text,
  variedad text,
  kg_total numeric,
  num_caixes int,
  tipo_caixa text,
  retorn_envasos text,
  modalitat text check (modalitat in ('donacio', 'venda', 'maquila')),
  causa text,
  causa_codigo text,
  disponible_desde date,
  disponible_hasta date,
  horari_recollida text,
  responsable text,
  observacions text,
  valor_eur numeric,
  texto_oferta text,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'publicada', 'parcial', 'bloqueada', 'cerrada', 'no_colocada')),
  motivo_no_colocada text,
  created_at timestamptz default now()
);

-- Detalle por entidad: cuántos kg se lleva cada una de una oferta.
create table canalizaciones (
  id uuid primary key default gen_random_uuid(),
  excedente_id uuid references excedentes,
  entidad_id uuid references entidades,
  kg_confirmados numeric,
  kg_reales numeric,
  caixes_entregades int,
  caixes_retornades int,
  data_hora_recollida timestamptz,
  albaran_aprofitat text,
  albaran_entrada text,
  firmado_entidad boolean default false,
  firmado_productor boolean default false,
  comentarios text,
  estado text default 'confirmada',
  created_at timestamptz default now()
);

-- Estado del intake conversacional por WhatsApp (máquina de estados).
create table intake_sessions (
  id uuid primary key default gen_random_uuid(),
  telefono text,
  productor_id uuid references productores,
  paso_actual text,
  datos_parciales jsonb default '{}',
  excedente_id uuid references excedentes,
  updated_at timestamptz default now()
);

-- Listas maestras (se importan de scripts/data/*.csv con scripts/import-ara.ts).
create table productos (
  nombre text primary key,
  familia text,
  eur_kg numeric default 1
);

create table causas (
  codigo text primary key,
  nombre text
);

-- Conversión de unidades/manats a kg. Los nombres NO casan con el catálogo
-- productos (van en mayúsculas y con variantes): es tabla de consulta, no FK.
create table factores_conversion (
  producto text primary key,
  kg_por_unidad numeric
);

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
create index canalizaciones_excedente_id_idx on canalizaciones (excedente_id);
create index intake_sessions_telefono_idx on intake_sessions (telefono);
create index excedentes_estado_idx on excedentes (estado);
create index entidades_area_geografica_idx on entidades (area_geografica);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- Mismo patrón que las tablas existentes: acceso total para las Edge Functions
-- y solo lectura para anon.
-- TODO: restringir con auth antes de producción (pasar anon -> authenticated).
-- ---------------------------------------------------------------------------
alter table productor_ubicaciones enable row level security;
alter table entidades enable row level security;
alter table excedentes enable row level security;
alter table canalizaciones enable row level security;
alter table intake_sessions enable row level security;
alter table productos enable row level security;
alter table causas enable row level security;
alter table factores_conversion enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'productor_ubicaciones', 'entidades', 'excedentes', 'canalizaciones',
    'intake_sessions', 'productos', 'causas', 'factores_conversion'
  ]
  loop
    execute format(
      'create policy "service_role acceso total" on %I for all to service_role
         using (true) with check (true)', t);
    execute format(
      'create policy "anon puede leer" on %I for select to anon using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table excedentes, canalizaciones;
