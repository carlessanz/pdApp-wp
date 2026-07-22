// Definiciones de los campos editables de productores y entidades, para el
// formulario genérico de RecordDetail. El orden es el que se ve en pantalla.

export type CampoTipo =
  | 'text'
  | 'tel'
  | 'email'
  | 'textarea'
  | 'number'
  | 'bool' // boolean no nulo (Sí/No)
  | 'boolnull' // boolean que admite «sin definir» (—/Sí/No)
  | 'list' // text[] separado por comas

export interface CampoDef {
  key: string
  label: string
  tipo?: CampoTipo // por defecto 'text'
  ancho?: 'full' // ocupa las dos columnas
}

// productores (ver src/types.ts). id y created_at no se editan.
export const PRODUCTOR_CAMPOS: CampoDef[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'phone', label: 'Teléfono (E.164 sin +, 34…)', tipo: 'tel' },
  { key: 'telefono_alt', label: 'Teléfono alternativo', tipo: 'tel' },
  { key: 'email', label: 'Email', tipo: 'email' },
  { key: 'nif', label: 'NIF' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'codigo_postal', label: 'Código postal' },
  { key: 'poblacion', label: 'Población' },
  { key: 'area_geografica', label: 'Área geográfica' },
  { key: 'tipo_empresa', label: 'Tipo de empresa' },
  { key: 'codigo', label: 'Código' },
  { key: 'conveni', label: 'Conveni' },
  { key: 'visitado', label: 'Visitado' },
  { key: 'data_alta', label: 'Data alta' },
  { key: 'productos_habituales', label: 'Productos habituales (separa con comas)', tipo: 'list', ancho: 'full' },
  { key: 'comentario', label: 'Comentario', tipo: 'textarea', ancho: 'full' },
  { key: 'activo', label: 'Activo', tipo: 'bool' },
]

// entidades (ver src/types.ts). id y created_at no se editan.
export const ENTIDAD_CAMPOS: CampoDef[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'codigo', label: 'Código' },
  { key: 'familia', label: 'Família' },
  { key: 'prioritat', label: 'Prioritat', tipo: 'number' },
  { key: 'estat', label: 'Estat' },
  { key: 'gestio', label: 'Gestió' },
  { key: 'area_geografica', label: 'Área geográfica' },
  { key: 'poblacion', label: 'Población' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'codigo_postal', label: 'Código postal' },
  { key: 'nif', label: 'NIF' },
  { key: 'telefono', label: 'Teléfono', tipo: 'tel' },
  { key: 'telefono2', label: 'Teléfono 2', tipo: 'tel' },
  { key: 'telefono3', label: 'Teléfono 3', tipo: 'tel' },
  { key: 'email', label: 'Email', tipo: 'email' },
  { key: 'email2', label: 'Email 2', tipo: 'email' },
  { key: 'contacto', label: 'Contacto' },
  { key: 'contacto2', label: 'Contacto 2' },
  { key: 'horario', label: 'Horario' },
  { key: 'calendari_repartiment', label: 'Calendari repartiment' },
  { key: 'data_alta', label: 'Data alta' },
  { key: 'productes_frescos', label: 'Accepta frescos', tipo: 'boolnull' },
  { key: 'productes_frescos_txt', label: 'Frescos (text original)' },
  { key: 'transport_plataforma', label: 'Transport plataforma', tipo: 'boolnull' },
  { key: 'transport_plataforma_txt', label: 'Transport (text original)' },
  { key: 'descarrega_toro', label: 'Descàrrega amb toro', tipo: 'boolnull' },
  { key: 'descarrega_toro_txt', label: 'Descàrrega (text original)' },
  { key: 'comentarios', label: 'Comentarios', tipo: 'textarea', ancho: 'full' },
  { key: 'opt_in', label: 'Opt-in (consentiment)', tipo: 'bool' },
]
