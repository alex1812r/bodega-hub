<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Documentación del proyecto

Índice y catálogo maestro de módulos: [`docs/README.md`](docs/README.md) y [`docs/modules-catalog.md`](docs/modules-catalog.md).

Antes de modificar caja, baúl, pagos o cierres, leer [`docs/cuadre-baul.md`](docs/cuadre-baul.md): contiene el diagnóstico vigente del descuadre de efectivo y el plan de arreglo. No añadir más parches one-shot de backfill al baúl sin revisarlo.

Antes de tocar RPC de stock, leer `docs/stock-integrity.md` y correr `npm run stock-lab:run`.

Para ejecutar un plan de `docs/agent-prompts/*-gtm.md` en modo equipo (gerente + supervisor + coders + fixer + caos + QA), seguir [`docs/agent-prompts/equipo.md`](docs/agent-prompts/equipo.md); los roles están en `.claude/agents/`.
