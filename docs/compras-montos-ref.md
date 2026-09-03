# Compras: por qué los montos por ítem no cuadraban con el total

Parche: [`20260905-purchase-line-subtotal-ref.sql`](../supabase/patches/20260905-purchase-line-subtotal-ref.sql).
Código: `src/modules/purchases/purchase-create/utils/normalizePurchaseLine.ts`.

## Regla del módulo

Una compra tiene **una moneda de captura por línea** (`purchase_items.cost_currency`):
lo que el usuario teclea es la verdad y la otra moneda es un espejo derivado.
En este negocio casi siempre se teclea en **Bs**, así que el REF es lo derivado.

De ahí la regla que ahora respeta todo el módulo:

> El subtotal de una línea se convierte **una sola vez, sobre el monto completo
> de la línea**. Nunca se multiplica un costo unitario ya redondeado por la
> cantidad.

`getDraftLineTotals(item, rateVes)` es la única fuente de esos montos: la tabla
de líneas, el resumen de compra y el payload que viaja al RPC leen de ahí, así
que no pueden desalinearse entre sí.

## Qué estaba mal

### 1. El subtotal REF de la línea era una columna generada

`purchase_items.subtotal_ref` era `generated always as (round(quantity * unit_cost_ref, 2))`.

Con captura en Bs, `unit_cost_ref` es un valor derivado y redondeado a 2
decimales; multiplicarlo por la cantidad **total de unidades** multiplica también
su error de redondeo. Caso real en la base:

| | |
|---|---|
| Bulto de 100 u | 1 755,33 Bs · tasa 798,3260 |
| REF real de la línea | 2,20 (1 755,33 / 798,3260 = 2,1988) |
| `unit_cost_ref` guardado | 0,02 (el exacto es 0,021988) |
| `subtotal_ref` generado | 100 × 0,02 = **2,00** |

La línea mostraba 2,00 REF y el encabezado 2,20 REF, porque el encabezado sí
guardaba el monto que enviaba el cliente. En la base había 118 de 206 líneas
desviadas, hasta 0,49 REF por línea.

**Arreglo:** `subtotal_ref` pasa a ser una columna real que guarda el subtotal
que envía el cliente, igual que ya se hacía con `subtotal_ves`. `create_purchase`
lo inserta (ya lo recibía en `v_line_subtotal_ref` pero la columna generada lo
ignoraba). El parche recalcula las líneas existentes, recalcula su `tax_ref`
sobre el subtotal corregido y realinea el encabezado con la suma de sus líneas.

Solo cambia la cara REF, que es la derivada. Los montos en Bs —el dinero
realmente pagado— no se tocan; el ajuste del encabezado es de céntimos (máximo
1,20 REF sobre 550, en la compra más antigua) y no altera ningún estado de pago.

### 2. Doble redondeo al derivar el unitario

`syncLineCostFields` derivaba el unitario de la otra moneda a partir del
unitario **ya redondeado**, encadenando dos redondeos. Un bulto de 12 u a 1,98
REF daba 128,64 Bs/u → 1 543,68 Bs el bulto, contra los 1 498,29 Bs reales (3%).
Ahora el unitario espejo se deriva del costo del bulto.

### 3. El resumen convertía el total REF a Bs

`PurchaseSummaryCard` calculaba `Total VES = refToVes(totalRef)`, es decir
reconvertía un REF ya redondeado, en vez de sumar los Bs de las líneas. Y solo
mostraba Bs en el total: no había subtotal ni IVA en Bs. Ahora cada renglón
(subtotal, descuento, impuesto, total) muestra **Bs arriba y REF debajo**, con
los Bs sumados de las líneas.

## Pendiente: el costo unitario sigue con 2 decimales

Este parche arregla los **montos de la compra**, no el **costo del producto**.

`products.current_cost_ref`, `purchase_items.unit_cost_ref` y
`supplier_products.last_cost_ref` son `numeric(_,2)`. En el mismo ejemplo, el
producto cuesta 0,021988 REF/u y se registra como **0,02**: un 9% menos. Ese
costo alimenta márgenes y precios de venta, así que el desvío no se queda en la
vista de la compra.

Arreglarlo es un cambio de otro tamaño —ampliar a `numeric(12,4)` en las tres
tablas, recalcular históricos y revisar el frontend que formatea con 2
decimales— y por eso queda anotado aparte.

## Ventas: el mismo caso no aplica

En ventas la moneda de captura es siempre REF (`products.sale_price_ref`) y no
hay impuesto por línea, así que la conversión va en un solo sentido y es
consistente de punta a punta: `create_sale` recalcula todo en el servidor con la
misma fórmula que usa la columna generada `sale_items.subtotal_ref`.

Comprobado contra la base: de 311 ventas, **0** tienen desvío en REF entre
encabezado y suma de líneas; en Bs el máximo es 0,02 Bs, por redondear cada
línea por separado.

Lo único que se ajustó fue redondear el subtotal del carrito POS
(`usePosCart`), que se acumulaba como float crudo y viajaba así como monto de
pago.
