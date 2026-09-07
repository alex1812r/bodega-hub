# Nómina de cajeros — plan de ejecución autónoma hasta GTM

> **Para el humano:** abre Claude Code en la raíz del repo (rama `main` actualizada) y escribe:
> `Ejecuta docs/agent-prompts/nomina-gtm.md de principio a fin. No te detengas hasta cumplir la sección 11.`
> Antes de lanzarlo, revisa los valores por defecto de la sección 3 (porcentaje de comisión y umbral del semáforo). Se pueden cambiar después desde la pantalla de configuración de nómina.

---

## 0. Misión

Agregar a BodegaHub un **módulo de nómina sencillo** para pagar a los **cajeros** (rol `vendedor`) cada quincena una **comisión acumulada sobre sus ventas**. El **admin es el dueño**: no cobra nómina; sus retiros ya existen como retiros del baúl.

Modelo de pago (fijo, no reabrir):

- **Sin sueldo fijo.** Todo lo que cobra el cajero es `porcentaje × ventas comisionables` de la quincena.
- **Ventas comisionables** = ventas creadas por ese cajero (`sales.user_id`) en la quincena, con `status = 'pagada'` al momento de calcular, medidas en `total_ref`. Cada venta comisiona **una sola vez** en toda la historia (tabla `payroll_commission_sales`, `sale_id` único).
- **Cobros tardíos**: una venta `pendiente_pago` no comisiona; cuando pase a `pagada` entra en la quincena que se calcule después de cobrarla, marcada como "cobrada tarde".
- **Reversos**: si una venta ya comisionada se cancela o devuelve, la siguiente quincena resta esa comisión como ajuste negativo; el total de la quincena nunca baja de 0.
- **Porcentaje por cajero** (`commission_pct`, con default en configuración). Snapshot en cada quincena: cambiar el % no altera quincenas ya calculadas y aprobadas.
- El pago sale del **baúl** (efectivo Bs, efectivo USD o cuenta) con movimiento `payroll_out`, para que el cuadre siga cerrando.
- La ganancia bruta, gastos fijos y FX **no** intervienen en el cálculo; se muestran solo como **semáforo** (sección 3) para que el dueño vea qué parte del margen se está yendo en comisiones.

Entregable: rama `feat/payroll` lista para merge con parches SQL, API, UI, tests, e2e en navegador, docs y reporte final. **No terminas hasta cumplir la sección 11.**

---

## 1. Reglas de operación

1. **Autonomía total.** No pidas confirmación ni propongas alternativas. Decide con este documento y ejecuta. No hay preguntas permitidas al humano; si algo bloquea, elige la opción más simple que cumpla la sección 11 y anótalo en el reporte.
2. **Silencio operativo.** La única salida al humano es el reporte final (sección 12, ≤ 35 líneas).
3. **Economía de tokens.** `grep`/`sed -n`, no archivos enteros. Subagentes devuelven ≤ 15 líneas.
4. **Next 16 y versiones instaladas.** Lee `node_modules/next/dist/docs/` antes de tocar rutas o páginas (lo exige `AGENTS.md`).
5. **Navegador obligatorio.** Cada pantalla y flujo se verifica en el navegador con capturas (Claude in Chrome, Playwright MCP o script Playwright en `scripts/e2e-payroll/`). Nunca pidas al humano que pruebe.
6. **Git.** Rama `feat/payroll` desde `main`. Commits pequeños en inglés imperativo. Push permitido. Nunca merge a `main`, nunca force push, nunca tocar Vercel ni Supabase de producción.
7. **SQL.** Parches idempotentes en `supabase/patches/YYYYMMDD-*.sql` con `notify pgrst, 'reload schema';`. No los aplicas (sin acceso al SQL Editor); los listas en el reporte. Todo debe funcionar también en `API_DATA_SOURCE=mock`.
8. **No rompas nada.** `npm run typecheck && npm run lint && npm test && npm run build` en verde al cerrar cada fase.
9. **Estilo del repo.** Screaming architecture, `*.server.ts` / `*.mock-server.ts`, `requireStorePermission`, `resolveDataSource`, `jsonData`, `toErrorResponse`, componentes de `src/shared/components/`. Copia los patrones de `src/modules/vault/` y `src/modules/cash/`. Español en toda la UI.
10. **Dinero.** Todo en REF con snapshot de tasa al pagar, como ventas y compras. `roundMoney` de `src/shared/utils/currency.ts`. Nunca recalcular una quincena pagada con tasas nuevas.
11. **Nada de reglas laborales inventadas.** El módulo no calcula sueldo mínimo, utilidades, prestaciones ni vacaciones. Eso se documenta como fuera de alcance, con la nota de que un esquema 100 % variable debe validarlo un contador.

---

## 2. Contexto obligatorio (una lectura)

| Archivo | Qué extraer |
|---------|-------------|
| `AGENTS.md`, `docs/README.md`, `docs/modules-catalog.md` (§Caja, §Baúl, §Reportes, §Settings, §RPC) | Patrones, endpoints, permisos |
| `docs/cuadre-baul.md` §1 | Los tres saldos del baúl y sus cubetas; de dónde sale el efectivo |
| `docs/auth-permissions.md` | Roles y overrides |
| `supabase/patches/20260811b-cash-registers-vault.sql`, `20260812c-vault-efectivo-vs-cuenta.sql` | `store_vaults`, `vault_movements` (tipos, `bucket`), RPC `register_vault_withdrawal`, `ensure_store_vault`, patrón `security definer` + `assert_store_context()` |
| `supabase/patches/20260906-store-capital-summary.sql` (si existe) | Patrón de vista + RLS reciente |
| `supabase/supabase-schema.sql` → vista `gross_profit_summary`, tabla `profiles`, `exchange_rates`, enum `payment_method` | Fuente de ganancia bruta, empleados, tasa |
| `src/modules/reports/services/reports.server.ts` (`getGrossProfitReport`), `fxDepreciationReport.server.ts` (`summary.vesLossRef`) y sus mocks | Cómo obtener ganancia bruta y pérdida FX por rango |
| `src/shared/utils/caracasBusinessDay.ts`, `src/modules/dashboard/utils/kpiPeriod.ts` | Día operativo Caracas y parseo de rangos |
| `src/lib/exchange-rates/*` | Tasa vigente en servidor |
| `src/modules/vault/**` (services, hooks, page, modales) | Patrón completo a copiar |
| `src/modules/settings/**` (usuarios, tasas) | Listado de usuarios de la tienda y tabs de configuración |
| `src/shared/auth/permissions.ts`, `src/shared/components/AppShell/appShellNav.ts` | Permiso y menú |
| `src/app/api/vault/route.test.ts`, `src/modules/cash/services/cash.session.mock-server.test.ts` | Patrón de tests |
| `public/openapi.yml` | Dónde documentar los endpoints |
| `docs/agent-prompts/chat-ia-gtm.md` §5 (solo si existe `src/modules/assistant/`) | Cómo registrar una tool nueva en el asistente |

---

## 3. Decisiones fijas y valores por defecto

| Tema | Decisión |
|------|----------|
| Quincenas | Q1 = día 1–15, Q2 = día 16–último día del mes, en **día operativo America/Caracas** (`[T04:00Z, siguiente T04:00Z)`). Identificador `YYYY-MM-Q1` / `YYYY-MM-Q2`. |
| Empleados elegibles | Perfiles activos de la tienda con rol `vendedor`. (Roles `almacen`/`contador` habilitables desde configuración; por defecto no.) El rol `admin` nunca. Las ventas hechas por el admin no comisionan a nadie. |
| Defaults `payroll_settings` | `default_commission_pct = 3`, `warn_share_of_gross_profit_pct = 40` (semáforo), `reinvest_pct = 45` y `reserve_pct = 20` (solo informativos para el desglose del dueño). |
| Base comisionable | `sum(sales.total_ref)` de ventas con `user_id = cajero`, `status = 'pagada'`, `created_at` dentro de la quincena (día Caracas) y sin fila previa en `payroll_commission_sales`. Más las ventas de quincenas anteriores que cumplan lo mismo y aún no hayan comisionado (cobradas tarde), etiquetadas `late`. Menos reversos: ventas con fila en `payroll_commission_sales` cuyo `status` actual sea `cancelada`/`devuelta` y sin reverso registrado, etiquetadas `reversal` con monto negativo. |
| Comisión | `round(sale.total_ref × commission_pct / 100, 2)` por venta (para que el detalle sea auditable línea a línea) y suma por ítem. Total del ítem = `max(0, Σ comisiones + Σ reversos)`. |
| Snapshot | `payroll_periods` guarda `gross_profit_ref` (informativo), `sales_ref`, `commission_ref`, `reversal_ref`, `total_ref`, `share_of_gross_profit_pct`. Un periodo `pagado` es inmutable. Un `borrador` se puede **recalcular** hasta aprobarlo. Las filas de `payroll_commission_sales` se crean al **aprobar** (no al calcular), para que recalcular no deje ventas "gastadas". |
| Semáforo | En el detalle: `comisiones / ganancia bruta de la quincena`. Verde < 25 %, ámbar 25–40 %, rojo > 40 % (umbral configurable). Solo informa; nunca bloquea el pago. Texto de ayuda: "lo que queda después de comisiones es lo disponible para gastos, reinversión y reserva". |
| Pago | Por ítem (un cajero) o "pagar todos". Métodos: `efectivo_ves`, `efectivo_usd`, `pago_movil`, `transferencia` (cuenta). Tasa = vigente al pagar (misma fuente que compras). Movimiento `vault_movements.type = 'payroll_out'` con `bucket` `efectivo` (Bs o USD) o `cuenta`, `payroll_item_id`, validación de saldo con el mismo mensaje que compras. Un ítem con total 0 se marca `pagado` sin movimiento. |
| Anulación | `cancel_payroll_payment(item_id)` solo admin, revierte el movimiento del baúl y vuelve el ítem a `pendiente`. Si el periodo estaba `pagado`, vuelve a `aprobado`. |
| Permisos | `payroll.manage` (admin: todo). `payroll.view_own` (vendedor: solo sus recibos en `/payroll/mine`, con el detalle de sus ventas comisionadas). Superadmin: nada. |
| Rutas UI | `/payroll` (quincena actual + historial), `/payroll/[periodId]` (detalle, aprobar, pagar, recibos), `/payroll/settings` (parámetros y empleados), `/payroll/mine` (vendedor). Menú "Nómina" con icono `HandCoins` de lucide, después de "Baúl". |
| Recibo | PDF con `jspdf`: tienda, cajero, quincena, número de ventas, ventas comisionables REF, %, reversos, total REF, pagado (moneda, monto, tasa, método, referencia), fecha. Anexo con la lista de ventas (número, fecha, total, comisión). |
| Asistente IA | Si existe `src/modules/assistant/server/toolRegistry.ts`, registrar tool `nomina_quincena` (tienda) que devuelve el snapshot de la quincena pedida y `comision_estimada_actual` para la quincena en curso. Si no existe, omitir. |
| Móvil | Fuera de este plan. Añadir una fila "Nómina — pendiente móvil" en `docs/agent-prompts/mobile-app-gtm.md` §5. |

---

## 4. Modelo de datos (parche `supabase/patches/YYYYMMDD-payroll.sql`)

```sql
create table public.payroll_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  default_commission_pct numeric(5,2) not null default 3 check (default_commission_pct between 0 and 100),
  warn_share_of_gross_profit_pct numeric(5,2) not null default 40,
  reinvest_pct numeric(5,2) not null default 45, reserve_pct numeric(5,2) not null default 20,
  eligible_roles public.user_role[] not null default array['vendedor']::public.user_role[],
  updated_at timestamptz not null default now()
);

create table public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  commission_pct numeric(5,2) not null check (commission_pct between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (store_id, profile_id)
);

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_key text not null,                      -- 2026-09-Q1
  from_date date not null, to_date date not null,
  status text not null default 'borrador' check (status in ('borrador','aprobado','pagado')),
  sales_ref numeric(14,2) not null default 0,        -- base comisionable total
  commission_ref numeric(14,2) not null default 0,
  reversal_ref numeric(14,2) not null default 0,     -- negativo o 0
  total_ref numeric(14,2) not null default 0,
  gross_profit_ref numeric(14,2),                    -- informativo (semáforo)
  share_of_gross_profit_pct numeric(6,2),
  approved_at timestamptz, approved_by uuid references public.profiles(id),
  paid_at timestamptz, notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (store_id, period_key)
);

create table public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete restrict,
  profile_id uuid not null references public.profiles(id),
  commission_pct numeric(5,2) not null,              -- snapshot
  sales_count int not null default 0,
  sales_ref numeric(14,2) not null default 0,
  commission_ref numeric(14,2) not null default 0,
  reversal_ref numeric(14,2) not null default 0,
  total_ref numeric(14,2) not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente','pagado')),
  paid_method public.payment_method, paid_currency public.payment_currency,
  paid_amount numeric(14,2), paid_ves numeric(14,2), paid_ref numeric(14,2),
  paid_rate_ves numeric(14,4), paid_reference text, paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  vault_movement_id uuid references public.vault_movements(id),
  unique (period_id, employee_id)
);

-- Cada venta comisiona una sola vez. Se llena al APROBAR el periodo.
create table public.payroll_commission_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  item_id uuid not null references public.payroll_items(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  kind text not null check (kind in ('normal','late','reversal')),
  sale_total_ref numeric(14,2) not null,
  commission_ref numeric(14,2) not null,             -- negativo si reversal
  created_at timestamptz not null default now()
);
create unique index payroll_commission_sales_once_idx
  on public.payroll_commission_sales (sale_id) where kind in ('normal','late');
create unique index payroll_commission_sales_reversal_once_idx
  on public.payroll_commission_sales (sale_id) where kind = 'reversal';
```

Además: `alter table public.vault_movements` → ampliar el CHECK de `type` con `'payroll_out'` y columna `payroll_item_id uuid references public.payroll_items(id)`. RLS: admin de la tienda gestiona todo; `vendedor` solo `select` de sus `payroll_items`, sus `payroll_commission_sales` y los `payroll_periods` asociados. Triggers `set_updated_at`. Índices por `(store_id, from_date desc)`, `(profile_id, period_id)`, `(sales.user_id, created_at)` si no existe.

RPC (todas `security definer`, `assert_store_context()`, solo `admin` salvo lectura):

| RPC | Hace |
|-----|------|
| `upsert_payroll_settings(...)` | Guarda parámetros; crea la fila si no existe. |
| `preview_payroll_commissions(p_from, p_to)` | Devuelve, por empleado activo, las ventas candidatas (`normal`, `late`, `reversal`) con su comisión calculada, sin escribir nada. Lo usa el cálculo y la tarjeta "quincena en curso (estimación)". |
| `compute_payroll_period(p_period_key, p_gross_profit_ref)` | Crea o recalcula el periodo (`borrador`) y sus ítems a partir de `preview_payroll_commissions`; guarda `gross_profit_ref` (que el BFF obtiene de `getGrossProfitReport`) y el `share_of_gross_profit_pct`. Rechaza si `to_date` es futuro o el periodo está `aprobado`/`pagado`. |
| `approve_payroll_period(p_period_id)` | Recalcula una última vez dentro de la transacción, escribe `payroll_commission_sales` (falla si alguna venta ya está comisionada: carrera con otro periodo), `borrador → aprobado`. |
| `pay_payroll_item(p_item_id, p_method, p_amount, p_bank_name, p_reference)` | Solo periodos `aprobado`; tasa vigente como `register_payment` para compras; valida saldo por cubeta; inserta `vault_movements('payroll_out')`; descuenta; marca `pagado`; si todos pagados → periodo `pagado`. Doble pago → error. Total 0 → `pagado` sin movimiento. |
| `cancel_payroll_payment(p_item_id)` | Revierte movimiento y saldo; ítem `pendiente`; periodo `aprobado`. No toca `payroll_commission_sales`. |

---

## 5. API y frontend

### Endpoints (`src/app/api/payroll/`)

| Método | Ruta | Permiso | Servicio |
|--------|------|---------|----------|
| GET/PATCH | `/api/payroll/settings` | `payroll.manage` | settings + lista de empleados elegibles (perfiles activos con rol elegible, con su fila de `payroll_employees` si existe) |
| PUT | `/api/payroll/employees/[profileId]` | `payroll.manage` | base, peso, activo |
| GET | `/api/payroll/periods` | `payroll.manage` | paginado, más reciente primero |
| POST | `/api/payroll/periods` | `payroll.manage` | body `{ periodKey }` → BFF calcula ganancia y FX con `getGrossProfitReport`/`getFxDepreciationReport` (rango Caracas) → RPC `compute_payroll_period` |
| GET | `/api/payroll/periods/[id]` | `payroll.manage` o dueño del ítem | detalle con ítems, ventas comisionadas por ítem, semáforo y desglose informativo (ganancia bruta − comisiones, reinversión y reserva sugeridas) |
| POST | `/api/payroll/periods/[id]/recompute` | `payroll.manage` | solo `borrador` |
| POST | `/api/payroll/periods/[id]/approve` | `payroll.manage` | — |
| POST | `/api/payroll/items/[id]/pay` | `payroll.manage` | body `{ method, amount, bankName?, reference? }` |
| POST | `/api/payroll/items/[id]/cancel-payment` | `payroll.manage` | — |
| GET | `/api/payroll/mine` | `payroll.view_own` | ítems del usuario con su periodo |
| GET | `/api/payroll/current` | `payroll.manage` | clave de la quincena en curso y de la anterior, si ya existen, y la estimación viva por empleado |
| GET | `/api/payroll/mine/current` | `payroll.view_own` | estimación viva del propio cajero |

Mock (`*.mock-server.ts`) con paridad total, incluida la segunda tienda mock si existe, para tests y e2e.

### Pantallas (`src/modules/payroll/`)

- **`payroll-home`** (`/payroll`): tarjeta "Quincena anterior" (`YYYY-MM-Qx`, estado, total, botón *Calcular* / *Ver*), tarjeta "Quincena en curso" (estimación viva con `preview_payroll_commissions`, marcada *estimación*), historial en `DataTable`/tarjetas con estado y total. Aviso si no hay empleados con % configurado.
- **`payroll-period-detail`** (`/payroll/[id]`): cabecera con ventas comisionables → comisión → reversos → **total nómina**; semáforo `comisiones / ganancia bruta` con el texto de ayuda de §3 y, debajo, "queda para gastos, reinversión y reserva: ganancia bruta − comisiones" con el desglose informativo 45/20. Tabla de ítems: cajero, nº ventas, ventas REF, %, comisión, reversos, total, estado, acciones (*Pagar*, *Anular pago*, *Recibo PDF*, *Ver ventas* → sheet/modal con la lista de ventas comisionadas, etiquetando `late` y `reversal`). Botones *Recalcular* (borrador), *Aprobar*, *Pagar todos*. Panel lateral "Disponible en baúl" con los tres saldos y advertencia si no alcanza. Modal de pago = copia adaptada del modal de pago de compras (método → campos).
- **`payroll-settings`** (`/payroll/settings`): formulario de parámetros con explicación de una línea por campo y un **simulador**: "con ventas de X REF al Y %, la comisión sería Z; eso es W % de la ganancia bruta promedio de las últimas 3 quincenas" en vivo (el promedio sale de `getGrossProfitReport`). Tabla de empleados elegibles con % de comisión y activo.
- **`payroll-mine`** (`/payroll/mine`): lista de recibos del vendedor con descarga PDF y el detalle de sus ventas comisionadas; además "comisión acumulada de la quincena en curso" (estimación). Sin cifras del negocio (no muestra ganancia ni semáforo).
- Hooks TanStack Query con `queryKey` descriptivos e invalidación tras cada mutación (también invalidar `vault` tras pagar).
- Menú "Nómina" con permiso `payroll.manage`; "Mis recibos" con `payroll.view_own`.

---

## 6. Fases

Cada fase cierra con typecheck, lint, tests y build en verde, verificación en navegador y commit.

1. **Fase 0** — Rama, lectura de contexto, notas de firmas en `.notes/` (gitignored).
2. **Fase 1 — Datos.** Parche SQL completo (sección 4) + RLS + RPC. Mock server con la misma semántica (incluido `payroll_out` en el baúl mock). Tests unitarios del cálculo puro en `src/modules/payroll/utils/payrollMath.ts` (`commissionForSale`, `sumItem`, `shareOfGrossProfit`; casos: % con decimales, ventas de 0.01, reversos que superan la comisión (total 0), venta cobrada tarde, ganancia bruta 0 → semáforo sin división por cero, redondeo por venta con `roundMoney`).
3. **Fase 2 — API.** Rutas de la sección 5 con tests (401/403/200, doble pago 409, aprobar sin ítems 400, pagar en borrador 400, saldo insuficiente 400 con código `INSUFFICIENT_VAULT_BALANCE`). Fechas de quincena en `src/modules/payroll/utils/quincena.ts` con tests de bordes (mes de 28/30/31 días, cambio de año, T04:00Z).
4. **Fase 3 — UI.** Cuatro pantallas, permisos y menú. Tests RTL de detalle (desglose y badges) y del simulador. Stories mínimas de `PayrollBreakdown` y `PayrollItemRow`.
5. **Fase 4 — Integraciones.** Recibo PDF; tool del asistente si aplica; `docs/modules-catalog.md` sección "Nómina"; `auth-permissions.md`; `openapi.yml`; fila en el plan móvil.
6. **Fase 5 — Verificación** (sección 8) hasta dos pasadas limpias.
7. **Fase 6 — Entrega.** Push y reporte.

---

## 7. Agentes

| Agente | Cuándo | Devuelve (≤ 15 líneas) |
|--------|--------|------------------------|
| **Orquestador** | Siempre | Coordina, integra, escribe el reporte |
| **Coder Datos** | Fase 1 | Parche + mock + tests de cálculo |
| **Coder API** | Fase 2 | Rutas + servicios + tests |
| **Coder UI** | Fase 3 | Pantallas + hooks + tests |
| **Tester** | Fin de cada fase | typecheck/lint/jest/build; fallos con causa raíz |
| **Navegante** | Fases 3–5 | Flujos de la sección 9 en navegador con capturas en `scripts/e2e-payroll/screenshots/` (gitignored) |
| **Caos** | Fase 5 | Sección 10 con evidencia y severidad |
| **Reparador** | Tras fallos | Fix mínimo + regresión + commit |
| **Auditor** | Última vuelta | `git diff main...HEAD`: aislamiento por tienda, RLS, dinero (redondeo, snapshots, inmutabilidad de pagados), consistencia del baúl, patrones del repo |

Los agentes no piden ayuda. El Orquestador nunca acepta "no se pudo probar en navegador".

---

## 8. Ciclo de calidad (hasta 2 pasadas limpias consecutivas)

1. `npm run typecheck && npm run lint && npm test && npm run build`.
2. Dev server en mock (`API_DATA_SOURCE=mock ALLOW_DEMO_AUTH=true npm run dev`) y flujos de la sección 9 en navegador (desktop 1280 y móvil 390, claro y oscuro en el detalle de quincena).
3. Sección 10 completa; altos y medios bloquean.
4. Auditoría; altos y medios se reparan.
5. Reparación → volver a 1.

---

## 9. Flujos e2e en navegador

1. Admin sin configurar → `/payroll` avisa que no hay empleados con % → `/payroll/settings` → fija 3 % por defecto y 4 % al cajero → guarda → el simulador muestra comisión y % de la ganancia bruta.
2. Admin → `/payroll` → *Calcular* quincena anterior → detalle: nº de ventas y total coinciden con `/sales` filtrado por cajero, estado pagada y rango → *Ver ventas* lista las mismas → *Aprobar*.
3. Admin → *Pagar* al cajero en `efectivo_ves` con saldo suficiente en el baúl mock → ítem pagado → periodo pagado → `/vault` muestra movimiento "Nómina" y saldo descontado.
4. Admin → *Anular pago* → baúl restaurado → periodo vuelve a aprobado → pagar en `pago_movil` con banco y referencia → recibo PDF descargable.
5. Admin → intentar pagar con saldo insuficiente (retirar antes del baúl) → error claro, nada cambia.
6. Admin → quincena con una venta del cajero cancelada después de una quincena aprobada (mock) → la siguiente quincena muestra el reverso y el total nunca es negativo; una venta `pendiente_pago` no aparece hasta cobrarse y luego aparece como *cobrada tarde*.
6b. Admin → semáforo en rojo (mock con margen bajo) → solo advierte, el pago sigue permitido.
7. Vendedor → menú muestra solo "Mis recibos" → `/payroll/mine` lista su recibo → PDF → `/payroll` devuelve 403 sin crash.
8. Contador y almacén → sin acceso a nómina.

---

## 10. Casos de caos

| # | Caso | Esperado | Severidad |
|---|------|----------|-----------|
| 10.1 | Doble clic en *Pagar* / dos requests concurrentes al mismo ítem | Un solo movimiento en el baúl; el segundo devuelve 409 | Alta |
| 10.2 | Calcular la quincena en curso (to_date futuro) | 400 "la quincena no ha terminado"; la UI solo ofrece estimación | Alta |
| 10.3 | Recalcular un periodo aprobado o pagado | 400; datos intactos | Alta |
| 10.4 | Ventas canceladas después de calcular pero antes de aprobar | *Recalcular* las excluye; `approve` recalcula solo dentro de la transacción; después de aprobar, el reverso va a la siguiente quincena | Media |
| 10.5 | Reporte de ganancia bruta falla (simular) | El periodo se calcula igual (la comisión no depende de él); el semáforo muestra "sin datos" | Media |
| 10.6 | Cajero sin ventas pagadas en la quincena | Ítem con total 0, se marca pagado sin movimiento; sin división por cero en el semáforo | Alta |
| 10.7 | Cajero desactivado después de generar ítems | Su ítem sigue (ya devengado); no aparece en quincenas nuevas | Media |
| 10.8 | Cambiar `commission_pct` después de aprobar | El periodo mantiene su snapshot; solo afecta quincenas nuevas | Alta |
| 10.9 | Admin de la tienda B intenta leer/pagar un periodo de la tienda A | 404/403; RLS y `assert_store_context` lo bloquean | Alta |
| 10.10 | Pago en `efectivo_usd` con `balance_ref` insuficiente pero `balance_efectivo_ves` suficiente | Rechazado; el mensaje indica la cubeta | Alta |
| 10.11 | Misma venta candidata en dos periodos (aprobar Q1 y Q2 en paralelo con una venta cobrada tarde) | El índice único la deja en uno solo; el otro `approve` falla y pide recalcular | Alta |
| 10.15 | Venta con `user_id` nulo o del admin | No comisiona a nadie; aparece en un contador "ventas sin cajero" del detalle | Media |
| 10.16 | Venta devuelta parcialmente (`devuelta`) ya comisionada | Reverso por el total comisionado (regla simple, documentada) | Media |
| 10.12 | Quincena Q2 de febrero bisiesto y cambio de año (`2026-12-Q2` → `2027-01-Q1`) | Fechas correctas en Caracas | Media |
| 10.13 | Anular el pago de una quincena de hace 3 meses | Permitido solo admin; queda nota obligatoria; baúl restaurado | Baja |
| 10.14 | Vendedor llama `POST /api/payroll/items/[id]/pay` con su propio ítem | 403 | Alta |

---

## 11. Definición de hecho

- [ ] typecheck, lint, test, build en verde.
- [ ] Parche SQL idempotente con 5 tablas, índices de unicidad por venta, RLS, RPC y `payroll_out` en el baúl; mock con paridad.
- [ ] Cálculo puro con tests (comisión por venta, reversos, cobros tardíos, semáforo, redondeo).
- [ ] 11 endpoints con tests y documentados en `openapi.yml`.
- [ ] 4 pantallas verificadas en navegador (desktop, móvil, claro/oscuro) con capturas.
- [ ] Pago descuenta del baúl y aparece en `/vault`; anulación lo revierte.
- [ ] Recibo PDF por cajero.
- [ ] Permisos `payroll.manage` / `payroll.view_own` en la matriz; vendedor solo ve lo suyo.
- [ ] Sección 10 sin altos/medios; auditoría limpia.
- [ ] Docs: `modules-catalog.md`, `auth-permissions.md`, fila en `mobile-app-gtm.md` §5, `docs/README.md`.
- [ ] Rama `feat/payroll` pusheada, sin merge.

---

## 12. Reporte final (≤ 35 líneas)

```text
NÓMINA — LISTO PARA REVISIÓN
Rama: feat/payroll (N commits)
Tests: A/A · e2e navegador: 9/9 · caos: N/17 · auditoría: 0 altos, 0 medios, K bajos
Para desplegar:
1. Aplicar supabase/patches/<fecha>-payroll.sql en SQL Editor
2. Merge de la rama
3. Configurar /payroll/settings: % de comisión por defecto y del cajero
Decisiones tomadas sin consultar: (≤ 5 líneas)
Hallazgos bajos: (≤ 6 líneas)
No verificado y por qué: (≤ 3 líneas)
```
