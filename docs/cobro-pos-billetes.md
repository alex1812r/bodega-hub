# Cobro en POS con billetes reales y vuelto — especificación

Estado: **implementado** (4-sep-2026). Documento de diseño que gobierna el paso de pago en el POS y su reflejo en caja/baúl.

Relacionados: [`cuadre-baul.md`](cuadre-baul.md), [`modules-catalog.md`](modules-catalog.md).

Parches: [`20260903-pos-tender-and-change.sql`](../supabase/patches/20260903-pos-tender-and-change.sql)
(modelo de recibido/vuelto) y [`20260904-payment-guards.sql`](../supabase/patches/20260904-payment-guards.sql)
(guardas: el vuelto no puede sobregirar la gaveta, una venta no se cobra dos veces, una compra no se
paga por encima de su saldo, los desgloses de billetes se validan contra el monto, y `cancel_payment`
rechaza pagos de cierres ya transferidos al baúl).

## 1. El problema

El POS de hoy asume que el cliente entrega **exactamente** el total. `PosCartPanel` manda `amount = totalRef` (USD) o `amount = totalVes` (Bs), y `validateMixedPayments` **rechaza** cualquier suma por encima del total (tolerancia: 1 centavo USD a la tasa).

En la calle eso no existe:

- El efectivo en USD solo circula en billetes de **1, 5, 10, 20, 50, 100**. No hay monedas. Una venta de **$2,30** no se puede pagar exacta en efectivo USD.
- El efectivo en Bs. solo circula en billetes de **10, 20, 50, 100, 200**.
- Lo real: el cliente da **$3** y recibe **vuelto** — casi siempre en Bs. (efectivo o pago móvil), porque tampoco hay cómo dar $0,70 en billetes.
- O paga **mixto**: $2 en efectivo USD + el resto en Bs. (efectivo / pago móvil / transferencia), sin vuelto.

Consecuencia hoy: el cajero anota un método que no fue el real y el descuadre se arregla después a mano con one-shots
(`20260816-one-shot-fix-sale-usd-with-pm-change.sql`, `20260828-one-shot-fix-sale-mixed-usd-ves-payment.sql`).

## 2. Modelo conceptual

Se separan dos cosas que hoy están fusionadas:

| Concepto | Definición | Dónde vive |
|----------|------------|------------|
| **Recibido (tender)** | Lo que el cliente entrega. Una o varias líneas, cada una con método y monto en su moneda. | filas `payments` (una por método) |
| **Vuelto (change)** | Lo que el negocio devuelve porque el recibido superó el total. Un solo método. | columnas `change_*` en la fila `payments` que generó el excedente |

Invariante: `Σ recibido_ves − vuelto_ves = aplicado a la venta`, y `sales.paid_ves` acumula **lo aplicado**, no lo recibido.

### Denominaciones

| Moneda | Billetes |
|--------|----------|
| USD | 1, 5, 10, 20, 50, 100 |
| VES | 10, 20, 50, 100, 200 |

Se guardan como desglose opcional (`{"20": 1, "5": 2}`) para el arqueo de caja.

**Vuelto no representable:** el vuelto exacto casi nunca es un múltiplo de los billetes disponibles
(vuelto Bs 560,83 → máximo entregable Bs 560). El cajero confirma el **vuelto realmente entregado**;
la diferencia queda como sobrante real en la gaveta y la UI la muestra como `Redondeo`.
Eso es contablemente correcto: la gaveta sí tiene ese dinero de más.

## 3. Cambios de base de datos

Patch: `supabase/patches/20260903-pos-tender-and-change.sql`.

### 3.1 `payments` — columnas nuevas

| Columna | Tipo | Nota |
|---------|------|------|
| `change_method` | `public.payment_method` null | método por el que se devolvió el vuelto |
| `change_amount` | `numeric(14,2)` not null default 0 | monto en la moneda de `change_method` |
| `change_ves` | `numeric(14,2)` not null default 0 | vuelto convertido a Bs. a `ref_rate_ves` |
| `change_ref` | `numeric(14,2)` not null default 0 | vuelto en USD (solo si `change_method = 'efectivo_usd'`) |
| `received_denominations` | `jsonb` null | `{"USD":{"1":3}}` o `{"VES":{"200":2,"100":1}}` |
| `change_denominations` | `jsonb` null | igual formato |

CHECKs nuevos:

- `change_method is null` ⇔ `change_amount = 0` y `change_ves = 0` y `change_ref = 0`.
- `change_ves <= amount_ves` (no se puede devolver más de lo recibido en esa línea).
- Vuelto solo en pagos de venta (`sale_id is not null`).

### 3.2 `cash_movements` — tipo nuevo `change_out`

- Se amplía `cash_movements_type_check` con `'change_out'`.
- `close_cash_session` y `auto_close_stale_cash_sessions` **restan** `change_out` del teórico físico
  (hoy solo restan `transfer_out` y `refund_out`).
- `src/modules/cash/utils/cashSessionTotals.ts` debe restar `change_out` igual que el RPC.

### 3.3 `register_payment` — parámetros nuevos

Se agregan **al final**, con default, y se re-otorga el grant con la firma nueva
(y se hace `drop function` de la firma vieja para que PostgREST no vea un overload ambiguo):

```sql
register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null,
  p_change_method public.payment_method default null,
  p_change_amount numeric default 0,
  p_received_denominations jsonb default null,
  p_change_denominations jsonb default null
) returns public.payments
```

Comportamiento añadido (solo rama venta):

1. Validar: `p_change_amount >= 0`; si `> 0` exige `p_change_method`; el vuelto en Bs. no puede superar `amount_ves`.
2. `v_change_ves := round(p_change_amount * rate, 2)` si `change_method = 'efectivo_usd'`, si no `round(p_change_amount, 2)`.
3. `sales.paid_ves += (amount_ves − change_ves)` y el `status` se decide con ese neto.
4. Asiento del vuelto:
   - `efectivo_ves` / `efectivo_usd` → `cash_movements(type='change_out', ...)` en la misma sesión de caja.
   - `pago_movil` / `transferencia` / `punto_venta` → `cash_movements(type='account_out')`
     **y** `vault_movements(type='withdrawal', bucket='cuenta')` + `store_vaults.balance_ves -= change_ves`.
     (Es exactamente lo que hizo a mano el one-shot `20260816`.)
5. `cancel_payment` revierte también el `change_out` / `account_out` / `withdrawal` y devuelve `balance_ves`.

## 4. API

`POST /api/payments` acepta, además de lo actual:

```jsonc
{
  "saleId": "…", "method": "efectivo_usd", "amount": 3, "currency": "USD",
  "change": { "method": "pago_movil", "amount": 560.83,
              "bankName": "…", "phone": "…", "referenceCode": "1234" },
  "receivedDenominations": { "USD": { "1": 3 } },
  "changeDenominations": null
}
```

- `change.amount > 0` exige `change.method`.
- Para `change.method` bancario los datos de banco/teléfono/referencia son **opcionales** (es una salida, no un cobro): se guardan en `notes` si vienen.

## 5. UI — modal «Cobrar»

Reemplaza la dupla actual «Método de pago» + «Pago mixto» por **un solo flujo**.
El panel del carrito conserva el selector rápido de método (camino feliz: pago exacto),
pero el botón principal pasa a abrir el modal cuando el cobro no es trivial.

### Estructura

```
Total            $2,30            Bs 1.842,70
────────────────────────────────────────────────
RECIBIDO
 + [Efectivo $] [Efectivo Bs] [Pago móvil] [Punto] [Transf.]

 ▸ Efectivo USD                       $3,00   ✎ ✕
     [$1 ×3] [$5] [$10] [$20] [$50] [$100]
     rápidos: $3 · $5 · $10
 ▸ …hasta 4 líneas, un método cada una

Recibido    $3,00 · Bs 2.403,53
Falta       —
VUELTO      Bs 560,83   ($0,70)
────────────────────────────────────────────────
VUELTO EN   (•) Efectivo Bs  ( ) Pago móvil  ( ) Efectivo $
 Sugerido: 200×2 + 100×1 + 50×1 + 10×1 = Bs 560
 Entregado: [Bs 560]            Redondeo a favor: Bs 0,83
────────────────────────────────────────────────
[Cancelar]                                [Cobrar]
```

### Reglas de la UI

1. **Teclado de billetes** por moneda con las denominaciones reales. Tap suma, `−` resta, se muestra el conteo.
   El monto de la línea también se puede escribir a mano (compras/ventas grandes, punto de venta, etc.).
2. **Montos rápidos**: para el restante, ofrecer el conjunto mínimo de billetes que lo cubre y los 2 siguientes
   escalones habituales. Para $2,30 → `$3`, `$5`, `$10`.
3. **Falta / Vuelto en vivo**, siempre en Bs. y en REF, calculado con las mismas funciones que el backend
   (`getSaleTotalVes`, `paymentAmountToVes`).
4. **El vuelto solo se habilita cuando el recibido supera el total.** Método de vuelto por defecto:
   `efectivo_ves` si la gaveta tiene Bs.; si no, `pago_movil`.
5. **Aviso de vuelto no entregable**: si el vuelto no es múltiplo de los billetes disponibles,
   mostrar el máximo entregable y la diferencia (`Redondeo`). El cajero puede ajustar el entregado.
6. `validateMixedPayments` deja de rechazar el excedente **cuando hay vuelto declarado** que lo absorbe;
   sigue rechazando excedente sin vuelto.
7. Un solo pago con vuelto también pasa por el modal (no es exclusivo del mixto).

### Accesibilidad / velocidad

- Todo operable con teclado; los billetes tienen `aria-label` (`Agregar billete de 20 bolívares`).
- El modal abre con el foco en el primer billete de la moneda por defecto.
- Nada de scroll horizontal; en móvil el pad de billetes es una grilla de 3 columnas.

## 6. Reflejo en caja y baúl

| Caso | `cash_movements` | `vault_movements` | Efecto en cierre |
|------|------------------|-------------------|------------------|
| Recibe $3 efectivo USD, vuelto Bs 560 en efectivo | `sale_in` (ref 3) + `change_out` (ves 560) | — | gaveta: +$3, −Bs 560 |
| Recibe $3 efectivo USD, vuelto Bs 560 por pago móvil | `sale_in` (ref 3) + `account_out` (ves 560) | `withdrawal` cuenta 560 | gaveta: +$3; cuenta: −Bs 560 |
| Mixto $2 USD + Bs 240,70 pago móvil, sin vuelto | `sale_in` (ref 2) + `account_in` (ves 240,70) | `sale_in` cuenta 240,70 | gaveta: +$2 |

## 7. Criterios de aceptación

1. Venta de $2,30 pagada con un billete de $5, vuelto en efectivo Bs.: la venta queda `pagada`,
   `paid_ves = total_ves` (± redondeo declarado), la gaveta refleja +$5 y −vuelto, y el cierre teórico cuadra.
2. La misma venta con vuelto por pago móvil: el baúl `cuenta` baja exactamente el vuelto.
3. Mixto $2 USD + resto en pago móvil: dos filas `payments`, `paid_ves = total_ves`, sin vuelto.
4. Anular cualquiera de esos pagos revierte **todos** sus movimientos (incluido el vuelto) y deja saldos como antes.
5. Cierre de caja + transferencia al baúl: `balance_efectivo_ves` y `balance_ref` cuadran contra
   `supabase/patches/20260901-query-vault-balance-calc.sql`.
6. No se puede declarar vuelto mayor al excedente, ni vuelto sin excedente, ni vuelto en una compra.

### Verificación (2/4-sep-2026, tienda `bodega-luces-qa`)

Corrida completa por navegador con un cajero real, auditada con `node scripts/qa-audit.mjs bodega-luces-qa`
después de cada paso — cero descuadres en todas:

| Caso | Resultado |
|------|-----------|
| $2,29 con un billete de $5, vuelto en efectivo Bs. | vuelto Bs 2.171,19 → entregable `200×10 + 100×1 + 50×1 + 20×1 = Bs 2.170`, redondeo Bs 1,19. `paid_ves` 1.835,88 sobre un total de 1.834,69 |
| Mixto $2 USD + Bs 977,43 pago móvil | dos filas `payments`, `paid_ves = total_ves` exacto, sin vuelto |
| $1 por un artículo de $0,29, vuelto por pago móvil | `account_out` Bs 568,84 en caja + `withdrawal` cuenta Bs 568,84 en el baúl |
| Bs 500 en billetes por Bs 336,49, vuelto en efectivo | entregable `100×1 + 50×1 + 10×1 = Bs 160`, redondeo Bs 3,51 |
| Cierre con faltante de Bs 20 y transferencia al baúl | `transfer_out` de cuadre asentado; baúl +Bs 1.150 / +$18 |

Guardas comprobadas por API, todas 4xx con mensaje en español: vuelto que sobregira la gaveta,
desglose de billetes que no suma el monto, desglose en la moneda equivocada, billete inexistente
(`$3`), segundo cobro sobre una venta saldada (también en paralelo), pago de compra por encima del
saldo, anulación de un pago cuyo cierre ya fue transferido, y cancelación de una venta con pagos
activos.
