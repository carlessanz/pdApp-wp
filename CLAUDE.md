# CLAUDE.md

Contexto para Claude Code en este repositorio.

Todo el contexto del proyecto —arquitectura, modelo de datos, flujos, convenciones,
reglas de negocio, seguridad, comandos y deuda técnica— vive en un único documento
canónico, que se importa aquí:

@AGENTS.md

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
