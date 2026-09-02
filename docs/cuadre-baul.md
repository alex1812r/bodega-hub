# Cuadre caja → baúl — diagnóstico (sep 2026)

Estado del flujo de efectivo entre `cash_sessions` y `store_vaults`, las fugas detectadas y la propuesta de arreglo. Leer antes de tocar caja, baúl, pagos o cierres. Complementa [`modules-catalog.md`](modules-catalog.md) (secciones Caja y Baúl).

Fuentes de verdad revisadas: parches `20260811b`, `20260811c`, `20260811d`, `20260812c`, `20260819`, one-shots `20260821b/c`, `20260824`, `20260901*`; RPC `register_payment`, `open_cash_session`, `close_cash_session`, `auto_close_stale_cash_sessions`, `transfer_cash_closures_to_vault`, `cancel_payment`; `src/modules/vault`, `src/modules/cash/components/CloseCashSessionModal.tsx`, `src/modules/reports/services/dailyCloseSummary.server.ts`.

## 1. Modelo actual

`store_vaults` tiene tres saldos independientes:

| Columna | Significado | Cubeta en `vault_movements.bucket` |
|---------|-------------|-----------------------------------|
| `balance_efectivo_ves` | Bs físicos | `efectivo` |
| `balance_ves` | Bs en cuenta bancaria | `cuenta` |
| `balance_ref` | USD físicos | `efectivo` |

`register_payment` enruta según método de pago:

| Operación | `cash_movements` | `vault_movements` |
|-----------|------------------|-------------------|
| Venta efectivo Bs / USD | `sale_in` | — (espera transferencia de cierre) |
| Venta PM / transferencia / punto | `account_in` | `sale_in` cuenta — **inmediato** |
| Compra efectivo | — | `purchase_out` efectivo |
| Compra desde cuenta | — | `purchase_out` cuenta |
| Apertura de caja | `opening` | — |
| Cierre transferido | — | `transfer_in` efectivo (`from_session_id`) |

Asimetría clave: **la cuenta bancaria se acredita sola; el efectivo solo llega al baúl cuando un admin ejecuta `transfer_cash_closures_to_vault(session_ids)`** desde `/vault` → "Transferir cierres". Solo son elegibles cierres con `status = 'closed'`, `vault_transferred_at is null` y `absorbed_by_session_id is null`.

## 2. Fugas detectadas

### 2.1 Absorción de cierres + autocierre (causa raíz)

`open_cash_session` marca `absorbed_by_session_id` en todo cierre previo de esa caja no transferido, y `transfer_cash_closures_to_vault` rechaza los absorbidos. Diseñado cuando cerrar era manual ("si reabres sin transferir, el efectivo sigue en el cajón y sale en el próximo cierre").

Desde `20260819` el cron cierra toda sesión a medianoche Caracas. Secuencia real:

1. Vendedor abre 8 am, vende todo el día.
2. Cron autocierra a medianoche (`closed_reason = end_of_day`), `closing = theoretical`.
3. Nadie transfiere de madrugada.
4. Apertura de la mañana siguiente absorbe el cierre → **el efectivo del día queda inalcanzable para el baúl**, y el nuevo cierre solo contiene fondo + ventas del día nuevo.

Explica la cadencia de backfills manuales (`20260821b`, `20260821c`, `20260824`, `20260901*`).

### 2.2 El fondo de apertura se deposita y nunca se retira

El cierre transfiere `closing_ves` / `closing_ref`, que por diseño del modal incluyen el fondo de apertura. Al abrir la siguiente sesión, `open_cash_session` inserta un movimiento `opening` sin descontar nada del baúl. Resultado: **el baúl sobreestima un fondo por ciclo**, acumulativo. Solo se corrige si el admin registra un retiro manual cada mañana.

### 2.3 La fórmula de reconciliación de los backfills hereda 2.2

`20260901b` calcula `delta = Σ cash_movements(sale_in + opening + adjustment − transfer_out − refund_out) − Σ vault_movements(efectivo: deposit + transfer_in)`. El término `opening` es dinero reciclado, no ingreso nuevo, así que el delta sale inflado. Por eso `20260901c` y `20260901d` terminan con montos hardcodeados (55785.41 Bs, 15 REF).

## 3. Deudas estructurales

- `store_vaults.balance_*` son contadores denormalizados. No hay trigger ni vista que los reconcilie contra `vault_movements`; la única verificación es `supabase/patches/20260901-query-vault-balance-calc.sql`. Un SQL manual que actualice uno y no el otro deriva en silencio; el `check (>= 0)` solo hace fallar la siguiente compra en efectivo.
- No existe registro de faltante/sobrante. `close_cash_session` guarda `theoretical_closing_*` junto al contado, pero al baúl va el contado y la diferencia no se asienta en ningún lado.
- `cancel_payment` borra el `cash_movement` aunque la sesión ya esté cerrada y transferida: altera el teórico de un cierre pasado sin tocar el baúl.
- Los tipos `transfer_out`, `refund_out`, `account_out` (`cash_movements`) y `adjustment` (`vault_movements`) existen en los CHECK pero **ninguna RPC los escribe**. Falta especialmente `transfer_out`: no hay forma registrada de sacar efectivo de la caja fuera de un cierre.
- Los one-shots depositan al baúl sin registrar la salida en caja, así que caja y baúl cuentan historias distintas del mismo dinero.

## 4. Propuesta de arreglo

Objetivo: que el baúl sea el **dueño único del efectivo entre jornadas** y la absorción deje de tener razón de existir.

| # | Cambio | Dónde |
|---|--------|-------|
| 1 | El autocierre transfiere al baúl (`transfer_in` efectivo con `from_session_id`) en la misma transacción, en vez de dejar el cierre huérfano. | `auto_close_stale_cash_sessions` |
| 2 | La apertura descuenta el fondo del baúl: `withdrawal` efectivo automático por `opening_ves` / `opening_ref`, con `from_session_id` (nueva columna o `notes` estructurado). Falla si el baúl no alcanza. | `open_cash_session` |
| 3 | Eliminar la absorción (`absorbed_by_session_id`) o dejarla solo como flag histórico; con 1 y 2 no hay cierres pendientes al reabrir. | `open_cash_session`, `transfer_cash_closures_to_vault`, `listPendingClosures` |
| 4 | Registrar faltante/sobrante: al cerrar, si `closing ≠ theoretical`, insertar `cash_movements.adjustment` (o nueva tabla `cash_differences`) con el delta y quién cerró. | `close_cash_session` |
| 5 | Vista `vault_balance_check` (esperado por bucket desde `vault_movements` vs `store_vaults`) y opcionalmente un trigger que mantenga los saldos desde los movimientos. | nuevo parche |
| 6 | RPC `register_cash_transfer_out` / `register_vault_adjustment` para que los ajustes sean movimientos auditados, no INSERTs a mano. | nuevo parche |
| 7 | `cancel_payment`: rechazar anulación de pagos en efectivo cuya sesión ya esté cerrada y transferida, o compensar con un `withdrawal` en baúl. | `cancel_payment` |

Orden sugerido: 5 (medir el descuadre actual) → 1 + 2 + 3 (romper el ciclo) → 4 → 6 → 7.

## 5. Verificación

Antes y después de cualquier parche, correr en SQL Editor:

- `supabase/patches/20260901-query-vault-balance-calc.sql` — esperado vs actual por cubeta.
- `supabase/patches/20260901-query-cash-balances.sql` — efectivo en cajas abiertas.
- `supabase/patches/20260901-diagnostic-vault.sql` — últimos movimientos y marcadores de backfill.

Cierres absorbidos que nunca llegaron al baúl (candidatos a reconciliar una sola vez, **sin** contar `opening`):

```sql
select cs.id, cr.name, cs.closed_at, cs.closed_reason,
       cs.closing_ves - cs.opening_ves as ventas_efectivo_ves,
       cs.closing_ref - cs.opening_ref as ventas_efectivo_ref
from public.cash_sessions cs
join public.cash_registers cr on cr.id = cs.register_id
where cs.store_id = '<store_id>'
  and cs.status = 'closed'
  and cs.vault_transferred_at is null
  and cs.absorbed_by_session_id is not null
order by cs.closed_at;
```
