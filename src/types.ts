export interface WaContact {
  id: string
  phone: string
  name: string | null
  opt_in: boolean
  opt_in_at: string | null
  opt_out_at: string | null
  /** Última vez que el contacto nos escribió; define la ventana de servicio de 24 h */
  last_inbound_at: string | null
  created_at: string
}

export interface Productor {
  id: string
  name: string
  email: string | null
  /** E.164 sin '+'. Nullable: hay productores del Excel sin teléfono utilizable */
  phone: string | null
  created_at: string
  empresa: string | null
  codigo: string | null
  comentario: string | null
  visitado: string | null
  conveni: string | null
  tipo_empresa: string | null
  /** Teléfonos adicionales encontrados en la misma celda del Excel */
  telefono_alt: string | null
  direccion: string | null
  codigo_postal: string | null
  nif: string | null
  area_geografica: string | null
  poblacion: string | null
  productos_habituales: string[] | null
  data_alta: string | null
  activo: boolean | null
}

export interface WaMessage {
  id: string
  wa_message_id: string | null
  contact_phone: string
  direction: 'inbound' | 'outbound'
  type: string | null
  body: string | null
  status: string | null
  created_at: string
}

export interface ProductorUbicacion {
  id: string
  productor_id: string | null
  alias: string | null
  gmaps_url: string | null
  coord_lat: number | null
  coord_lng: number | null
  municipio: string | null
  es_principal: boolean | null
}

export interface Entidad {
  id: string
  nombre: string
  codigo: string | null
  familia: string | null
  prioritat: number | null
  estat: string | null
  gestio: string | null
  comentarios: string | null
  area_geografica: string | null
  poblacion: string | null
  direccion: string | null
  codigo_postal: string | null
  horario: string | null
  nif: string | null
  telefono: string | null
  telefono2: string | null
  telefono3: string | null
  email: string | null
  email2: string | null
  contacto: string | null
  contacto2: string | null
  calendari_repartiment: string | null
  /** Derivado del texto libre del Excel; null cuando no es concluyente */
  productes_frescos: boolean | null
  productes_frescos_txt: string | null
  transport_plataforma: boolean | null
  transport_plataforma_txt: string | null
  descarrega_toro: boolean | null
  descarrega_toro_txt: string | null
  data_alta: string | null
  opt_in: boolean | null
  created_at: string
}

export type EstadoExcedente =
  | 'borrador'
  | 'publicada'
  | 'parcial'
  | 'bloqueada'
  | 'cerrada'
  | 'no_colocada'

export type Modalitat = 'donacio' | 'venda' | 'maquila'

export interface Excedente {
  id: string
  /** Formato E-AAMMDD-XXX-YYY-N */
  id_excedente: string | null
  productor_id: string | null
  ubicacion_id: string | null
  familia: string | null
  producto: string | null
  variedad: string | null
  kg_total: number | null
  num_caixes: number | null
  tipo_caixa: string | null
  retorn_envasos: string | null
  modalitat: Modalitat | null
  causa: string | null
  causa_codigo: string | null
  disponible_desde: string | null
  disponible_hasta: string | null
  horari_recollida: string | null
  responsable: string | null
  observacions: string | null
  valor_eur: number | null
  texto_oferta: string | null
  estado: EstadoExcedente
  motivo_no_colocada: string | null
  created_at: string
}

export interface Canalizacion {
  id: string
  excedente_id: string | null
  entidad_id: string | null
  kg_confirmados: number | null
  kg_reales: number | null
  caixes_entregades: number | null
  caixes_retornades: number | null
  data_hora_recollida: string | null
  albaran_aprofitat: string | null
  albaran_entrada: string | null
  firmado_entidad: boolean | null
  firmado_productor: boolean | null
  comentarios: string | null
  estado: string | null
  created_at: string
}

export interface IntakeSession {
  id: string
  telefono: string | null
  productor_id: string | null
  paso_actual: string | null
  datos_parciales: Record<string, unknown>
  excedente_id: string | null
  updated_at: string
}

export interface Producto {
  nombre: string
  familia: string | null
  eur_kg: number | null
}

export interface Causa {
  codigo: string
  nombre: string | null
}

export interface FactorConversion {
  producto: string
  kg_por_unidad: number | null
}
