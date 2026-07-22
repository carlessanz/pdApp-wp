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

Actualmente en **entorno de pruebas** de Meta y en **modo prueba de concepto**: no se envía
ninguna notificación real por WhatsApp (interruptor `WHATSAPP_ENVIO_REAL`, §8).

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
    poma.ts                    priorizarEntidades(): llama a la Edge Function con el JWT
    textos.ts                  RECOLLIDA CONFIRMADA y albarán (los compone el panel)
  components/
    AuthGate.tsx               Login real con Supabase Auth (ver §9)
    OffersList.tsx             Ofertas activas con kg en vivo (Realtime)
    OfferDetail.tsx            Detalle: priorización, canalizaciones, opt-in, cierre
    ProducersList.tsx          Tabla de productores + badge "sin contestar"
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
    priorizar-entidades/       POST: ranking de entidades para un excedente (JWT)
    whatsapp-send/index.ts     POST: reglas de envío; delega en _shared
    whatsapp-webhook/index.ts  GET verificación / POST recepción; engancha el intake
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

`service_role` acceso total en todas (lo usan las Edge Functions); **`authenticated`** con
`SELECT` y, solo en `wa_contacts`, `INSERT`/`UPDATE`. `anon` **no tiene ningún privilegio**
desde `20260721160000_auth_authenticated.sql`. Sin `INSERT` en `wa_messages` para nadie
salvo el servidor: el envío pasa siempre por la Edge Function. Realtime en `wa_contacts`,
`wa_messages`, `excedentes` y `canalizaciones`.

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

**Intake conversacional** — un productor escribe → el webhook lo identifica por `phone` en
`productores` → `procesarIntake()` (`_shared/intake.ts`). El estado vive en
`intake_sessions` (una fila por teléfono) y cada mensaje se interpreta según `paso_actual`.
Al completarse, `crearExcedenteDesdeSesion()` da de alta el excedente y avisa al productor.
Detalle en §6bis.

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
productor sin sesión abierta, POMA responde *"Hola X! Vols oferir un excedent?"* con botones.
Es una desviación deliberada del POMA §8, que hacía que *cualquier* mensaje lanzara el
formulario: con 271 productores escribiendo por cualquier motivo, eso secuestra
conversaciones normales.

**La paginación es el caso normal.** Las listas de WhatsApp admiten 10 filas: se muestran 9
opciones y la décima es "Més…". Hace falta porque hay **12 familias** y cuatro superan los
10 productos (Horta Tub/Bul/Arr 16, Fruita Dolça 14, Horta Fruit 14, Horta Fulla 12).

**Casos que el motor ya contempla:**

- Respuesta que no encaja: se repite la pregunta, máximo 2 veces, y luego se ofrece cancelar.
- `CANCEL·LAR` / `CANCELAR` descarta la sesión en cualquier momento.
- Sesión inactiva más de 12 h: se descarta y se empieza de cero.
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
Ofertas / Detalle). Navegación: barra superior de 3 secciones —Ofertas | Productores |
Mensajería— en `App.tsx`.

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

> ⚠️ **Modo prueba de concepto: no se envía nada por WhatsApp.** El interruptor
> **`WHATSAPP_ENVIO_REAL`** (env var) gobierna el único punto que llama a la Graph API
> (`enviar()` en `_shared/whatsapp.ts`). Solo si vale exactamente `"true"` sale algo; por
> defecto —y hoy en remoto, donde el secreto no está puesto— **no se contacta con Meta**. Los
> salientes se registran igual en `wa_messages` con `status='simulat'` (visibles en la consola).
> Afecta a TODO: intake, confirmaciones ALTA/BAJA y envío de ofertas a entidades. Para activar
> los envíos reales: `supabase secrets set WHATSAPP_ENVIO_REAL=true` (y en local, en el
> env-file al servir). El webhook **sigue recibiendo**; solo se corta la salida.

**Reglas de envío** (decisión D1 del manual; implementadas en `whatsapp-send`; se evalúan
antes del interruptor de arriba, así que en modo PoC un envío bloqueado por regla ni siquiera
llega a simularse):

| Tipo | Condición | Si no se cumple | Por qué |
| --- | --- | --- | --- |
| `text` | ventana de 24 h abierta (`last_inbound_at` < 24 h) | `409 window_closed` | Es una respuesta de servicio; **no** requiere opt-in |
| `template` | `opt_in = true` | `403 no_opt_in` | La iniciamos nosotros: requiere consentimiento (RGPD + Meta) |

Contacto inexistente → `404 unknown_contact`. Sin sesión válida → `401 unauthorized`.

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

### Ningún flujo envía correos

Requisito explícito mientras estemos en pruebas. Se cumple así:

- `enable_confirmations = false` y `mailer_autoconfirm = true`: el alta no manda
  confirmación. Verificado en local y en remoto vía `/auth/v1/settings`.
- Las cuentas se crean con `admin.createUser({ email_confirm: true })`, que da el
  correo por verificado **sin enviar nada**.
- **No usar nunca** `inviteUserByEmail()`, `resetPasswordForEmail()` ni
  `signInWithOtp()`/magic links: los tres envían correo de verdad. Por eso el
  formulario de login no ofrece "he olvidado mi contraseña" ni registro.
- En local los correos irían a Mailpit (`http://127.0.0.1:55324`) sin salir a
  internet; sirve para comprobar que la bandeja sigue vacía.

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
- `WHATSAPP_ENVIO_REAL` — solo `"true"` activa los envíos reales; ausente = modo PoC (§8)
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
supabase functions deploy whatsapp-send        # con verify_jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy priorizar-entidades  # con verify_jwt
supabase secrets set --env-file .secrets.env

deno run -A scripts/import-ara.ts --dry-run   # analizar sin escribir
deno run -A scripts/import-ara.ts             # importar los CSV maestros
```

`npm run build` corre `tsc` con `strict`, `noUnusedLocals` y `noUnusedParameters`:
**es la comprobación que debes ejecutar tras cada cambio**, porque no hay nada más.

## 12. Checkpoints de negocio y deuda técnica

**Checkpoints que NO son código** (POMA §10): la construcción está completa, pero para poner
POMA en producción real quedan pasos de configuración y negocio.

1. **Salir del modo PoC**: poner `WHATSAPP_ENVIO_REAL=true` cuando de verdad se quiera enviar.
2. **Plantillas propias en Meta**: `oferta_excedent` y `confirmacio_productor` hay que darlas
   de alta y esperar su aprobación. En test solo `hello_world` está aprobada, así que el envío
   real de la oferta no funciona hasta entonces.
3. **Opt-in real de las entidades**: hoy `false` en las 111; el toggle deja la mecánica, pero
   recoger el consentimiento es trabajo de negocio.
4. **Formato definitivo del albarán**: se genera con placeholders (`src/lib/textos.ts`); el
   formato legal del Excel se confirma al integrarlo.
5. **Reexportar `prod_actius.csv`** con la columna Producte para rellenar `productos_habituales`
   (hoy vacío: el intake ofrece el catálogo completo por familias).
6. **Paso a producción de Meta**: número real, verificación de empresa, método de pago.

**Deuda técnica:**

1. **Sin tests, sin linter, sin CI.** La única red de seguridad es `tsc`.
2. **No hay roles**: cualquier usuario autenticado lo ve y lo puede todo. Con 452 fichas
   reales, dar de alta una cuenta = dar acceso a todo.
3. El intake avanza de paso aunque falle el envío: si la red falla, el productor no recibe la
   pregunta pero la sesión ya avanzó, y su siguiente mensaje se lee como respuesta al paso nuevo.
4. `disponible_hasta` se guarda `null` (el productor responde en texto libre); el técnico lo
   normaliza en el panel, y hasta que lo haga el job de vencidas no actúa sobre ese excedente.
5. `ProducersList` carga **todos** los `wa_messages` sin filtro ni paginación para contar los
   no contestados, y se suscribe a Realtime sin filtro. No escala. Igual `OffersList`, que
   recarga entero ante cualquier cambio de Realtime.
6. `Conversation` carga el hilo completo sin paginación.
7. `ContactList` recibe una lista ya filtrada a un elemento con la prop `single`: vestigial.
8. `index.css` es un único fichero global (~680 líneas) con clases sin namespace.
9. `types.ts` no modela `raw`; `MessageRow` en `ProducersList` duplica parte de `WaMessage`.
10. Hay migraciones que **borran datos** (`truncate wa_messages`) mezcladas con DDL.
11. Sin FK entre `productores`, `wa_contacts` y `wa_messages` (unidas por `phone`).
12. `prioritat` casi no discrimina (97 de 111 entidades son prioridad 1): aporta poco al ranking.

## 13. Al terminar cualquier cambio

1. `npm run build` en verde.
2. **Actualizar este fichero** si cambió arquitectura, datos, contratos, convenciones,
   comandos o deuda técnica.
3. Commit en castellano, describiendo el *qué* y el *por qué*.
