# Cuadre caja → baúl — diagnóstico (sep 2026)

Estado del flujo de efectivo entre `cash_sessions` y `store_vaults`, las fugas detectadas y la propuesta de arreglo. Leer antes de tocar caja, baúl, pagos o cierres. Complementa [`modules-catalog.md`](modules-catalog.md) (secciones Caja y Baúl).

> **Actualización 4-sep-2026 — la causa raíz ya está arreglada.** Los items 1, 2, 3, 4 y 5 de la
> §4 están implementados en [`20260904b-cash-lifecycle.sql`](../supabase/patches/20260904b-cash-lifecycle.sql),
> y el item 7 en [`20260904-payment-guards.sql`](../supabase/patches/20260904-payment-guards.sql).
> Las §2 y §3 bis quedan como **historia**: describen el comportamiento anterior a esos parches y
> explican los datos viejos, no el sistema de hoy. Verificar con `node scripts/qa-audit.mjs <slug>`.

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
| Vuelto en efectivo (venta) | `change_out` | — |
| Vuelto por PM / transferencia / punto (venta) | `account_out` | `withdrawal` cuenta — **inmediato** |

El vuelto lo introduce el parche [`20260903-pos-tender-and-change.sql`](../supabase/patches/20260903-pos-tender-and-change.sql); ver [`cobro-pos-billetes.md`](cobro-pos-billetes.md). `sales.paid_ves` acumula el neto (`amount_ves − change_ves`) y `close_cash_session` resta `change_out` del teórico físico.

Asimetría clave: **la cuenta bancaria se acredita sola; el efectivo de un cierre manual solo llega al baúl cuando un admin ejecuta `transfer_cash_closures_to_vault(session_ids)`** desde `/vault` → "Transferir cierres". Son elegibles los cierres con `status = 'closed'` y `vault_transferred_at is null` — desde `20260904b` **también los absorbidos históricos**. El autocierre nocturno sí transfiere solo.

## 2. Fugas detectadas (historia — corregidas el 4-sep-2026)

Las tres fugas de esta sección se reprodujeron por HTTP el 2-sep-2026 sobre una tienda de pruebas
antes de arreglarlas: la apertura infló el baúl **+Bs 50.000 en un solo ciclo**, un cierre absorbido
dejó **Bs 8.511,75** fuera de los dos libros, y un contado de Bs 50.000 sobre un teórico de
Bs −3.505,28 acreditó **Bs 53.505,28** inexistentes al baúl. Se conservan porque explican los datos
históricos y los one-shots; el comportamiento descrito ya no ocurre.

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
- Los tipos `transfer_out`, `refund_out` (`cash_movements`) y `adjustment` (`vault_movements`) existen en los CHECK pero **ninguna RPC los escribe** (`account_out` sí, desde `20260903` para el vuelto). Falta especialmente `transfer_out`: no hay forma registrada de sacar efectivo de la caja fuera de un cierre.
- Los one-shots depositan al baúl sin registrar la salida en caja, así que caja y baúl cuentan historias distintas del mismo dinero.

## 3 bis. Cuantificación de la inflación (2-sep-2026)

Reconstrucción completa de `cash_movements` vs `vault_movements` para `bodega-luces`.

Efectivo VES realmente generado por caja (solo `sale_in`), acumulado:

| Corte | Real (`sale_in`) | Meta usada por el backfill | Inflación |
|-------|------------------|----------------------------|-----------|
| 20-ago fin | 11 288,78 | 11 288,78 | 0 |
| 24-ago 00:35 | 29 828,25 | 35 693,97 | +5 865,72 |
| 1-sep 13:00 | 49 919,69 | 55 785,41 | +5 865,72 |

Depositado al baúl como efectivo proveniente de caja: 9 049,83 + 2 238,95 + 24 405,19 + 55 785,41 = **91 479,38**. Real hasta el corte: **49 919,69**.

**Inflación total: 41 559,69 Bs**, por dos causas:

1. **5 865,72 Bs de `opening` contados como ingreso** (fuga 2.3). Comprobado que es fondo reciclado: el cierre de `2145c5f9` (86,95) es el fondo de `dd0895b4`, y el cierre de `dd0895b4` (5 778,77) es el fondo de `cab7b096`.
2. **35 693,97 Bs redepositados**: `20260901c` se escribió con el total acumulado *hardcodeado* en vez del delta. `20260901` y `20260901b` sí calculaban `total_caja − ya_en_baul`, salía negativo y por eso no aplicaron; el reemplazo saltó esa resta.

Al revertir, el saldo de efectivo queda **negativo en 4 380,58 Bs**: las compras en efectivo (10 945,67 + 25 000,00 + 18 606,30 = 54 551,97) superan el efectivo realmente ingresado (49 919,69 de caja + 251,70 de un depósito suelto = 50 171,39). Ese faltante salió de dinero que nunca se registró como entrada al baúl y hay que declararlo antes de corregir.

En REF el problema es el inverso: caja generó 35,87 hasta el corte y `20260901d` depositó 15,00 hardcodeados (el pendiente real era 18,55, tras el retiro de 17,32 por la nevera). El baúl queda **corto en 3,55 REF**.

Parche preparado: [`supabase/patches/20260902-fix-vault-inflacion-efectivo.sql`](../supabase/patches/20260902-fix-vault-inflacion-efectivo.sql). Recalcula la inflación desde los datos (no la hardcodea), exige declarar el aporte no registrado y marca como transferidos los cierres anteriores al corte, para que "cierres pendientes" solo muestre lo que sigue en el cajón.

## 3 ter. Visibilidad en la app

Desde sep-2026 el admin ve el estado sin entrar a SQL:

- `/cash/registers` — saldos vivos de los turnos abiertos (efectivo Bs, efectivo REF, cobros en cuenta) y aviso con el total de efectivo cerrado que aún no llega al baúl.
- `/cash/registers/[id]` — detalle de una caja: turno en curso, **cierres pendientes por transferir** e historial de turnos con contado, teórico, diferencia y estado en el baúl.
- `GET /api/cash/closures/untransferred` y `GET /api/cash/closures/pending` devuelven ambos los cierres sin transferir; desde `20260904b` los absorbidos históricos ya son transferibles, así que la distinción quedó sin efecto práctico.

## 4. Propuesta de arreglo

Objetivo: que el baúl sea el **dueño único del efectivo entre jornadas** y la absorción deje de tener razón de existir.

| # | Cambio | Dónde | Estado |
|---|--------|-------|--------|
| 1 | El autocierre transfiere al baúl (`transfer_in` efectivo con `from_session_id`) en la misma transacción, en vez de dejar el cierre huérfano. | `auto_close_stale_cash_sessions` | **Hecho** `20260904b` |
| 2 | La apertura descuenta el fondo del baúl: `withdrawal` efectivo automático por `opening_ves` / `opening_ref`, con `from_session_id`. Falla si el baúl no alcanza. | `open_cash_session` | **Hecho** `20260904b` |
| 3 | Eliminar la absorción (`absorbed_by_session_id`) o dejarla solo como flag histórico; con 1 y 2 no hay cierres pendientes al reabrir. | `open_cash_session`, `transfer_cash_closures_to_vault`, `listPendingClosures` | **Hecho** `20260904b` |
| 4 | Registrar faltante/sobrante: al cerrar, si `closing ≠ theoretical`, insertar un movimiento con el delta y quién cerró. | `close_cash_session` | **Hecho** `20260904b` |
| 5 | Vista `vault_balance_check` (esperado por cubeta desde `vault_movements` vs `store_vaults`). | nuevo parche | **Hecho** `20260904b` |
| 6 | RPC `register_cash_transfer_out` / `register_vault_adjustment` para que los ajustes sean movimientos auditados, no INSERTs a mano. | nuevo parche | Pendiente |
| 7 | `cancel_payment`: rechazar anulación de pagos en efectivo cuya sesión ya esté cerrada y transferida. | `cancel_payment` | **Hecho** `20260904-payment-guards` |

Cómo quedó implementado:

- **Apertura (2).** `open_cash_session` inserta un `withdrawal` cubeta `efectivo` con `from_session_id`
  por el fondo y falla con un mensaje explícito si el baúl no lo tiene. El fondo deja de ser dinero
  que aparece de la nada, así que el ciclo ya no infla el baúl.
- **Absorción (3).** La apertura ya no escribe `absorbed_by_session_id` y
  `transfer_cash_closures_to_vault` acepta los cierres absorbidos históricos. `listPendingClosures`
  y `getLastUntransferredClosure` dejaron de filtrarlos: **es la vía para recuperar desde `/vault` →
  «Transferir cierres» el efectivo de los cierres varados**, sin más one-shots.
- **Diferencia de cierre (4).** `record_cash_close_difference` asienta el delta contado−teórico antes
  de cerrar: sobrante como `adjustment`, faltante como `transfer_out`, con nota
  `Cuadre de cierre …`. `theoretical_closing_*` conserva el teórico previo al asiento, así que la
  diferencia queda atribuible y lo que va al baúl es reconciliable movimiento a movimiento.

Falta el item 6: sacar efectivo de la caja fuera de un cierre sigue sin tener una RPC propia.

### Los 17 cierres varados de `bodega-luces` (4-sep-2026)

Al aceptar los absorbidos, `/vault` → «Transferir cierres» pasa a ofrecer **17 cierres por
Bs 54.132,80 y $52,97**. **No transferirlos en bloque.** Se cerraron con las reglas viejas, así que
cada `closing_ves` incluye el fondo de apertura que el turno siguiente volvió a usar: transferirlos
tal cual repetiría la inflación de §3 bis. Por eso «Seleccionar todos» los excluye y cada uno lleva
un aviso. Lo correcto es revisarlos uno por uno contra `sale_in` real —
`closing_ves − opening_ves` es el ingreso del turno— y transferir solo esa parte, o cerrar el tema
con `20260902-fix-vault-inflacion-efectivo.sql` una vez declarado el aporte no registrado.

## 5. Verificación

Lo primero, desde la terminal:

```bash
node scripts/qa-audit.mjs bodega-luces
```

Reconcilia baúl vs `vault_movements`, el teórico de cada sesión vs `cash_movements`, `sales.paid_ves`
vs el neto de pagos y `purchases.paid_ves` vs sus pagos; además marca lo implausible: efectivo
negativo en gaveta, sobrecobros, sobrepagos de compras, diferencias de cierre sin asentar y cierres
absorbidos sin transferir. Sale con código 1 si encuentra algo. La vista `vault_balance_check`
cubre lo mismo para el baúl desde SQL.

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
