# Despliegue del plan ux-mejoras

Qué hay que aplicar, en qué orden y qué cambia a la vista al desplegar la rama `feat/ux-mejoras` (plan [`agent-prompts/ux-mejoras-gtm.md`](agent-prompts/ux-mejoras-gtm.md), HEAD `d91be94`). El estado de cada recomendación y las métricas están en [`auditoria-producto-2026-10.md` §8](auditoria-producto-2026-10.md#8-estado-de-las-recomendaciones).

**Nada de esto se ha aplicado a producción.** Los 25 parches solo han corrido en el laboratorio local (`verify-patches` 166 ok / 0 fail, `stock-lab:reconcile` 0/9 sobre `d3e3dda`, pasada 4 del QA global). No hay SQL nuevo desde `20261017a`: lo posterior (GQ-07 a GQ-10, GC-01, GC-02) es BFF e interfaz, y el único cambio en `supabase/patches/` es el comentario de cabecera de `20261011d`. El orden de la sección 2 no cambia.

Fuentes: las cabeceras de cada parche en `supabase/patches/` y los bloques de [`apply-all-pending.sql`](../supabase/patches/apply-all-pending.sql). **Este documento es la única fuente del orden de despliegue**; [`stock-integrity.md` §7](stock-integrity.md#7-despliegue) y `apply-all-pending.sql` remiten aquí. Queda una diferencia de texto sin corregir, anotada en [Contradicciones sin resolver](#contradicciones-sin-resolver).

## 1. Comprobaciones previas

1. **La serie de integridad de stock está completa**: `20261005` y `20261006a` … `i` aplicados y `verify-patches.sql` en verde ([`stock-integrity.md` §7](stock-integrity.md)). Todos los parches de este plan la requieren.
2. **Administradores con permisos de venta concedidos.** El BFF nuevo respeta `sales.create` y `cash.operate` en los `granted_permissions` de un admin (antes se ignoraban). Un admin que ya los tuviera pasa a poder vender y operar caja nada más desplegar, aunque el interruptor «El administrador puede vender» aparezca apagado o parcial. Revisar y limpiar antes:

   ```sql
   select id, full_name, store_id, granted_permissions
   from public.profiles
   where role = 'admin'
     and (granted_permissions ? 'sales.create' or granted_permissions ? 'cash.operate');
   ```

   Detalle en [`auth-permissions.md`](auth-permissions.md#el-administrador-puede-vender).
3. **Ventana sin operación.** `20261009a` reescribe `products` con bloqueo exclusivo; `20261011a` y `20261012b` crean índices sin `concurrently` (bloquean las escrituras de `stock_movements` y `purchase_items` mientras se construyen).
4. **App móvil (otro repositorio, no revisada en este plan).** Tres cosas la pueden afectar: las vistas `daily_sales_summary` y `gross_profit_summary` pasan a día de Caracas (`20261013a`); un vendedor que envíe `discountRef` > 0 recibe 403; `@bodega/core` cambia etiquetas con tilde y el orden de los permisos efectivos del admin.
5. **Scripts propios** que escriban recetas de empaque con un JWT de usuario o carguen stock inicial sobre productos inactivos: ver las notas de `20261011d` y `20261011b`.
6. **Compras con `paid_ref` / `paid_ves` desalineados de sus pagos.** Desde GQ-10 el detalle de compra muestra lo pagado de la cabecera (`purchases.paid_ref` y `paid_ves`) en vez de sumar los pagos. Una compra antigua con la cabecera nula o distinta de la suma de sus pagos activos se vería con la cifra de la cabecera (un nulo, como 0 REF). Consulta de solo lectura; lo esperado son 0 filas, y las que salgan hay que revisarlas antes de desplegar:

   ```sql
   select p.id, p.store_id, p.status,
          p.total_ref, p.paid_ref, p.paid_ves,
          coalesce(a.sum_ref, 0) as pagos_activos_ref,
          coalesce(a.sum_ves, 0) as pagos_activos_ves,
          coalesce(a.n, 0)       as pagos_activos
   from public.purchases p
   left join (
     select purchase_id,
            sum(amount_ref) as sum_ref,
            sum(amount_ves) as sum_ves,
            count(*)        as n
     from public.payments
     where purchase_id is not null
       and status is distinct from 'anulado'
     group by purchase_id
   ) a on a.purchase_id = p.id
   where p.paid_ref is null
      or p.paid_ves is null
      or round(p.paid_ref, 2) <> round(coalesce(a.sum_ref, 0), 2)
      or round(p.paid_ves, 2) <> round(coalesce(a.sum_ves, 0), 2)
   order by p.store_id, p.id;
   ```

   La consulta está escrita a partir de las columnas que lee el BFF (`payments.purchase_id`, `amount_ref`, `amount_ves`, `status`) y **no se ha ejecutado en ninguna base**, tampoco en el laboratorio. Una diferencia de 0,01 en `paid_ref` puede ser el redondeo de `register_payment` (B2 en la sección 5), no un dato dañado.

## 2. Orden de aplicación

Orden definitivo: `20261007a`, `7b`, `8a`, `9a`–`9f`, `10a`, `10b`, `10d`, `10e`, `10f`, `11a`, `11b`, `11c`, `12a`, `12b`, `13a`, `13b`, `15a`, `17a` → `verify-patches.sql` → **desplegar el BFF** → `10c` → `11d` → `verify-patches.sql`.

Cada parche es idempotente y va en una transacción. Los números de paso son los de esta tabla; las notas dicen también qué le falla al BFF nuevo si el parche falta.

| # | Parche | Qué hace | Notas de reaplicación y avisos |
|---|--------|----------|--------------------------------|
| 1 | `20261007a-tax-rates` | Catálogo `tax_rates` (exento 0, reducida 8, general 16), `categories.tax_rate_id`, `app_settings.default_tax_rate_id`, `purchase_items.tax_rate_code` y `create_purchase` con alícuota por línea | Migra datos la primera vez: un porcentaje que no sea 0, 8 ni 16 crea la alícuota `otro-<pct>` **inactiva**; revisar con `select * from public.tax_rates_pending_review;`. Las compras de esas categorías se rechazan (`PT400`) hasta activarla o reasignar. Reaplicar `20261006c`, `f` o `h` reinstala el `create_purchase` anterior: volver a aplicar este y los que lo redefinen después (pasos 7, 10, 11, 12) |
| 2 | `20261007b-tax-rates-store-override` | RPC `override_tax_rate_for_store`, único camino del BFF para cambiar una alícuota | Solo crea la función. Sin 1 y 2 el BFF nuevo falla en categorías, configuración, detalle de compra y `/api/tax-rates` |
| 3 | `20261008a-register-payment-idempotency` | Clave opcional `p_client_request_id` en `register_payment` (firma de 13 argumentos; elimina la de 12) | Reaplicar `20261006b`, `c`, `f`, `g` o `h` reinstala la de 12 y deja dos sobrecargas: volver a aplicar este. Orden con el BFF indistinto: sin el parche el pago se registra una vez, sin idempotencia |
| 4 | `20261009a-product-margin-pct` | Columna generada `products.margin_pct` + índice para filtrar y ordenar por ganancia | Reescribe `products` con bloqueo exclusivo. Sin él fallan `?margin=` y `sortBy=marginPct` |
| 5 | `20261009b-pricing-settings` | Umbrales del semáforo y chips de % por tienda en `app_settings`; `categories.default_markup_pct` | Requiere 1. Regenera los triggers de `20261006i` en `app_settings` y `categories`. Sin él fallan `/api/settings`, `/api/settings/pricing`, `/api/categories` y `/api/products` |
| 6 | `20261009c-price-review` | Cola «Por revisar»: instantánea de costo y banda en `product_price_history`, RPC `keep_product_price`, vista `products_price_review` | Inserta una fila «Línea base de ganancia» por producto (solo la primera vez). Las instantáneas consumen números de `stock_movements_seq`. Reaplicar `20261006g` o `h` reinstala `update_product_price` sin instantánea: volver a aplicar este. **Reaplicar este obliga a reaplicar 9, 19 y 23** |
| 7 | `20261009d-assorted-pack` | Receta de empaque de N componentes (`product_pack_components`); `convert_pack_to_units` pasa de 4 a 5 argumentos; redefine `create_purchase` | Migra cada par 1 a 1 a cabecera + 1 componente. Reaplicar `20261006c` / `d` / `f` / `h` o `20261007a` obliga a reaplicarlo. **Reaplicarlo sobre una base con 25 reabre la escritura directa de recetas: aplicar 25 justo después.** Y obliga a reaplicar 10, 11 y 12 |
| 8 | `20261009e-supplier-preferred` | Proveedor habitual: `supplier_products.is_preferred`, triggers de relevo y RPC `save_product_suppliers` | Backfill: un habitual por producto con vínculos (la compra más reciente o el vínculo más antiguo). Reaplicar no cambia un habitual ya elegido |
| 9 | `20261009f-price-and-product-idempotency` | Reprecio calculado en la base, cambio de precio y «Mantener precio» con costo esperado, clave de idempotencia del alta de producto | `keep_product_price` pasa a 3 argumentos. Reaplicar 6 deja dos sobrecargas: volver a aplicar este. **Reaplicar este obliga a reaplicar 23** |
| 10 | `20261010a-purchase-auto-link` | `create_purchase` vincula producto y proveedor en la misma transacción, también en un pedido | Requiere 7 y 8. Un pedido sin recibir escribe el costo del proveedor (no el del producto). Proveedor inactivo → `PT400`. Reaplicar 1 o 7 obliga a reaplicarlo; **reaplicarlo obliga a reaplicar 11** |
| 11 | `20261010b-purchase-inactive-product` | `create_purchase` rechaza (`PT400`) líneas de producto inactivo | `receive_purchase` no cambia: un pedido anterior se puede recibir. **Reaplicarlo obliga a reaplicar 12** |
| 12 | `20261010d-receive-disassemble` | «Desarmar al recibir»: columnas en `purchase_items` / `purchases`, RPC `receive_purchase_and_disassemble`; redefine `create_purchase` (**versión vigente**) | Reaplicar 1, 7, 10 u 11 (o `20261006c` / `f` / `h`) obliga a reaplicarlo. Va **antes** del BFF: sin él falla el detalle de compra |
| 13 | `20261010e-pack-recipe-always-disassemble` | Columna `always_disassemble_on_receive` en la cabecera de la receta | Solo añade la columna. Antes de 18. Sin ella el BFF falla al leer recetas. Se lee por tabla y se escribe solo por `save_pack_recipe` (paso 18) |
| 14 | `20261010f-receive-disassemble-invariant` | Constraint trigger: una compra no queda recibida con una línea marcada sin desarmar (`PT409`) | No valida filas existentes (la cabecera trae la consulta para localizarlas). No depende del BFF |
| 15 | `20261011a-inventory-overview` | Vista `inventory_overview` e índice `(product_id, seq desc)` en `stock_movements` | Índice sin `concurrently`. Sin ella falla `GET /api/inventory` |
| 16 | `20261011b-adjust-stock-inactive` | `adjust_stock` rechaza (`PT409`) la entrada libre a un producto inactivo | Reaplicar `20261006c` o `g` reinstala la versión sin guarda. Un script que cargue stock inicial debe crear el producto activo y desactivarlo después. No depende del BFF |
| 17 | `20261011c-save-pack-recipe` | RPC `save_pack_recipe` (5 argumentos): guarda la receta en una transacción con la regla de cadenas | **Reaplicarlo deja dos sobrecargas: aplicar 18 justo después.** Sin ella guardar una receta responde 409 |
| 18 | `20261012a-save-pack-recipe-always-disassemble` | `save_pack_recipe` pasa a 6 argumentos y guarda la preferencia «siempre desarmar» | Requiere 13 y 17. Va **antes** del BFF aunque su nombre ordene después de 25 |
| 19 | `20261012b-price-review-disassemble` | La cola «Por revisar» atribuye a la compra el costo de los componentes desarmados | Solo vista + índice sin `concurrently`. Reaplicar 6 obliga a reaplicarlo. No depende del BFF |
| 20 | `20261013a-report-money-views` | `daily_sales_summary` y `gross_profit_summary` a día de Caracas; cinco vistas de reportes de dinero | **Cambia cifras por día** (sección 3). Reaplicar `20260716b` las devuelve a UTC y quita `security_invoker`: volver a aplicar `20261006a` y este |
| 21 | `20261013b-report-inventory-views` | Vistas de productos sin movimiento, rotación y ajustes | Requiere 15. Se puede reaplicar solo |
| 22 | `20261015a-cash-close-diff-alert` | Umbral `app_settings.cash_close_diff_alert_ves` (default 0) del aviso de faltante al cerrar caja | Regenera los triggers de `20261006i` en `app_settings`. Orden con el BFF indistinto: sin él el umbral se lee 0 y guardarlo responde 409 |
| 23 | `20261017a-reprice-idempotency` | Clave de idempotencia del reprecio masivo (`reprice_product_to_markup` de 5 argumentos) | Reaplicar 9 deja dos sobrecargas: volver a aplicar este. Va **antes** del BFF, que ya envía la clave: sin él el reprecio masivo falla fila a fila |
| — | `verify-patches.sql` | Comprobación | **Tres filas en `fail`, y solo esas**: la de la política de lectura de `payments` de `20261010c`, la de privilegios de `20261011d` y la de RLS de `product_pack_components` de `20261009d`. Las tres piden los pasos 24 y 25. La de `10c` se deduce de leer `verify-patches.sql` (exige la política nueva); el lab siempre corrió el verify con todo aplicado, así que ese estado intermedio de tres filas no se ha ejecutado |
| — | **Desplegar el BFF** | | |
| 24 | `20261010c-payments-purchase-rls` | Los pagos de compras solo los leen admin y contador por PostgREST | **Después del BFF nuevo**: el anterior suma los pagos con la sesión del usuario en el detalle de compra y, sobre la base parcheada, almacén vería «Pagado 0». El BFF nuevo funciona igual con o sin el parche y ningún otro parche depende de él. Reaplicar `20260716-multi-store` reinstala la lectura sin filtro de rol: volver a aplicar este |
| 25 | `20261011d-pack-recipe-write-lockdown` | Revoca la escritura directa de `product_pack_conversions` y `product_pack_components`: la receta solo se escribe por `save_pack_recipe` | **Nunca antes del BFF nuevo**: el anterior escribe la receta por tabla y recibiría 403. Deshacer: `grant insert, update, delete on public.product_pack_conversions, public.product_pack_components to authenticated;` |
| — | `verify-patches.sql` | Comprobación | `fail = 0` |

El orden alfabético de los archivos **no** es el de despliegue: `20261010c` y `20261011d` van al final, después del BFF, y `20261012a` antes del BFF.

### Cadenas de reaplicación

Reaplicar un parche reinstala su versión de las funciones y pisa las posteriores. Resumen de lo que hay que volver a aplicar después, en este orden:

| Si reaplicas | Vuelve a aplicar |
|--------------|------------------|
| cualquiera de `20261006b` … `h` | Lo seguro es todo lo que este plan redefine encima, en orden: `7a` → `8a` → `9c` → `9d` → `9f` → `10a` → `10b` → `10d` → `11b` → `12b` → `17a` (y `11d` si ya estaba). Qué pisa cada uno: `c` / `f` / `h` → `create_purchase`; `b` / `c` / `f` / `g` / `h` → `register_payment`; `g` / `h` → `update_product_price`; `c` / `g` → `adjust_stock`; `c` → `convert_pack_to_units`; `d` → `conversion_mismatches` |
| `20261007a` | `9d` → `10a` → `10b` → `10d` (→ `11d`) |
| `20261009c` | `9f` → `17a` y `12b` |
| `20261009d` | `10a` → `10b` → `10d` y `11d` |
| `20261009f` | `17a` |
| `20261010a` | `10b` → `10d` |
| `20261010b` | `10d` |
| `20261011c` | `12a` |
| `20260716b` | `20261006a` y `13a` |
| `20260716-multi-store` | `10c` |

Después de cualquiera, `verify-patches.sql`: detecta las sobrecargas dobles y las funciones reinstaladas.

## 3. Cambios visibles tras desplegar

Además de las pantallas nuevas, cambian comportamientos que el usuario ya conocía:

- **Ventas diarias y ganancia bruta por día de Caracas.** Las ventas de 20:00 a 23:59 pasan del día siguiente (UTC) a su día real, también en la tendencia del dashboard. El total de un rango no cambia salvo por las ventas que cruzan su borde; una fila diaria de antes y otra de después no son comparables. «Cierre del día» y «Depreciación FX» dan cifras idénticas a las anteriores.
- **Reportes que ya no se cortan.** Depreciación FX, resumen del dashboard y top de clientes dejaban de contar a partir de 1.000 ventas, métodos de pago a partir de 1.000 filas, y varias rutas respondían 500 («URI too long») desde unas 220 ventas en el rango. Con muchos datos las cifras suben respecto a lo que se veía.
- **Vendedor con descuento → 403.** `POST /api/sales` rechaza un descuento > 0 de un vendedor (el POS web no lo ofrece) y un descuento ≥ subtotal de cualquiera.
- **Cajas por usuario.** Cada quien abre solo la caja que tiene asignada, un turno a la vez, y cierra solo el turno que abrió. Un administrador ya no cierra por la aplicación el turno de un vendedor: queda el cierre automático de fin de jornada.
- **Mensaje genérico en los 500.** Un error inesperado de la base ya no llega al usuario con el texto de Postgres; los 4xx de las RPC conservan su mensaje.
- **IVA solo por alícuota**: una compra con un porcentaje fuera del catálogo se rechaza.
- **Producto inactivo**: no admite compras nuevas ni entradas por ajuste (sí salidas y recibir pedidos anteriores).
- **Almacén ya no ve los pagos de una compra**, solo lo pagado y el saldo de la cabecera.
- **Pedidos**: un pedido sin recibir ya vincula el producto al proveedor con el costo de la línea.
- **Números con punto**: `30.600` se lee 30,60; el campo lo avisa bajo el valor («Se leerá como 30,60…») y no bloquea.
- **Compra pagada en USD que queda «Pago parcial».** Cuando el total en Bs de la compra no es exactamente `total_ref × tasa`, pagar todo el REF en USD deja un resto de unos bolívares (en el laboratorio, Bs 4,54 y 4,58 sobre una compra de 161,10 REF). Detalle, lista, Saldos del proveedor y Cuentas por pagar la muestran ahora «Pago parcial», con REF 0,00, el resto en Bs y botón «Pagar»; antes el detalle decía «Pagado». **Ese resto solo se salda con un pago en Bs.**
- **El detalle de compra ya no cuenta los pagos anulados.** Tras anular un pago, el detalle vuelve a mostrar el saldo y el botón «Pagar» (antes seguía en «Pagado», también en `main`). Los anulados siguen en el historial de pagos.
- **Categoría repetida al crearla desde el producto**: si otro usuario ya la creó, queda seleccionada con un aviso en vez de un error.
- **Borrador de compra restaurado**: si la alícuota de una categoría cambió desde que se guardó, un aviso dice qué líneas cambian.
- **Pago móvil en el POS**: banco, teléfono y referencia se piden al pulsar «Cobrar» la primera vez.

## 4. Hallazgos fuera de alcance

Problemas altos y medios que el plan encontró y **no** tocó, casi todos anteriores a la rama. La razón común es la regla 9 del plan (ninguna RPC cambia semántica monetaria ni de stock) y, para caja y baúl, [`cuadre-baul.md`](cuadre-baul.md).

| Ref. | Sev. | Qué es | Dónde | Por qué no se tocó |
|------|------|--------|-------|--------------------|
| D22 | Alto | Anular un pago recorta el saldo del baúl a 0 aunque la suma de sus movimientos dé negativo: el saldo deja de cuadrar con el libro | `cancel_payment_apply` (`20261006h`) | Semántica monetaria del baúl; pide un plan propio |
| D22 | Medio | `paid_ref` > `total_ref` en una compra pagada en USD con otra tasa | pagos de compra en USD | Igual |
| D34 | Alto | Vendedor y almacén leen por PostgREST los movimientos y saldos del baúl (incluidos pagos a proveedores) | RLS de `vault_movements` / `store_vaults`: solo filtra por tienda | Es baúl. El BFF sí los niega |
| D38, D59 | Medio | Vendedor y contador leen por PostgREST `inventory_overview` (con costo), `stock_movements`, `stock_card`, `stock_reconciliation` y las vistas de reportes de dinero e inventario | Políticas RLS por tienda, sin rol | Se dejó para un parche RLS único que no cambie lo que devuelve el BFF |
| D38, D43 | Medio | `create_purchase` no cruza los totales de la cabecera con las líneas y acepta descuento > subtotal (total 0) | RPC `create_purchase` | Validación monetaria de RPC |
| D59 | Medio | Almacén y vendedor ven el mix de pagos y la pérdida FX en «Cierre del día» | `GET /api/dashboard/daily-close` | Heredado; es decisión de permisos |
| D59 | Bajo | `open-documents` lee hasta 3.000 ventas y 5.000 compras y filtra en memoria; `borrador` cuenta como venta; el BFF registra la tasa de DolarAPI al arrancar | `openDocuments.server.ts`, reportes, `officialRateCache.ts` | Costo o criterio, no error; decisión del dueño pendiente en `borrador` |
| D63 | Medio | Anular una venta o una compra con pagos activos se rechaza: hay que anular antes cada pago. La devolución de venta es solo total | `cancel_sale`, `cancel_purchase`, `return_purchase`, `return_sale` | Unirlo en un paso o añadir la parcial exige RPC nuevas |
| D66 | Alto | Con el interruptor apagado, un admin puede vender y abrir o cerrar caja llamando las RPC por PostgREST con su sesión | `create_sale*`, `open_cash_session`, `close_cash_session` aceptan el rol admin | Cambiar la guarda de rol de RPC de venta y caja |
| D66 | Medio | Una tienda sin fila en `store_vaults` da 404 en Baúl y no admite fondo inicial en la primera apertura | alta de tienda / baúl | Es baúl |
| D66 | Medio | Nadie edita las notas de una venta con los roles por defecto (admin 403, vendedor 404) | `PATCH /api/sales/{id}` | Regla de permisos, sin decisión |
| D66 | Bajo | La caché de tasa oficial es única por proceso, no por tienda | `officialRateCache.ts` | El POS solo usa el valor; sin efecto medido |
| D74 | Medio | Un carácter NUL en texto libre de rutas no cubiertas llega a la base antes de responder 400, y en valores de query no se filtra. Cinco rutas se corrigieron (FIN-02) | BFF, rutas con texto libre | Lote acotado por presupuesto |
| D74, D84 | Bajo | `update_product_price` y `keep_product_price` no tienen clave de idempotencia en la base: una fila de historial por llamada repetida. Dos pestañas sobre el mismo producto envían cada una su POST (N2 en la sección 5) | `20261009c` / `f` | Solo se cerró el reprecio masivo (`20261017a`); la interfaz ya no envía un segundo POST al repetir el clic (GQ-09) |
| F1 | Medio | Con el interruptor «El administrador puede vender» apagado, el admin no puede anular ni devolver ventas: las rutas exigen `sales.create`. Las pasadas de QA lo probaron con el interruptor encendido | `sales/[id]/cancel`, `return`, `impact` | Regla de permisos de negocio anterior al plan; espera decisión del dueño |
| D84 | Medio | `register_payment` convierte el pago con `round(monto × tasa, 2)` y rechaza lo que pase del saldo + Bs 0,01: un pago en USD no puede saldar exacto una compra cuyo total en Bs no es `total_ref × tasa`. Queda un resto que solo se salda en Bs, y tras saldarlo `paid_ref` queda 0,01 por encima del total (B2) | RPC `register_payment` (`20261008a`) y totales de `create_purchase` | Aritmética monetaria de RPC, ya en `main`. El plan solo unificó cómo se muestra (GQ-07) |
| N4 | Bajo | Una compra ya saldada admite un pago extra de Bs 0,01 (la holgura de un céntimo): `paid_ves` queda en total + 0,01 y sale Bs 0,01 del baúl. El segundo intento da 400. Solo por API: ninguna pantalla ofrece «Pagar» con saldo 0. Las ventas no lo admiten | `20260904-payment-guards.sql:311` (`v_amount_ves > v_outstanding_ves + 0.01`) | Semántica monetaria de RPC y baúl; anterior al plan |
| D84 | Medio | El resumen de capital suma las cuentas por pagar en REF (`total_ref − paid_ref`), otro criterio que el del resto de la aplicación (Bs): una compra con resto solo en Bs no cuenta como deuda ahí | `store-capital-summary` (`20260906-store-capital-summary.sql`) | Vista de capital anterior al plan; cambiarla mueve la cifra de capital |
| D88 | Bajo | El índice único de nombres de categoría solo cubre las activas: se puede crear una categoría con el mismo nombre que una inactiva (201, no 409) | `uq_categories_store_name_active` (`20260716-multi-store.sql`) | Anterior al plan; decidir si una inactiva reserva el nombre es regla de negocio |
| D88 | Bajo | Los números `V-AAAAMMDD-…` y `C-AAAAMMDD-…` usan la fecha UTC: una venta de las 20:00 de Caracas del día 12 se numera con el 13 | `to_char(clock_timestamp(), 'YYYYMMDD')` (`20261006b`) | Ya en `main`; cambiarlo toca la numeración de documentos |
| — | Bajo | La regla `@page { size: 80mm auto }` del ticket no es un tamaño de página válido: el recibo sale en hoja Carta | `SaleReceiptPrintPageStyle.tsx` (la regla venía de `globals.css`) | Anterior al plan; hay que probarlo con la impresora térmica real |

Sin verificar por nadie en este plan: lector de barras físico, táctil real, Firefox y Safari, la app móvil y la ruta del cron de autocierre con su secreto.

Pasadas de cierre: QA global 2, 3 y 4 y caos global 2 y 3 están hechas. La pasada 3 (QA y caos) salió limpia sobre `d3e3dda`; la pasada 4 de QA, sobre el mismo commit, no halló altos ni medios introducidos por el plan y sí un medio anterior al plan (el detalle de compra contaba pagos anulados), reparado en `d91be94` (GQ-10). El caos global de la pasada 4 se ejecuta sobre `d91be94` e incluye la verificación de GQ-10 contra base real; al escribir esto no había terminado. Es una rebaja declarada del criterio «dos pasadas limpias consecutivas sobre el mismo commit».

## 5. Bajos conocidos al cierre

Defectos menores que el plan dejó sin corregir. Casi todos son de presentación; los que tocan dinero remiten a la sección 4.

| Ref. | Qué se ve | Dónde |
|------|-----------|-------|
| B1 | La columna «SALDO (REF)» de la lista de compras muestra «Bs. 4,54» cuando el saldo en REF es 0 y queda resto en Bs; la banda de saldo cuenta esa compra con ref 0,00 | Lista de compras (desde GQ-07) |
| B2 | Tras saldar en Bs el resto, el detalle dice «PAGADO ref 161.11» sobre un total de ref 161.10 | Detalle de compra; aritmética de `register_payment` (sección 4) |
| N1 | Borrador de compra con una alícuota elegida a mano que luego se desactiva: al restaurar, esas líneas pasan a la alícuota de su categoría y el aviso no lo nombra bien | `purchaseDraftStorage.ts` (residuo de GC-02) |
| N2 | Dos pestañas sobre el mismo producto en «Por revisar»: cada una envía su POST; una pestaña obsoleta puede «Aplicar» después de un «Mantener», y puede quedar una fila de historial sin cambio. A lo sumo un cambio real de precio | Cambio de precio y «Mantener precio» |
| N3 | El aviso de IVA del borrador enumera todas las líneas por nombre: con muchas líneas es un párrafo | Restaurar borrador de compra |
| — | El Excel de compras solo trae REF y no tiene columna de estado de pago: una compra con resto en Bs se lee como saldada | Exportación de la lista de compras |
| — | `PaymentDetailBalanceCard` muestra el saldo solo en REF: «SALDO RESTANTE 0,00 REF» mientras lista, Saldos y Cuentas por pagar dicen Bs. 4,58 | Detalle de un pago (`/payments/<id>`) |
| — | El resumen de la sección Pagos del detalle de compra cuenta también los anulados («1 pago · pagado ref 0.00») | Detalle de compra (tras GQ-10) |
| — | `CategoryFormModal` no recibió el arreglo de GC-01: ante un nombre repetido solo muestra el mensaje de error | Pantalla de Categorías |
| — | «Duplicar compra» y la reposición no muestran el aviso de cambio de IVA de GC-02 | Compra nueva precargada |
| — | La categoría creada desde el mini-modal nace con alícuota 0 % | `CategoryQuickCreateModal` |
| — | 14 stories de Storybook fallan; Storybook no forma parte del gate (typecheck, lint, jest, build) | Storybook |
| — | Reportes con gráfico: 17 de 21. Sin gráfico: Bajo stock, Kardex, Cierre del día y Depreciación FX | Reportes |
| — | «Recordar los últimos filtros» existe (`useRememberedListFilters`, `RememberedFiltersChip`) pero ningún listado lo monta | Listados |

## Contradicciones sin resolver

Ninguna. Las cuatro diferencias que este documento listaba al cierre del plan quedaron resueltas en DOC-02 (posición de `20261010c`, cabecera de `20261010e`, lista de `stock-integrity.md` §7 y `20261008a` «indistinto»), y la quinta en GQ-08: la cabecera de `20261011d-pack-recipe-write-lockdown.sql` ya dice que, con `20261010c` también después del BFF, en el primer verify quedan en `fail` tres filas (las dos de `11d` y la de `10c`), como la tabla de la sección 2.
