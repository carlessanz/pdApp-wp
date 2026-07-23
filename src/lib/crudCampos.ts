// Definiciones de los campos editables de productores y entidades, para el
// formulario genérico de RecordDetail. `label` es una CLAVE i18n (ver lib/i18n).
// El orden es el que se ve en pantalla.

export type CampoTipo =
  | 'text'
  | 'tel'
  | 'email'
  | 'textarea'
  | 'number'
  | 'bool' // boolean no nulo (Sí/No)
  | 'boolnull' // boolean que admite «sin definir» (—/Sí/No)
  | 'list' // text[] separado por comas
  | 'select' // desplegable con opciones fijas (usa `opciones`)

export interface CampoDef {
  key: string
  label: string // clave i18n (f.*)
  tipo?: CampoTipo // por defecto 'text'
  opciones?: string[] // valores del desplegable cuando tipo === 'select'
  ancho?: 'full' // ocupa las dos columnas
}

// productores (ver src/types.ts). id y created_at no se editan.
export const PRODUCTOR_CAMPOS: CampoDef[] = [
  { key: 'name', label: 'f.name' },
  { key: 'empresa', label: 'f.empresa' },
  { key: 'phone', label: 'f.phone', tipo: 'tel' },
  { key: 'telefono_alt', label: 'f.telefono_alt', tipo: 'tel' },
  { key: 'email', label: 'f.email', tipo: 'email' },
  { key: 'nif', label: 'f.nif' },
  { key: 'direccion', label: 'f.direccion' },
  { key: 'codigo_postal', label: 'f.codigo_postal' },
  { key: 'poblacion', label: 'f.poblacion' },
  { key: 'area_geografica', label: 'f.area_geografica' },
  { key: 'tipo_empresa', label: 'f.tipo_empresa' },
  { key: 'codigo', label: 'f.codigo' },
  { key: 'conveni', label: 'f.conveni' },
  { key: 'visitado', label: 'f.visitado' },
  { key: 'data_alta', label: 'f.data_alta' },
  { key: 'productos_habituales', label: 'f.productos_habituales', tipo: 'list', ancho: 'full' },
  { key: 'comentario', label: 'f.comentario', tipo: 'textarea', ancho: 'full' },
  { key: 'activo', label: 'f.activo', tipo: 'bool' },
  { key: 'es_test', label: 'f.es_test', tipo: 'bool' },
]

// entidades (ver src/types.ts). id y created_at no se editan.
export const ENTIDAD_CAMPOS: CampoDef[] = [
  { key: 'nombre', label: 'f.nombre' },
  { key: 'codigo', label: 'f.codigo' },
  { key: 'familia', label: 'f.familia' },
  { key: 'prioritat', label: 'f.prioritat', tipo: 'number' },
  { key: 'estat', label: 'f.estat' },
  { key: 'gestio', label: 'f.gestio' },
  { key: 'modalitat', label: 'f.modalitat', tipo: 'select', opciones: ['Donació', 'Transformació', 'Venda', 'Maquila', 'Altres'] },
  { key: 'area_geografica', label: 'f.area_geografica' },
  { key: 'poblacion', label: 'f.poblacion' },
  { key: 'direccion', label: 'f.direccion' },
  { key: 'codigo_postal', label: 'f.codigo_postal' },
  { key: 'nif', label: 'f.nif' },
  { key: 'telefono', label: 'f.phone', tipo: 'tel' },
  { key: 'telefono2', label: 'f.telefono2', tipo: 'tel' },
  { key: 'telefono3', label: 'f.telefono3', tipo: 'tel' },
  { key: 'email', label: 'f.email', tipo: 'email' },
  { key: 'email2', label: 'f.email2', tipo: 'email' },
  { key: 'contacto', label: 'f.contacto' },
  { key: 'contacto2', label: 'f.contacto2' },
  { key: 'horario', label: 'f.horario' },
  { key: 'calendari_repartiment', label: 'f.calendari_repartiment' },
  { key: 'data_alta', label: 'f.data_alta' },
  { key: 'productes_frescos', label: 'f.productes_frescos', tipo: 'boolnull' },
  { key: 'productes_frescos_txt', label: 'f.productes_frescos_txt' },
  { key: 'transport_plataforma', label: 'f.transport_plataforma', tipo: 'boolnull' },
  { key: 'transport_plataforma_txt', label: 'f.transport_plataforma_txt' },
  { key: 'descarrega_toro', label: 'f.descarrega_toro', tipo: 'boolnull' },
  { key: 'descarrega_toro_txt', label: 'f.descarrega_toro_txt' },
  { key: 'comentarios', label: 'f.comentarios', tipo: 'textarea', ancho: 'full' },
  { key: 'opt_in', label: 'f.opt_in', tipo: 'bool' },
  { key: 'es_test', label: 'f.es_test', tipo: 'bool' },
]
