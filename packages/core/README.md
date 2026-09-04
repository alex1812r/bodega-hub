# @bodega/core

Codigo **puro** compartido entre la web (`src/`) y BodegaHub Mobile (`../bodegahub-app`).

Reglas:

- Sin React, sin Next, sin Node APIs, sin `fetch`, sin acceso a `window`/`document`.
- Solo logica de negocio y datos: permisos, moneda, fechas de Caracas, bancos y
  telefonos venezolanos, metodos de pago, generacion de SKU y los periodos de los
  indicadores del dashboard.
- Se consume **como fuente TypeScript**, sin paso de build. Por eso la web declara
  `transpilePackages: ["@bodega/core"]` en `next.config.ts` y Metro necesita
  `watchFolders` en `metro.config.js` de la app.

Los modulos originales de `src/shared/` se conservan como re-exports de una linea,
asi que ningun import de la web cambia y los tests existentes siguen cubriendo esta
implementacion.

## Uso

```ts
import { hasPermission } from "@bodega/core/permissions";
import { refToVes, roundMoney } from "@bodega/core/currency";
import { resolveKpiMetricsFilters } from "@bodega/core/dashboard";
```
