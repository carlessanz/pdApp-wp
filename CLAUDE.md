# CLAUDE.md

Contexto para Claude Code en este repositorio.

Todo el contexto del proyecto —arquitectura, modelo de datos, flujos, convenciones,
reglas de negocio, seguridad, comandos y deuda técnica— vive en un único documento
canónico, que se importa aquí:

@AGENTS.md

## Visión funcional del producto

**POMA** es un **servicio** de la Fundació Espigoladors apoyado por tecnología, que actúa como
**ERP del servicio**: canaliza excedentes agrícolas por cinco líneas —donación social (core),
salida comercial, transformación por maquila, espigueo y diagnóstico/prevención— con un equipo de
dinamización que opera de forma **asistida** en nombre de las organizaciones. Lo construido hoy es
un **subconjunto** de esa visión (Fase 1 WhatsApp + POMA núcleo: intake, priorización, canalización
y cierre básico); falta el grueso del modelo objetivo (organización multirol, convenios, demandas,
conciliación real, certificados, back office con roles, diagnóstico/planes).

- **Versión reducida + correspondencia objetivo↔construido:** `AGENTS.md §1bis` (se importa arriba;
  es la fuente mantenida de este resumen).
- **Funcional completo adaptado** (con estado de implementación por sección): `docs/Documento
  funcional POMA 2026 — adaptado.md`.
- **Funcional original** (visión de negocio íntegra): `docs/Documento funcional POMA 2026.md`.

Ambos documentos de `docs/` están **fuera de git** (§7). Para el detalle de negocio mandan esos
funcionales; para el **estado real construido**, manda `AGENTS.md`.

## Regla permanente

**Cada modificación debe dejar `AGENTS.md` al día en el mismo cambio.** Al importarse
desde aquí, mantener ese fichero actualizado mantiene actualizado también este.
No dupliques contenido en `CLAUDE.md`: se desincronizaría.

Actualiza `AGENTS.md` cuando cambie cualquiera de estas cosas:

- estructura de ficheros o responsabilidades de los componentes
- esquema de la base de datos, políticas RLS o migraciones
- contratos de las Edge Functions (`whatsapp-send`, `whatsapp-webhook`)
- convenciones, reglas de negocio o postura de seguridad
- variables de entorno o comandos
- deuda técnica: lo que se resuelva se tacha, lo que se introduzca se anota

## Antes de dar por terminado un cambio

1. `npm run build` (corre `tsc` en modo `strict`; es la única verificación automática).
2. `AGENTS.md` actualizado.
3. Commit en castellano.
