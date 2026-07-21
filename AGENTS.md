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
| **2. POMA** | Intake conversacional, excedentes/canalizaciones, priorización, cierre | 🔧 modelo de datos e importación hechos; lógica pendiente |

Actualmente en **entorno de pruebas** de Meta (número de test, máximo 5 destinatarios).

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
| Frontend | Vite 7 + React 19 + TypeScript 5.9 (`strict`) |
| Datos / Realtime | Supabase (`@supabase/supabase-js` v2) |
| Backend | Edge Functions de Supabase (Deno / TypeScript) |
| BD | Postgres (Supabase) con RLS |
| Scripts | Deno 2.x (`scripts/import-ara.ts`) |
| Hosting frontend | Vercel (proyecto `pdapp-wp`) |

Sin router, sin librería de estado, sin framework de CSS: un único `src/index.css` global.

## 3. Estructura

```text
index.html
.env.local.example             Plantilla de variables del frontend (sí se versiona)
src/
  main.tsx                     Punto de entrada React
  App.tsx                      Estado raíz: vista, contactos, contacto seleccionado
  types.ts                     Tipos de todas las tablas
  index.css                    Todos los estilos (global, ~475 líneas)
  lib/
    supabase.ts                Cliente Supabase (lanza si faltan las env vars)
    whatsapp.ts                sendWhatsApp(): llama a la Edge Function; nunca lanza
  components/
    PasswordGate.tsx           Puerta por contraseña (cosmética, ver §9)
    ProducersList.tsx          Tabla de productores + badge "sin contestar"
    ContactList.tsx            Sidebar de contactos + alta manual
    Conversation.tsx           Hilo de mensajes + composer + Realtime
scripts/
  import-ara.ts                Importación idempotente de los 5 CSV maestros
  data/                        Los CSV — IGNORADO POR GIT (datos personales, §7)
supabase/
  config.toml                  Config del CLI (project_id: pdApp-wp)
  migrations/*.sql             Migraciones versionadas
  functions/
    whatsapp-send/index.ts     POST: envía a la Graph API
    whatsapp-webhook/index.ts  GET verificación / POST recepción de Meta
docs/                          Material de trabajo local — IGNORADO POR GIT (§7)
  nuevas-funcionalidades/      Specs POMA, manuales y CSV de origen
```

## 4. Modelo de datos

### Mensajería (fase 1)

**`wa_contacts`** — `id`, `phone` (UNIQUE, E.164 sin `+`), `name`, `opt_in`, `opt_in_at`,
`opt_out_at`, **`last_inbound_at`**, `created_at`.
`last_inbound_at` es la última vez que el contacto escribió: modela la ventana de servicio
de 24 h y decide si se puede enviar texto libre (§8).

**`wa_messages`** — `id`, `wa_message_id` (**índice único parcial**: idempotencia frente a
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
cuando el texto no es concluyente (`"1 furgo"`, `"Transpalet"`, `"In situ"`).

**`excedentes`** — cabecera de la oferta. `id_excedente` UNIQUE con formato
`E-AAMMDD-XXX-YYY-N`. `estado` ∈ `borrador` · `publicada` · `parcial` · `bloqueada` ·
`cerrada` · `no_colocada`. `modalitat` ∈ `donacio` · `venda` · `maquila`.

**`canalizaciones`** — detalle por entidad: `kg_confirmados`, `kg_reales`, cajas, albaranes,
firmas. Relación **`excedentes` 1—N `canalizaciones`** (una oferta, varias entidades).

**`intake_sessions`** — estado del flujo conversacional: `telefono`, `paso_actual`,
`datos_parciales jsonb`.

**Listas maestras** — `productos` (`nombre` PK, `familia`, `eur_kg`), `causas` (`codigo` PK),
`factores_conversion` (`producto` PK, `kg_por_unidad`). Los nombres de
`factores_conversion` **no casan** con `productos` (van en mayúsculas): es tabla de
consulta, no clave foránea.

### Integridad

Las tablas POMA sí tienen foreign keys. Las de mensajería **no**: `productores`,
`wa_contacts` y `wa_messages` siguen unidas solo por `phone`, sin FK.

### RLS y GRANTs — hacen falta LAS DOS capas

`service_role` acceso total en todas (lo usan las Edge Functions); `anon` con `SELECT` y,
solo en `wa_contacts`, `INSERT`/`UPDATE`. Sin `INSERT` de `anon` en `wa_messages`: el envío
pasa siempre por la Edge Function. Realtime en `wa_contacts`, `wa_messages`, `excedentes`
y `canalizaciones`.

**Las políticas RLS por sí solas no bastan.** Supabase ya no expone automáticamente las
tablas nuevas del esquema `public` a los roles de la Data API
(`auto_expose_new_tables` viene desactivado y el ajuste desaparece el 2026-10-30). Sin un
`GRANT` explícito, PostgREST devuelve `permission denied for table X` **antes** de evaluar
RLS, y fallan tanto el frontend como las Edge Functions.

Los GRANT están en `20260721120200_grants_data_api.sql`, que además fija
`alter default privileges` para que las tablas futuras los hereden. **Si creas una tabla
nueva, comprueba que es accesible**: `select has_table_privilege('anon','public.X','SELECT')`.

## 5. Flujos

**Envío (saliente)** — `Conversation` → `sendWhatsApp()` → `POST /functions/v1/whatsapp-send`
(con cabecera `x-api-key`) → aplica las reglas de envío (§8) → `POST
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

**"Sin contestar"** — `countUnanswered()` en `ProducersList`: mensajes `inbound` posteriores
al último `outbound` de ese teléfono.

## 6. Importación de datos maestros

Los datos maestros entran por **dos vías distintas, y la diferencia importa**:

| Qué | Cómo | Por qué |
| --- | --- | --- |
| Catálogos (`productos`, `causas`, `factores_conversion`) | Migración `20260721120300_seed_catalogos.sql` | Son configuración, no llevan datos personales: pueden vivir en git y deben existir en todos los entornos |
| `productores` y `entidades` | `scripts/import-ara.ts` | Llevan nombre, NIF, teléfono, email y dirección: **nunca** se versionan y hoy solo se importan en local (§9) |

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

## 7. Convenciones

- **Teléfonos**: E.164 **sin** `+`, solo dígitos → `34612345678`. Validación en el frontend:
  `/^[1-9]\d{6,14}$/`. El `+` se añade solo al *mostrar*. Móviles españoles = `346…`/`347…`.
- **Endpoint de Meta**: `https://graph.facebook.com/{WHATSAPP_API_VERSION}/{PHONE_ID}/messages`.
  La versión se lee del entorno (default `v23.0`), no está hardcodeada.
- **Idioma**: interfaz y comentarios en **castellano**; los textos que se envían por WhatsApp,
  en **catalán**. Identificadores en inglés salvo los del dominio (`productores`, `entidades`,
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

**Reglas de envío** (decisión D1 del manual; implementadas en `whatsapp-send`):

| Tipo | Condición | Si no se cumple | Por qué |
| --- | --- | --- | --- |
| `text` | ventana de 24 h abierta (`last_inbound_at` < 24 h) | `409 window_closed` | Es una respuesta de servicio; **no** requiere opt-in |
| `template` | `opt_in = true` | `403 no_opt_in` | La iniciamos nosotros: requiere consentimiento (RGPD + Meta) |

Contacto inexistente → `404 unknown_contact`. Sin `x-api-key` válida → `401 unauthorized`.

Consecuencia práctica: se puede responder a cualquiera que escriba espontáneamente aunque no
tenga opt-in, pero no iniciar una conversación sin consentimiento.

**El intake conversacional ocurre siempre dentro de la ventana** (la abre el productor al
escribir), así que no necesita plantilla ni opt-in.

**Proceso de canalización** — cuatro momentos: entrada de oferta (intake) → distribución
(priorizar entidades y avisarlas individualmente) → confirmación (bloqueo al cubrir los kg) →
cierre real (kg reales, albaranes, o marcar `no_colocada` con motivo).

**Valoración**: `valor_eur = kg × productos.eur_kg` (hoy plano a 1 €/kg).

## 9. Seguridad — estado actual

Herramienta interna de pruebas. **Aún no expuesta a producción.**

Ya protegido:

- El webhook valida `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET`.
- `whatsapp-send` exige `x-api-key` (comparación en tiempo constante) y restringe CORS a
  `ALLOWED_ORIGIN`.
- Idempotencia: los reintentos de Meta no duplican mensajes.

Lo que **todavía no** protege:

- `PasswordGate` es **cosmético**: el hash SHA-256 viaja en el bundle y solo controla el
  renderizado. No protege ningún dato.
- Las políticas RLS de `anon` permiten leer todo a cualquiera con la publishable key, que es
  pública por diseño.
- La `x-api-key` es una medida **provisional**, no autenticación: la clave está en el bundle
  del frontend.

> ⚠️ **Bloqueo consciente: los datos maestros NO se importan a la base remota.**
>
> `productores` y `entidades` contienen **452 fichas reales con nombre, NIF, teléfono, email
> y dirección**. Con `anon` teniendo `SELECT` y la publishable key incrustada en el bundle,
> cualquiera que alcance la aplicación puede volcar la base entera llamando a la API REST.
>
> Hoy lo único que lo impide es que el despliegue de Vercel tiene **Deployment Protection**
> (SSO) y no tiene dominio público: es una protección **de plataforma, no del sistema**. En
> cuanto se le ponga un dominio propio o se desactive esa protección, la exposición es
> inmediata. Verificado el 21-07-2026: la API remota responde a `anon` con la publishable key.
>
> Por eso el esquema sí está desplegado (tablas vacías) pero **el import solo se ha ejecutado
> contra la base local**. Antes de importar a remoto o de publicar el frontend hace falta
> autenticación real (Supabase Auth + RLS sobre `authenticated`). Es un asunto de RGPD, no
> deuda técnica aplazable.

**Tarea pendiente anotada, no implementar sin pedirlo:** Supabase Auth, RLS por usuario
autenticado, quitar los `--no-verify-jwt` y retirar la `x-api-key`.

## 10. Variables de entorno

**Frontend** (`.env.local`, ignorado por git; plantilla en `.env.local.example`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`)
- `VITE_WA_SEND_API_KEY` (la misma que `WHATSAPP_SEND_API_KEY`)

**Edge Functions** (secrets de Supabase):

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_SEND_API_KEY` (generar con `openssl rand -hex 24`)
- `WHATSAPP_API_VERSION` (default `v23.0`)
- `ALLOWED_ORIGIN` — admite **varios orígenes separados por comas** y `*` como comodín
  dentro de un origen, porque los despliegues de Vercel no tienen URL estable. Valor actual:
  `http://localhost:5173,https://pdapp-*-carlessanz-projects.vercel.app`. Si algún día se le
  pone un dominio propio a la app, hay que añadirlo aquí o el navegador bloqueará los envíos.
- `SB_SECRET_KEY` (`sb_secret_...`)
- `SUPABASE_URL` (la inyecta Supabase automáticamente)

**Scripts**: `SUPABASE_URL` y `SB_SECRET_KEY` en el entorno.

## 11. Comandos

```bash
npm run dev                # Vite en local
npm run build              # tsc && vite build  ← única verificación automática que existe
npm run preview            # servir el build

supabase db push                                          # aplicar migraciones
supabase functions deploy whatsapp-send    --no-verify-jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase secrets set --env-file .secrets.env

deno run -A scripts/import-ara.ts --dry-run   # analizar sin escribir
deno run -A scripts/import-ara.ts             # importar los CSV maestros
```

`npm run build` corre `tsc` con `strict`, `noUnusedLocals` y `noUnusedParameters`:
**es la comprobación que debes ejecutar tras cada cambio**, porque no hay nada más.

## 12. Deuda técnica conocida

1. **Sin tests, sin linter, sin CI.** La única red de seguridad es `tsc`.
2. La `x-api-key` de `whatsapp-send` no es autenticación real: viaja en el bundle.
3. `ProducersList` carga **todos** los `wa_messages` sin filtro ni paginación para contar los
   no contestados, y se suscribe a Realtime sin filtro. No escala.
4. `Conversation` carga el hilo completo sin paginación.
5. `ContactList` recibe una lista ya filtrada a un elemento con la prop `single`: la sidebar
   es vestigial desde que el flujo entra por productores. Candidata a desaparecer.
6. `openMessagingWith()` hace upsert + update siempre (dos round-trips) aunque nada cambie.
7. Plantilla `hello_world` / `en_US` fija en el código; faltan las plantillas propias
   (`oferta_excedent`, `confirmacio_productor`) y su alta en Meta.
8. `index.css` es un único fichero global de ~475 líneas con clases sin namespace.
9. `MessageRow` en `ProducersList` duplica parte de `WaMessage`; `types.ts` no modela `raw`.
10. Hay migraciones que **borran datos** (`truncate wa_messages`) mezcladas con DDL.
11. Sin FK entre `productores`, `wa_contacts` y `wa_messages` (unidas por `phone`).
12. `productos_habituales` vacío hasta que se reexporte `prod_actius.csv` con la columna
    Producte; mientras tanto el intake tendrá que ofrecer el catálogo completo por familias.
13. Datos que condicionan la futura priorización de entidades: `estat` tiene **6 valores**
    (`Signat` 62, `Pendent` 36, `No procedeix` 7, vacío 4, `Pendent entitat` 1,
    `Pendent Espigoladors` 1) y la spec solo contempla dos; y `prioritat` casi no discrimina
    (97 de 111 entidades son prioridad 1).
14. `scripts/import-ara.ts` está verificado end-to-end contra la base local (dos pasadas:
    la segunda actualiza, no duplica). **No se ha ejecutado nunca contra la base remota.**

## 13. Al terminar cualquier cambio

1. `npm run build` en verde.
2. **Actualizar este fichero** si cambió arquitectura, datos, contratos, convenciones,
   comandos o deuda técnica.
3. Commit en castellano, describiendo el *qué* y el *por qué*.
