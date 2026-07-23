# AGENTS.md

Documento canónico de contexto para agentes de IA (Claude Code, Codex, Cursor…) que
trabajan en este repositorio. `CLAUDE.md` lo importa; **no dupliques contenido allí.**

> **Regla permanente:** toda modificación que cambie la arquitectura, el esquema de datos,
> los contratos de las Edge Functions, las convenciones o los comandos **debe actualizar
> este fichero en el mismo cambio.** Si el código y este documento discrepan, el documento
> está roto.

---

## 1. Proyecto

**PDApp / POMA** — plataforma de canalización de excedentes agrícolas de Espigoladors, con
WhatsApp Cloud API como canal. Un productor ofrece un excedente por WhatsApp, el sistema lo
convierte en una **oferta** con identificador propio, prioriza **entidades sociales**
receptoras y registra las **canalizaciones** hasta el cierre con kg reales y albaranes.

Dos fases:

| Fase | Qué es | Estado |
| --- | --- | --- |
| **1. Infraestructura WhatsApp** | Consola de mensajería: webhook con firma, envío texto/plantilla, opt-in, Realtime | ✅ construida y endurecida |
| **2. POMA** | Intake conversacional, excedentes/canalizaciones, priorización, cierre | ✅ construida (prompts 0bis–8). Quedan checkpoints de negocio, no de código (§12) |

Actualmente en **entorno de pruebas** de Meta con **`WHATSAPP_ENVIO_REAL` activado**
(2026-07-22): los envíos salen de verdad, pero Meta en test **solo entrega a los ≤5 números
verificados** en su panel (reflejados en `meta_test_recipients`, §4); a cualquier otro número
Meta rechaza con `131030`. La protección real la da, pues, el propio entorno de test de Meta
más la whitelist `meta_test_recipients`. Ver §8.

**Mensajería siempre individual**, nunca a grupos: la Cloud API no escribe en grupos. Para
publicar en un grupo se ofrece "copiar texto" y se pega a mano.

La especificación completa está en `docs/nuevas-funcionalidades/` (fuera de git):
`poma-automatizacion-canalizacion-whatsapp-final.md` manda en el proceso de canalización y
trae los prompts 0–8; `manual-whatsapp-cloud-api-supabase-final.md` manda en la
configuración de Meta y las decisiones D1–D7; `guia-tecnica-claude-code-whatsapp-final.md`
es el mapa de ejecución.

## 2. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite 7 + React 19 + TypeScript 5.9 (`strict`) + **Tailwind v4 + shadcn/ui** |
| Datos / Realtime | Supabase (`@supabase/supabase-js` v2) |
| Backend | Edge Functions de Supabase (Deno / TypeScript) |
| Email | **Resend** (API HTTP, vía Edge Function `enviar-email`) |
| BD | Postgres (Supabase) con RLS |
| Scripts | Deno 2.x (`scripts/import-ara.ts`) |
| Hosting frontend | Vercel (proyecto `pdapp-wp`) |

Sin router ni librería de estado. **UI con Tailwind v4 + shadcn/ui**: componentes en
`src/components/ui/` (generados con el CLI de shadcn, `components.json`), tokens del **tema POMA**
en `src/index.css` (navy `#234C66` / crema `#E0EBC7` / coral `#EE7A5F`, fuente Space Grotesk),
alias `@/` → `src/`. Iconos `lucide-react`, toasts `sonner`, `cn()` en `src/lib/utils.ts`. El
logo (`public/logo-poma.svg`) y el favicon están en `public/`.

## 3. Estructura

```text
index.html
.env.local.example             Plantilla de variables del frontend (sí se versiona)
src/
  main.tsx                     Punto de entrada React
  App.tsx                      Estado raíz: vista (4 secciones), contactos, contacto seleccionado
  types.ts                     Tipos de todas las tablas
  index.css                    Todos los estilos (global, ~825 líneas)
  lib/
    supabase.ts                Cliente Supabase (lanza si faltan las env vars)
    whatsapp.ts                sendWhatsApp(): llama a la Edge Function; nunca lanza
    plantillas.ts              plantillaPrimerContacte(): tría plantilla de 1r contacte per rol (§6ter)
    poma.ts                    priorizarEntidades(): llama a la Edge Function con el JWT
    metaTest.ts                Lista de números de prueba de Meta (whitelist de envío, §9)
    emailTest.ts               Lista de correos de prueba (whitelist del canal email)
    email.ts                   enviarEmail(): llama a la Edge Function enviar-email
    i18n.tsx                   Sistema de traducciones (ca/es, per defecte ca; useT, §7)
    utils.ts                   cn() (shadcn)
    crudCampos.ts              Definiciones de campos para el CRUD (claves i18n f.*)
    textos.ts                  RECOLLIDA CONFIRMADA y albarán (los compone el panel)
  components/
    AuthGate.tsx               Login real con Supabase Auth (ver §9)
    Dashboard.tsx              Landing tras login: guía del proceso, KPIs y gestor de la lista Meta
    OffersList.tsx             Ofertas activas con kg en vivo (Realtime) + buscador
    OfferDetail.tsx            Detalle: priorización, canalizaciones, opt-in, cierre, cancelar
    ProducersList.tsx          Tabla de productores: buscador, separación Meta, detalle/nuevo/enviar
    EntitiesList.tsx           Tabla de entidades: buscador, badge "Meta", detalle/nueva/enviar
    RecordDetail.tsx           Ficha CRUD genérica (editar/crear/borrar) de productor o entidad
    ContactList.tsx            Sidebar de contactos + alta manual
    Conversation.tsx           Hilo de mensajes + composer + Realtime
scripts/
  import-ara.ts                Importación idempotente de los 5 CSV maestros
  crear-usuario.ts             Alta de cuentas por la Admin API (no envía correos)
  data/                        Los CSV — IGNORADO POR GIT (datos personales, §7)
supabase/
  config.toml                  Config del CLI (puertos 553xx, ver §7)
  migrations/*.sql             Migraciones versionadas
  functions/
    _shared/whatsapp.ts        Graph API + interruptor de envío (texto/plantilla/interactivos)
    _shared/intake.ts          Motor conversacional (máquina de estados)
    _shared/oferta.ts          id_excedente + texto "OFERTA DISPONIBLE"
    _shared/priorizacion.ts    Puntuación de entidades (pura, sin red)
    _shared/respuestas.ts      Captura el sí/no de una entidad a una oferta (aceptación, §5)
    priorizar-entidades/       POST: ranking de entidades para un excedente (JWT)
    whatsapp-send/index.ts     POST: reglas de envío; delega en _shared
    whatsapp-webhook/index.ts  GET verificación / POST recepción; respuesta a oferta + intake
    intake-recordatorios/      POST: avisa intakes a medias (lo llama pg_cron vía pg_net)
    enviar-email/index.ts      POST: ofertas por email (JWT + gate email_test_recipients)
    recuperar-password/index.ts POST público: genera enlace de reset y lo manda por Resend
    _shared/resend.ts          sendEmail() vía Resend, compartido
    _shared/plantillas-meta.md Contenido de las plantillas de Meta (oferta_excedent…) listo
docs/                          Material de trabajo local — IGNORADO POR GIT (§7)
  nuevas-funcionalidades/      Specs POMA, manuales y CSV de origen
```

## 4. Modelo de datos

### Mensajería (fase 1)

**`wa_contacts`** — `id`, `phone` (UNIQUE, E.164 sin `+`), `name`, `opt_in`, `opt_in_at`,
`opt_out_at`, **`last_inbound_at`**, `created_at`.
`last_inbound_at` es la última vez que el contacto escribió: modela la ventana de servicio
de 24 h y decide si se puede enviar texto libre (§8).

**`wa_messages`** — `id`, `wa_message_id` (**índice único**: idempotencia frente a
los reintentos de Meta), `contact_phone`, `direction` (`inbound`/`outbound`), `type`,
`body`, `status`, `raw` (jsonb), `created_at`. Índice `(contact_phone, created_at)`.

### POMA (fase 2)

**`productores`** — la tabla original (`id`, `name`, `email` UNIQUE, `phone` UNIQUE,
`created_at`) **ampliada** con `empresa`, `codigo`, `comentario`, `visitado`, `conveni`,
`tipo_empresa`, `telefono_alt`, `direccion`, `codigo_postal`, `nif`, `area_geografica`,
`poblacion`, `productos_habituales text[]`, `data_alta`, `activo`.
**`phone` es nullable**: 61 de los 339 productores importados no tienen móvil utilizable y
aun así conservamos su ficha. La UI deshabilita el envío para ellos.

**`productor_ubicaciones`** — un productor puede tener varias: `alias`, `gmaps_url`,
`coord_lat`, `coord_lng`, `municipio`, `es_principal`.

**`entidades`** — entidades sociales receptoras (25 columnas del Excel SDA). Los tres campos
de capacidad (`productes_frescos`, `transport_plataforma`, `descarrega_toro`) vienen como
texto libre: se guarda el original en `*_txt` y se deriva el boolean, que queda `null`
cuando el texto no es concluyente (`"1 furgo"`, `"Transpalet"`, `"In situ"`). Ampliada con
**`modalitat`** (`20260722160000_entidad_modalitat.sql`): modalitat d'aprofitament
(Donació/Transformació/Venda/Maquila/Altres), editable con desplegable en el detalle (CRUD).

**`excedentes`** — cabecera de la oferta. `id_excedente` UNIQUE con formato
`E-AAMMDD-XXX-YYY-N`. `estado` ∈ `borrador` · `publicada` · `parcial` · `bloqueada` ·
`cerrada` · `no_colocada` · **`cancelada`** (anulada desde el panel; check en
`20260722130100_estado_cancelada.sql`). `modalitat` ∈ `donacio` · `venda` · `maquila`.

**`canalizaciones`** — detalle por entidad: `kg_confirmados`, `kg_reales`, cajas, albaranes,
firmas. Relación **`excedentes` 1—N `canalizaciones`** (una oferta, varias entidades).

**`oferta_respuestas`** — flujo de **aceptación** (`20260723100000_oferta_respuestas.sql`):
`excedente_id` (FK, `on delete cascade`), `entidad_id` (FK, `on delete set null`), `telefono`,
`canal` (`whatsapp`·`email`), `estado` (`pendent`·`acceptada`·`rebutjada`), `mensaje_respuesta`,
`enviado_at`, `respondido_at`. `unique (excedente_id, entidad_id)` (reenviar actualiza, no
duplica) e índice `(telefono, estado)`. Es **distinta de `canalizaciones`**: aquella registra
kg; esta, el sí/no de la entidad. Al enviar una oferta desde `OfferDetail` se deja aquí una fila
`pendent`; la respuesta por WhatsApp la actualiza el webhook (§5). Realtime activo.

**`intake_sessions`** — estado del flujo conversacional: `telefono`, `paso_actual`,
`datos_parciales jsonb`, `excedente_id` (sin uso), `updated_at` y
**`recordatorio_enviado_at`** (marca del aviso de 10 min; `guardar()` la vuelve a `null` en
cada actividad, así el recordatorio salta 10 min tras la última interacción — §5).

**Listas maestras** — `productos` (`nombre` PK, `familia`, `eur_kg`), `causas` (`codigo` PK),
`factores_conversion` (`producto` PK, `kg_por_unidad`). Los nombres de
`factores_conversion` **no casan** con `productos` (van en mayúsculas): es tabla de
consulta, no clave foránea.

**`meta_test_recipients`** — `phone` PK (E.164 sin `+`), `etiqueta`, `created_at`
(`20260722120000_meta_test_recipients.sql`). Whitelist de destinatarios: en el entorno de
test la Cloud API solo entrega a los ≤5 números dados de alta en Meta, y **Meta no expone
ninguna API** para listarlos ni añadirlos (se gestionan en su panel confirmando un código).
La app guarda aquí su copia y la usa como fuente de verdad para separar productores (§6ter) y
para el gate de envío (§8). **Semántica clave**: si la tabla tiene filas, solo se envía a
quien esté en ella; si está **vacía**, no restringe nada (así, al pasar a un número de
producción sin el límite de 5, se vacía la lista y el gate desaparece solo). La gestiona
`src/lib/metaTest.ts` desde el Dashboard.

**`email_test_recipients`** — `email` PK, `etiqueta`, `created_at`
(`20260722150000_email_test_recipients.sql`). Whitelist análoga a `meta_test_recipients` pero
para el canal **email** (Resend): si tiene filas, `enviar-email` solo manda a esos correos;
vacía = sin límite. RLS: `authenticated` select/insert/delete. La gestiona `src/lib/emailTest.ts`
desde el Dashboard. **Ojo**: Resend sin dominio verificado solo entrega al correo propietario de
la cuenta, así que esta lista es la segunda barrera, no la única.

**`app_config`** — `key` PK, `value`, `updated_at` (`20260722130000_intake_recordatorios.sql`).
Clave/valor para secretos que un **job** necesita y que no pueden ir en git. Hoy guarda
`recordatorios_secret` (el que el job pasa a `intake-recordatorios`, §5). **Solo `service_role`**:
RLS activa sin política y `revoke` explícito del `SELECT` que `authenticated` heredaría por
default privileges (§9). La fila del secreto se inserta fuera de git con la service key.

### Integridad

Las tablas POMA sí tienen foreign keys. Las de mensajería **no**: `productores`,
`wa_contacts` y `wa_messages` siguen unidas solo por `phone`, sin FK.

### RLS y GRANTs — hacen falta LAS DOS capas

`service_role` acceso total en todas (lo usan las Edge Functions); **`authenticated`** con
`SELECT` en todas y, además, escritura donde el panel la necesita: `INSERT`/`UPDATE` en
`wa_contacts`; `INSERT`/`DELETE` en `meta_test_recipients` (whitelist gestionada desde el
Dashboard); **`INSERT`/`UPDATE`/`DELETE` en `productores` y `entidades`** (CRUD del panel,
`20260722140000_crud_productores_entidades.sql`); **`INSERT`/`UPDATE`/`DELETE` en
`oferta_respuestas`** (el panel registra el envío y marca a mano; §6ter). `anon` **no tiene
ningún privilegio** desde `20260721160000_auth_authenticated.sql`. Sin `INSERT` en `wa_messages`
para nadie salvo el servidor: el envío pasa siempre por la Edge Function. `app_config` es **solo
`service_role`** (§9). Realtime en `wa_contacts`, `wa_messages`, `excedentes`, `canalizaciones`
y `oferta_respuestas`.

**Las políticas RLS por sí solas no bastan.** Supabase ya no expone automáticamente las
tablas nuevas del esquema `public` a los roles de la Data API
(`auto_expose_new_tables` viene desactivado y el ajuste desaparece el 2026-10-30). Sin un
`GRANT` explícito, PostgREST devuelve `permission denied for table X` **antes** de evaluar
RLS, y fallan tanto el frontend como las Edge Functions.

Los GRANT están en `20260721120200_grants_data_api.sql`, que además fija
`alter default privileges` para que las tablas futuras los hereden. **Si creas una tabla
nueva, comprueba que es accesible**:
`select has_table_privilege('authenticated','public.X','SELECT')`.

## 5. Flujos

**Envío (saliente)** — `Conversation` → `sendWhatsApp()` → `POST /functions/v1/whatsapp-send`
(con el JWT de la sesión en `Authorization`) → aplica las reglas de envío (§8) → `POST
graph.facebook.com/{API_VERSION}/{PHONE_ID}/messages` → upsert en `wa_messages` → Realtime.
Si Meta devuelve error, la función lo reenvía **tal cual** con su status HTTP.

**Recepción (entrante)** — Meta → `POST /functions/v1/whatsapp-webhook` → valida
`X-Hub-Signature-256` (HMAC-SHA256 del cuerpo **crudo**, comparación en tiempo constante) →
upsert del contacto → **upsert** del mensaje por `wa_message_id` → actualiza
`last_inbound_at` → Realtime. Tras validar la firma **siempre responde 200**, para que Meta
no reintente.

**Estados** — los `value.statuses` actualizan `wa_messages.status` casando por
`wa_message_id`.

**Palabras clave** — `BAJA` pone `opt_in=false` + `opt_out_at`; `ALTA` pone `opt_in=true` +
`opt_in_at`. **Ambas responden confirmación** por WhatsApp (estamos en ventana, es gratis) y
se registran como `outbound`.

**Respuesta de una entidad a una oferta (aceptación)** — `procesarRespuestaOferta()`
(`_shared/respuestas.ts`), enganchada en el webhook **antes del intake y con prioridad sobre él**.
Solo actúa sobre **texto plano** (los pasos con botones del intake son `interactive` y no se tocan)
que clasifique claramente como sí/no. Si lo es, busca la fila `pendent` de `oferta_respuestas` más
reciente para ese teléfono (**la última oferta enviada**), la pasa a `acceptada`/`rebutjada`,
guarda el texto y **responde confirmación** por WhatsApp. **Resuelve el doble rol**: un número que
es productor **y** entidad, si tiene una oferta pendiente y contesta sí/no, se atiende aquí; con
cualquier otro mensaje cae al intake como productor. Si no hay fila pendiente o el texto no es
sí/no, devuelve `false` y sigue el flujo normal.

**Intake conversacional** — un productor escribe → el webhook lo identifica por `phone` en
`productores` → `procesarIntake()` (`_shared/intake.ts`). El estado vive en
`intake_sessions` (una fila por teléfono) y cada mensaje se interpreta según `paso_actual`.
Al completarse, `crearExcedenteDesdeSesion()` da de alta el excedente y avisa al productor.
Detalle en §6bis.

**Recordatorio de intake a medias** — la base **no** puede enviar WhatsApp, así que el aviso
de 10 min se dispara así: `pg_cron` (cada 2 min) → `disparar_recordatorios_intake()` →
`net.http_post` (**pg_net**) → Edge Function `intake-recordatorios` → busca sesiones inactivas
entre 10 min y 12 h sin avisar y manda `sendBotones` «Continuar / Cancel·lar», marcando
`recordatorio_enviado_at`. La función se despliega `--no-verify-jwt` y se protege con un secreto
compartido (cabecera `x-recordatorios-secret`) que vive en `app_config` (lo lee el job) y en el
secreto `RECORDATORIOS_SECRET` (lo valida la función). Si el productor pulsa **Continuar** se
reanuda el paso; **Cancel·lar** (o la palabra **`Stop`**) borra la sesión. Detalle en §6bis.

**"Sin contestar"** — `countUnanswered()` en `ProducersList`: mensajes `inbound` posteriores
al último `outbound` de ese teléfono.

## 6. Importación de datos maestros

Los datos maestros entran por **dos vías distintas, y la diferencia importa**:

| Qué | Cómo | Por qué |
| --- | --- | --- |
| Catálogos (`productos`, `causas`, `factores_conversion`) | Migración `20260721120300_seed_catalogos.sql` | Son configuración, no llevan datos personales: pueden vivir en git y deben existir en todos los entornos |
| `productores` y `entidades` | `scripts/import-ara.ts` | Llevan nombre, NIF, teléfono, email y dirección: los CSV **nunca** se versionan (§9) |

Para **regenerar el seed de catálogos** tras reexportar los CSV: el fichero se generó
leyendo `scripts/data/{causas,productos,factores_conversion}.csv`, normalizando las familias
igual que el script y emitiendo `insert … on conflict … do update`. Basta con crear una
migración nueva con el mismo formato; no editar la ya aplicada.

`scripts/import-ara.ts` (Deno) carga los 5 CSV de `scripts/data/`. **Idempotente**: se puede
ejecutar las veces que haga falta. Admite `--dry-run`. Verificado end-to-end contra la base
local (dos pasadas: la segunda actualiza, no duplica).

| CSV | Filas | Destino | Clave |
| --- | --- | --- | --- |
| `causas.csv` | 8 | `causas` | `codigo` |
| `factores_conversion.csv` | 15 | `factores_conversion` | `producto` |
| `productos.csv` | 91 → 90 | `productos` | `nombre` |
| `sda.csv` | 111 | `entidades` | `nombre` (lookup manual) |
| `prod_actius.csv` | 339 | `productores` | ver abajo |

Peculiaridades verificadas de los datos, todas manejadas por el script:

- **`prod_actius.csv` tiene la cabecera DESPLAZADA** respecto a los datos: la primera
  columna real es una fecha de alta que no figura en la cabecera. Se importa por
  **posición**, ignorando la cabecera. El mapeo está documentado en el propio script.
- **3 códigos apuntan a productores distintos** (`CN038`, `PR215`, `PR273`). Usar `codigo`
  como clave fusionaría fichas: para los códigos ambiguos se cae a `nombre + población`.
- **Los teléfonos son texto libre**: espacios entre grupos, nombres pegados, extensiones y
  hasta tres números en una celda. `extraerTelefonos()` busca secuencias de 9 dígitos
  tolerando separadores; el primero va a `phone` y el resto a `telefono_alt`. Si no se
  extrae ninguno pero la celda tenía texto, se conserva en crudo.
  Resultado: **278 de 339 con teléfono, de los cuales solo 272 son móviles** — los 6 fijos
  no reciben WhatsApp. 3 colisiones (el segundo se queda con `phone = null`).
- `productos.csv` trae erratas de familia (`Fruita seca`, `Fruit vermell`,
  `Hort Tub/Bul/Arr`) que se normalizan, y un `Garrofa` duplicado que se fusiona.
- `email` es UNIQUE: vacíos y duplicados van a `null` (solo 78 de 339 tienen email).
- Solo 12 productores tienen par de coordenadas numérico → se crean ~12 ubicaciones.
- `productos_habituales` queda **vacío**: la columna Producte no existe en este export.
  Reimportar cuando se reexporte el Excel ARA con esa columna.

## 6bis. El intake conversacional

Trece pasos: `familia` → `producte` → `varietat` → `kg` → `caixes` → `tipus_caixa` →
`retorn` → `ubicacio` → `disponible_fins` → `horari` → `modalitat` → `causa` →
`observacions`. Las opciones salen **siempre de las tablas** (`productos`, `causas`), nunca
escritas a mano.

**Arranca preguntando, no con el cuestionario.** Ante un mensaje que no sea ALTA/BAJA de un
productor sin sesión abierta, POMA responde con una **guía corta** (qué es, qué preguntará, y
que puede escribir `Stop` cuando quiera) y los botones *Sí / Ara no*. Es una desviación
deliberada del POMA §8, que hacía que *cualquier* mensaje lanzara el formulario: con 271
productores escribiendo por cualquier motivo, eso secuestra conversaciones normales.

**La paginación es el caso normal.** Las listas de WhatsApp admiten 10 filas: se muestran 9
opciones y la décima es "Més…". Hace falta porque hay **12 familias** y cuatro superan los
10 productos (Horta Tub/Bul/Arr 16, Fruita Dolça 14, Horta Fruit 14, Horta Fulla 12).

**Casos que el motor ya contempla:**

- Respuesta que no encaja: se repite la pregunta, máximo 2 veces, y luego se ofrece cancelar.
- **Cancelar en cualquier momento**: la palabra **`Stop`** (alias ocultos `CANCELAR`/`CANCEL·LAR`) **o** el botón
  `intake:cancelar` (del recordatorio) borran la sesión de `intake_sessions`.
- **Recordatorio a los 10 min** de inactividad: aviso «Continuar / Cancel·lar» (§5). *Continuar*
  (`intake:continuar`) reanuda el paso donde se dejó; se manda una sola vez por periodo inactivo.
- Sesión inactiva más de 12 h: se descarta y se empieza de cero (el recordatorio actúa antes).
- Productor **sin ubicaciones** (329 de 341): no se puede enviar una lista vacía, así que se
  pide el enlace de Google Maps por texto. El enlace crea una `productor_ubicaciones` que
  hereda el municipio de la ficha.
- Cantidad en unidades o manats: se convierte con `factores_conversion` si hay factor.

**Identificador**: `E-AAMMDD-XXX-YYY-N` (3 letras del productor, 3 del producto, N = orden
del día). Ejemplo real: `E-260721-CAR-TOM-1`.

**Textos que se publican** — reproducen los que el equipo escribe hoy a mano, emojis
incluidos. `componerTextoOferta()` en `_shared/oferta.ts` genera "OFERTA DISPONIBLE"
(PRODUCTE, PRODUCTOR, MUNICIPI, UBICACIÓ, QUANTITAT, DISPONIBLE, HORARI RECOLLIDA,
MODALITAT, CAUSA, ENVASOS, RESPONSABLE, OBSERVACIONS). Queda pendiente el de "RECOLLIDA
CONFIRMADA" (🚚 con SDA/ENTITAT, DATA i HORA, KG RECOLLITS, KG FALTEN RECOLLIR, Comentaris),
que corresponde al momento de cierre y todavía no está implementado.

## 6ter. Distribución, cierre y panel

Una vez creado el excedente, el técnico trabaja sobre él desde el **panel** (vistas
Ofertas / Detalle). Navegación: barra superior de 5 secciones —**Dashboard | Ofertas |
Productores | Entidades | Mensajería**— en `App.tsx`. El **Dashboard** (`Dashboard.tsx`) es la
landing tras el login: guía del proceso (los 4 momentos), KPIs agregados (ofertas por estado
—incluidas `cancelada`—, kg canalizados/pendientes, productores/entidades y cuántos pueden
recibir por estar en la lista Meta, mensajes recibidos/sin contestar, sesiones de intake) y el
**gestor de la lista de test de Meta**. `OffersList`, `ProducersList` y `EntitiesList` llevan
**buscador**; `ProducersList` separa en dos grupos —primero los que están en la lista Meta
(badge "Meta", pueden recibir), luego el resto— y `EntitiesList` marca con badge "Meta" las
entidades que pueden recibir. Mensajería muestra la lista completa de contactos (ya no la
conversación única).

**CRUD de productores y entidades.** Cada listado tiene, por fila, «Detalle» y «Enviar
mensaje», y en la cabecera «Nuevo/Nueva». «Detalle» abre `RecordDetail`, una ficha a pantalla
completa (como el detalle de oferta) con **todos los campos editables**; guarda (insert/update),
borra (con confirmación) y puede abrir la mensajería con el teléfono de la ficha. `RecordDetail`
es **genérico**: recibe las definiciones de `src/lib/crudCampos.ts` (`PRODUCTOR_CAMPOS` /
`ENTIDAD_CAMPOS`) y la tabla destino. Necesita los GRANT/RLS de escritura del §4. «Enviar
mensaje» (en listado y ficha) asegura el teléfono como `wa_contact` y abre Mensajería, tanto
para productores como para entidades.

**Solo los números de la lista Meta pueden recibir.** En el detalle, **«Enviar oferta»** se
habilita únicamente si la entidad tiene `opt_in` **y** su teléfono está en
`meta_test_recipients`; el servidor lo vuelve a comprobar (§8). En el entorno de test ese botón
envía el **texto de la oferta** (`texto_oferta`) como **texto dentro de la ventana de 24 h** —la
abre la entidad al escribir al número— porque las plantillas propias (`oferta_excedent`) no son
usables en el número de test (solo `hello_world`). En producción, con la plantilla aprobada, se
volvería a enviar como plantilla. Si la entidad no ha escrito aún, el envío responde
`409 window_closed`/`404 unknown_contact` y se le pide que escriba primero.

**Aceptación de la oferta (panel).** Cada envío desde `OfferDetail` (WhatsApp o email) deja una
fila `pendent` en `oferta_respuestas`. La entidad que responde por WhatsApp la actualiza sola
(§5) y el detalle lo refleja **en vivo** (Realtime) en la tarjeta «Respostes de les entitats»,
con badge de estado. El técnico puede **marcar a mano** acceptada/rebutjada (imprescindible para
el email, que no tiene respuesta automática).

**Copiar el texto de la oferta** escribe al portapapeles `text/plain` **y** `text/html` (con
`<br>`): así los saltos de línea se conservan al pegar en WhatsApp Web, correo o documentos, no
solo en destinos que respetan el LF suelto.

**Primer contacto por plantilla.** El botón «Enviar 1r missatge» de `Conversation` elige la
plantilla por rol (`src/lib/plantillas.ts`, `plantillaPrimerContacte`): en producción,
`salutacio_entitat` / `salutacio_productor` (català, piden responder «OK»); en test, mientras el
flag `PLANTILLES_CA_APROVADES` sea `false`, siempre `hello_world` (la única aprobada). Contenido
de las plantillas en `_shared/plantillas-meta.md` (§12).

**Cancelar / anular una oferta ya creada.** `OfferDetail` ofrece dos acciones de anulación:
«Marcar como no colocada» (no se encontró destino, exige motivo) y «Cancelar oferta»
(estado `cancelada`). Un intake a medias no llega aquí: al cancelar se borra la sesión sin
crear excedente. Las ofertas `cancelada`/`cerrada`/`no_colocada` salen del listado de activas y
se cuentan en el Dashboard.

**Priorización** (`priorizar-entidades` + `_shared/priorizacion.ts`, función pura). Dado un
excedente, ordena las entidades candidatas. Pesos: misma área +3 (mismo municipio +2 extra);
`transport_plataforma` +1 y `descarrega_toro` +1 (peso doble si `kg_total > 500`); producto
fresco + entidad que acepta frescos +2; `prioritat` suma `max(0, 3 - prioritat)`. Sobre el
`estat` (6 valores reales, no 2): `Signat` puntúa arriba; las tres variantes `Pendent*` van al
final con aviso; `No procedeix` y sin estado se **excluyen**. Sin `opt_in` no se excluye, se
marca (no se le puede enviar por API).

**Opt-in de entidades**: las 111 tienen `opt_in=false`. Se marca a mano con un toggle en el
detalle (mecánica de PoC). En producción se combinará con el ALTA por WhatsApp.

**Canalizaciones**: el panel registra kg por entidad; al cubrir `kg_total` el excedente pasa a
`bloqueada` y se ofrece copiar "RECOLLIDA CONFIRMADA". El cierre registra `kg_reales` (marca si
difieren) y genera el albarán (plantilla con placeholders, `src/lib/textos.ts`).

**No colocadas**: manual desde el panel (motivo obligatorio) o automático por el **job de
vencidas** (`pg_cron`, `marcar_excedentes_vencidos()`), que marca `no_colocada` los excedentes
con `disponible_hasta` vencida >24 h y kg sin cubrir. No actúa hasta que el panel normaliza
`disponible_hasta` (el intake lo deja `null`).

## 7. Convenciones

- **Teléfonos**: E.164 **sin** `+`, solo dígitos → `34612345678`. Validación en el frontend:
  `/^[1-9]\d{6,14}$/`. El `+` se añade solo al *mostrar*. Móviles españoles = `346…`/`347…`.
- **Endpoint de Meta**: `https://graph.facebook.com/{WHATSAPP_API_VERSION}/{PHONE_ID}/messages`.
  La versión se lee del entorno (default `v23.0`), no está hardcodeada.
- **Idioma**: la **interfaz es bilingüe català/castellà** (sistema i18n propio en
  `src/lib/i18n.tsx`: `useT()`, diccionaris `ca`/`es`, **per defecte `ca`**, selector a la barra
  superior, preferència a `localStorage`). Els textos de la interfície viuen com a **claus**
  (p. ex. `nav.offers`, `f.email`); les etiquetes de camps del CRUD també (`crudCampos.ts` guarda
  claus `f.*`). Els **comentaris del codi** en castellà; els **missatges de WhatsApp**, en català
  (no passen per i18n). Identificadors en inglés salvo los del dominio (`productores`, `entidades`,
  `excedentes`, `canalizaciones`).
- **Secretos**: nunca en el código. Env vars, siempre.
- **`docs/` y `scripts/data/` nunca entran en git.** El primero es material de trabajo; el
  segundo son datos personales (teléfonos, emails y NIF de ~450 personas y entidades).
  `.env.local.example` sí se versiona: es la plantilla, sin valores.
- **Claves de Supabase**: usar las **nuevas** — `sb_publishable_...` en el frontend,
  `sb_secret_...` en el servidor. **No** usar las obsoletas `anon`/`service_role` (claves JWT
  antiguas). Los *roles* de Postgres `anon`/`authenticated`/`service_role` sí se siguen usando
  en RLS: no confundir rol con clave.
- **Errores**: `sendWhatsApp()` nunca lanza; devuelve `{ ok, status, data }`. El mapeo a texto
  legible vive en `noticeFromError()` (`Conversation.tsx`), que cubre los códigos propios
  (`window_closed`, `no_opt_in`, `unknown_contact`, `unauthorized`) y el `131047` de Meta.
- **Migraciones**: `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`. Nunca editar una ya
  aplicada; añadir una nueva.
- **Puertos del Supabase local**: este proyecto usa el rango **553xx** (API 55321, BD 55322,
  Studio 55323…), desplazado respecto al 543xx por defecto. En esta máquina conviven varios
  stacks de Supabase a la vez y el rango por defecto está ocupado por otros proyectos; con
  los puertos propios, `supabase start` levanta este entorno **sin parar los demás**. Si
  añades un servicio nuevo a `config.toml`, dale también un puerto 553xx libre.

## 8. Reglas de negocio

> ⚠️ **Envío real ACTIVADO en remoto** (`WHATSAPP_ENVIO_REAL=true`, 2026-07-22). El interruptor
> (env var) gobierna el único punto que llama a la Graph API (`enviar()` en `_shared/whatsapp.ts`):
> solo si vale exactamente `"true"` sale algo. En remoto ya lo está, así que **sí se contacta con
> Meta**; en local, sin el secreto, se **simula** (`status='simulat'`). Lo que evita el desastre en
> remoto es que el número **sigue en el entorno de test de Meta**: Meta solo entrega a los ≤5
> verificados (los de `meta_test_recipients`); el resto lo rechaza con `131030`. **Aviso: si el
> número pasa a producción con el interruptor en `true`, enviaría a TODOS** — revisar lista y flujo
> antes. Afecta a TODO: intake, recordatorios, ALTA/BAJA y ofertas a entidades. Para volver a
> simular: `supabase secrets set WHATSAPP_ENVIO_REAL=false`. El webhook siempre recibe.

**Reglas de envío** (decisión D1 del manual; implementadas en `whatsapp-send`; se evalúan
antes del interruptor de arriba, así que en modo PoC un envío bloqueado por regla ni siquiera
llega a simularse):

| Tipo | Condición | Si no se cumple | Por qué |
| --- | --- | --- | --- |
| `text` | ventana de 24 h abierta (`last_inbound_at` < 24 h) | `409 window_closed` | Es una respuesta de servicio; **no** requiere opt-in |
| `template` | `opt_in = true` | `403 no_opt_in` | La iniciamos nosotros: requiere consentimiento (RGPD + Meta) |

Contacto inexistente → `404 unknown_contact`. Sin sesión válida → `401 unauthorized`.

**Gate de la lista de test de Meta** (antes de las reglas de contacto): si
`meta_test_recipients` tiene alguna fila y el destinatario **no** está en ella →
`403 no_test_recipient`. Si la tabla está **vacía**, no restringe (§4). Es defensa en
profundidad: la UI ya desactiva el botón, pero el servidor corta aunque la UI fallara. Es
**independiente** del interruptor `WHATSAPP_ENVIO_REAL`: el gate limita **a quién** se podría
enviar; el interruptor, si sale **algo** (hoy, no).

Consecuencia práctica: se puede responder a cualquiera que escriba espontáneamente aunque no
tenga opt-in, pero no iniciar una conversación sin consentimiento.

**El intake conversacional ocurre siempre dentro de la ventana** (la abre el productor al
escribir), así que no necesita plantilla ni opt-in.

**Proceso de canalización** — cuatro momentos: entrada de oferta (intake) → distribución
(priorizar entidades y avisarlas individualmente) → confirmación (bloqueo al cubrir los kg) →
cierre real (kg reales, albaranes, o marcar `no_colocada` con motivo).

**Valoración**: `valor_eur = kg × productos.eur_kg` (hoy plano a 1 €/kg).

## 9. Seguridad y autenticación

**El acceso exige una sesión de Supabase Auth.** Ya no hay lectura anónima: el
`PasswordGate` cosmético se sustituyó por `AuthGate.tsx` (login real con
`signInWithPassword`), las políticas RLS y los GRANT pasaron de `anon` a
`authenticated`, y `whatsapp-send` valida el JWT del usuario.

| Pieza | Cómo se protege |
| --- | --- |
| Datos (PostgREST) | RLS + GRANT sobre `authenticated`. `anon` no tiene ningún privilegio: responde `42501 permission denied` |
| `whatsapp-send` | Desplegada **con** verificación de JWT (sin `--no-verify-jwt`) y además comprueba `getUser(token)` |
| `whatsapp-webhook` | Sigue con `--no-verify-jwt` porque Meta no envía JWT; se valida la firma `X-Hub-Signature-256` |
| Alta de cuentas | Solo con la Admin API (`scripts/crear-usuario.ts`). El registro público está desactivado |
| Login | `AuthGate.tsx`: `signInWithPassword` + botón «ojo» (mostrar/ocultar) + «¿olvidaste la contraseña?» |
| Recuperar contraseña | Edge Function `recuperar-password` (pública) + Resend; **no** usa el mailer nativo (§ abajo) |

### Correos: ahora sí, pero solo por Resend

Cambió la política del proyecto: el reset de contraseña y el envío de ofertas por email **sí
mandan correo**, pero **siempre por Resend** (nunca el mailer nativo de Supabase Auth, que sigue
apagado y en test). Detalle:

- El **mailer nativo de Auth sigue apagado**: `enable_confirmations=false`,
  `mailer_autoconfirm=true`, cuentas con `admin.createUser({email_confirm:true})` → el **alta no
  envía nada**. Sigue prohibido usar `resetPasswordForEmail()`, `inviteUserByEmail()` o magic
  links (esos disparan el mailer nativo).
- El **reset** usa `admin.generateLink({type:'recovery'})` (Admin API, **no** envía correo por sí
  mismo) y el enlace se manda por **Resend** desde `recuperar-password`. La app detecta el evento
  `PASSWORD_RECOVERY` y muestra el form de nueva contraseña (`AuthGate`). La `redirectTo` (APP_URL)
  debe estar en la allow-list de Auth (Management API, **no** config push; §10).
- **Dominio `espigoladors.com` verificado en Resend** y `RESEND_FROM="POMA <no-reply@espigoladors.com>"`
  configurado, así que **se envía a cualquier dirección** (verificado el envío a un correo externo).
  Si se cambia de dominio, verificarlo en `resend.com/domains` y ajustar `RESEND_FROM`. El gate
  `email_test_recipients` limita, mientras se está en pruebas, a los correos de esa whitelist.

### Lo que sigue pendiente

- `enable_signup = false` vive en `config.toml`; si alguien lo reactiva,
  cualquiera podría registrarse y **leer toda la base**, porque las políticas dan
  acceso a cualquier usuario autenticado. No hay todavía roles ni permisos por
  persona.
- Los datos personales **ya están en remoto**: 341 productores y 111 entidades, importados
  el 21-07-2026. Lo único que los protege es la autenticación de arriba; verificado que con
  la publishable key las tablas responden `42501`. Dar de alta una cuenta equivale a dar
  acceso a las 452 fichas completas.
- La app de Vercel tiene además Deployment Protection (SSO), que es una capa de
  plataforma independiente de todo lo anterior.

### ⚠️ No hacer `supabase config push`

Los flags de auth de **remoto** (`external_email_enabled`, `disable_signup`) se gestionan
por el **Dashboard o el Management API**, no por `config.toml`. Dos razones:

1. `config push` ya falla a mitad (error de Storage con esta versión del CLI).
2. Peor: arrastra `enable_signup = false` del toml y **desactiva el login por email en
   remoto** — GoTrue responde entonces "Email logins are disabled", que no es un error de
   contraseña sino del proveedor apagado. Pasó el 21-07-2026 y dejó fuera al equipo.

Para reactivarlo (Management API, con el token del CLI en el keychain):

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://api.supabase.com/v1/projects/<ref>/config/auth \
  -d '{"external_email_enabled": true}'
```

En el **CLI local** los dos flags no son independientes: `external.email` sigue a
`enable_signup`, así que con `enable_signup = false` el login por email tampoco funciona en
local. No importa en la práctica: `npm run dev` usa `.env.local`, que apunta a **remoto**.

## 10. Variables de entorno

**Frontend** (`.env.local`, ignorado por git; plantilla en `.env.local.example`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`)

**Edge Functions** (secrets de Supabase):

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_API_VERSION` (default `v23.0`)
- `WHATSAPP_ENVIO_REAL` — `"true"` en remoto desde 2026-07-22 (envíos reales, §8); ausente u
  otro valor = simula (`status='simulat'`)
- `ALLOWED_ORIGIN` — admite **varios orígenes separados por comas** y `*` como comodín
  dentro de un origen, porque los despliegues de Vercel no tienen URL estable. Valor actual:
  `http://localhost:5173,https://pdapp-wp.carlessanz.com,https://pdapp-*-carlessanz-projects.vercel.app`.
  **La app en producción se sirve desde el dominio propio `https://pdapp-wp.carlessanz.com`**, que
  hubo que añadir aquí (si no, el navegador bloquea por CORS todas las llamadas a las Edge
  Functions). Si se cambia/añade dominio, actualizar este secret.
- `RECORDATORIOS_SECRET` — secreto compartido que valida `intake-recordatorios`; el **mismo**
  valor va en `app_config.recordatorios_secret` para que el job lo pueda enviar (§4, §5). Nunca
  en git.
- `RESEND_API_KEY` — API key de Resend (ofertas por email y reset de contraseña). Nunca en git.
- `RESEND_FROM` — remitente (`from`) de un dominio **verificado** en Resend. Valor actual:
  `POMA <no-reply@espigoladors.com>`. Ausente = usa `onboarding@resend.dev`, que solo entrega al
  correo owner de la cuenta.
- `APP_URL` — URL de la app para el `redirectTo` del reset (dominio propio
  `https://pdapp-wp.carlessanz.com`); debe estar en la allow-list de Auth (`uri_allow_list`).
- `SB_SECRET_KEY` (`sb_secret_...`)
- `SUPABASE_URL` (la inyecta Supabase automáticamente)

**Redirect URLs de Auth** (Management API, no config push): `site_url` = APP_URL y `uri_allow_list`
incluye `localhost:5173`, la URL de producción y el comodín `https://pdapp-*-carlessanz-projects.vercel.app/**`.

**Scripts**: `SUPABASE_URL` y `SB_SECRET_KEY` en el entorno.

## 11. Comandos

```bash
npm run dev                # Vite en local
npm run build              # tsc && vite build  ← única verificación automática que existe
npm run preview            # servir el build

supabase db push                                          # aplicar migraciones
supabase functions deploy whatsapp-send        # con verify_jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy priorizar-entidades  # con verify_jwt
supabase functions deploy intake-recordatorios --no-verify-jwt   # lo llama pg_cron
supabase functions deploy enviar-email         # con verify_jwt (ofertas por email)
supabase functions deploy recuperar-password --no-verify-jwt     # login público
supabase secrets set --env-file .secrets.env

deno run -A scripts/import-ara.ts --dry-run   # analizar sin escribir
deno run -A scripts/import-ara.ts             # importar los CSV maestros
```

`npm run build` corre `tsc` con `strict`, `noUnusedLocals` y `noUnusedParameters`:
**es la comprobación que debes ejecutar tras cada cambio**, porque no hay nada más.

## 12. Checkpoints de negocio y deuda técnica

**Checkpoints que NO son código** (POMA §10): la construcción está completa, pero para poner
POMA en producción real quedan pasos de configuración y negocio.

1. ~~**Salir del modo PoC**~~ — **hecho (2026-07-22)**: `WHATSAPP_ENVIO_REAL=true` en remoto. Lo
   que contiene el riesgo ahora es el entorno de test de Meta (≤5 números) + `meta_test_recipients`.
2. **Plantillas propias en Meta**: `oferta_excedent`, `confirmacio_productor` y las de primer
   contacto **`salutacio_productor` / `salutacio_entitat`** (català, piden responder «OK») hay que
   darlas de alta y esperar su aprobación (contenido en `_shared/plantillas-meta.md`). En test solo
   `hello_world` está aprobada, así que ni el envío real de la oferta ni las salutacions catalanes
   funcionan hasta entonces; el código ya las selecciona por rol tras el flag
   `PLANTILLES_CA_APROVADES` de `src/lib/plantillas.ts` (hoy `false` → se usa `hello_world`).
3. **Opt-in real de las entidades**: hoy `false` en las 111; el toggle deja la mecánica, pero
   recoger el consentimiento es trabajo de negocio.
4. **Formato definitivo del albarán**: se genera con placeholders (`src/lib/textos.ts`); el
   formato legal del Excel se confirma al integrarlo.
5. **Reexportar `prod_actius.csv`** con la columna Producte para rellenar `productos_habituales`
   (hoy vacío: el intake ofrece el catálogo completo por familias).
6. **Paso a producción de Meta**: número real, verificación de empresa, método de pago.

**Deuda técnica:**

1. **Sin tests, sin linter, sin CI.** La única red de seguridad es `tsc`.
2. **No hay roles**: cualquier usuario autenticado lo ve y lo puede todo, y desde el CRUD
   también **crea, edita y borra** productores y entidades (§4). Con 452 fichas reales, dar de
   alta una cuenta = dar acceso total de lectura y escritura. Al introducir roles habrá que
   restringir las políticas de escritura de `20260722140000_crud_productores_entidades.sql`.
3. El intake avanza de paso aunque falle el envío: si la red falla, el productor no recibe la
   pregunta pero la sesión ya avanzó, y su siguiente mensaje se lee como respuesta al paso nuevo.
4. `disponible_hasta` se guarda `null` (el productor responde en texto libre); el técnico lo
   normaliza en el panel, y hasta que lo haga el job de vencidas no actúa sobre ese excedente.
5. `ProducersList` carga **todos** los `wa_messages` sin filtro ni paginación para contar los
   no contestados, y se suscribe a Realtime sin filtro. No escala. Igual `OffersList`, que
   recarga entero ante cualquier cambio de Realtime, y el `Dashboard`, que al entrar agrega
   toda la base (productores, entidades, excedentes, canalizaciones, mensajes) en el cliente.
   Los buscadores de `ProducersList`/`OffersList` filtran **en cliente** sobre lo ya cargado.
6. `Conversation` carga el hilo completo sin paginación.
7. `ContactList` conserva la prop `single` (modo conversación única) pero ya no se usa: desde
   que Mensajería muestra la lista completa, ningún llamador la pasa. Se puede eliminar.
8. `index.css` es un único fichero global (~825 líneas) con clases sin namespace.
9. `types.ts` no modela `raw`; `MessageRow` en `ProducersList` duplica parte de `WaMessage`.
10. Hay migraciones que **borran datos** (`truncate wa_messages`) mezcladas con DDL.
11. Sin FK entre `productores`, `wa_contacts` y `wa_messages` (unidas por `phone`).
12. `prioritat` casi no discrimina (97 de 111 entidades son prioridad 1): aporta poco al ranking.
13. `oferta_respuestas` se registra desde el **cliente** (`OfferDetail`), no desde `whatsapp-send`:
    mantiene la Edge Function intacta pero acopla el registro al panel. Las respuestas por **email**
    no tienen captura automática (no hay inbound de correo): se marcan a mano.
14. La clasificación sí/no de `procesarRespuestaOferta` es una **heurística por lista de palabras**:
    un texto corto que empiece por «sí/no» con una oferta pendiente podría clasificarse mal.
15. La selección de plantilla de primer contacto por rol **no se ejercita en test** (siempre cae a
    `hello_world`); solo actúa en producción con `PLANTILLES_CA_APROVADES=true`.
16. **Doble rol** productor+entidad (p. ej. Sebas Sale, Carles Sanz, altas de prueba): tablas
    separadas sin FK, un teléfono puede estar en ambas. El webhook lo desambigua por prioridad
    (§5), pero un productor-entidad a media intake que reciba una oferta y conteste sí/no en texto
    verá su respuesta tomada como aceptación, no como paso del intake.

## 13. Al terminar cualquier cambio

1. `npm run build` en verde.
2. **Actualizar este fichero** si cambió arquitectura, datos, contratos, convenciones,
   comandos o deuda técnica.
3. Commit en castellano, describiendo el *qué* y el *por qué*.
