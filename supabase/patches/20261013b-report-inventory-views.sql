-- =============================================================================
-- 20261013b — vistas de los reportes de inventario (REP-07a; plan ux-mejoras §4.9)
-- Proyecto: BodegaHub
-- Requiere: 20260716 (store_id en products y stock_movements), 20261006a
--           (stock_movements.seq), 20261006h (RLS por tienda) y 20261011a
--           (indice idx_stock_movements_product_seq).
--
-- SOLO LECTURA: crea vistas. No toca tablas, filas, RPC, politicas, stock ni
-- dinero. Nada escribe products.current_stock ni stock_movements.
--
-- Fuente: el LIBRO public.stock_movements en su orden real (seq). Ninguna vista
-- lee stock_movements.stock_after: los saldos historicos se reconstruyen
-- sumando quantity_delta.
--
-- Clasificacion de movimientos (la de Inventario y las vistas de integridad
-- 20261006d, no se inventa otra):
--   * salida por venta ............ type = 'venta'
--   * reversion de una venta ...... type = 'devolucion_cliente', o
--                                   type = 'ajuste_entrada' con sale_id (lo que
--                                   insertan cancel_sale / return_sale)
--   * ajuste manual ............... type in ('ajuste_entrada', 'ajuste_salida')
--                                   sin sale_id ni purchase_id. La merma no es
--                                   un tipo: es un ajuste_salida con su motivo.
--   * NO son ajustes: 'ajuste_salida' con purchase_id (cancel_purchase),
--     'ajuste_entrada' con sale_id (reversion de venta), 'inventario_inicial',
--     'compra', 'devolucion_proveedor' y 'conversion_salida' /
--     'conversion_entrada' (apertura de empaque: tipo propio de Inventario).
--
-- 1. report_product_last_movement: una fila por producto (activos e inactivos;
--    el BFF filtra) con su saldo vigente (products.current_stock, el mismo que
--    da inventory_overview y que stock_reconciliation compara con el libro), el
--    costo unitario current_cost_ref (ya incluye IVA: no se reaplica), el valor
--    a costo y las fechas del libro:
--      last_sale_at       created_at del movimiento 'venta' de mayor seq;
--      last_movement_at   created_at del movimiento de mayor seq (cualquier tipo);
--      first_movement_at  created_at del movimiento de menor seq;
--      idle_since         dia Caracas desde el que el producto esta sin vender:
--                         el de su ultima venta; si nunca se vendio, el de su
--                         primer movimiento; sin movimientos, el de su alta.
--    El "hoy" y el filtro de N dias los pone el BFF (idle_since <= hoy - N):
--    la vista no fija la fecha.
--
-- 2. report_stock_daily_flow: tienda x dia Caracas x producto con
--      net_delta    suma de quantity_delta de TODOS los movimientos del dia
--                   (para reconstruir el saldo a una fecha desde el vigente);
--      sold_units   unidades vendidas netas: -suma de quantity_delta de las
--                   salidas por venta y sus reversiones;
--      cogs_ref     costo de lo vendido neto: unidades x costo de la linea de
--                   venta (sale_items.unit_cost_ref_snapshot, promedio ponderado
--                   de las lineas de ese producto en esa venta); si el movimiento
--                   no tiene linea de venta, current_cost_ref actual.
--
-- 3. report_stock_adjustments: una fila por ajuste manual con su motivo
--    normalizado (espacios colapsados; 'Sin motivo' si viene vacio) y su valor a
--    costo. El libro no guarda el costo del movimiento: value_ref usa
--    current_cost_ref ACTUAL y cost_basis lo dice ('current_cost').
--
-- Estado de la venta: el criterio de los reportes es el de daily_sales_summary
-- (definicion vigente y descripcion en 20261013a-report-money-views.sql, puntos
-- 0 y 1: cuentan todas las ventas salvo 'cancelada' y 'devuelta'; un 'borrador'
-- cuenta). Estas vistas NO filtran por sales.status: leen el libro, donde una
-- venta anulada o devuelta queda en neto 0 porque su reversion compensa la
-- salida (mismo resultado que excluirla, con cada movimiento en su dia), una
-- devolucion parcial resta solo lo devuelto y un borrador no tiene movimientos.
-- Si algun dia una vista de este parche necesita el estado, usa ese criterio.
--
-- Ninguna vista expone created_by: nada por usuario / vendedor.
--
-- Quien ve filas: security_invoker, asi que mandan las RLS de las tablas base
-- (products, stock_movements, categories, sale_items: store_id =
-- current_user_store_id()). Las vistas no amplian quien lee el libro: ven filas
-- los mismos roles de la tienda que ya leen stock_movements, y nadie de otra
-- tienda. Sin acceso para public / anon; select para authenticated y
-- service_role. Idempotente, una transaccion.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Saldo, valor a costo y ultimas fechas del libro por producto
-- -----------------------------------------------------------------------------

create or replace view public.report_product_last_movement
with (security_invoker = true) as
select
  p.store_id,
  p.id as product_id,
  p.sku,
  p.name,
  p.is_active,
  p.category_id,
  coalesce(c.name, 'Sin categoría') as category_name,
  p.current_stock as stock,
  p.current_cost_ref as cost_ref,
  round(p.current_stock * p.current_cost_ref, 2) as stock_value_ref,
  ls.created_at as last_sale_at,
  lm.created_at as last_movement_at,
  fm.created_at as first_movement_at,
  (coalesce(ls.created_at, fm.created_at, p.created_at) at time zone 'America/Caracas')::date as idle_since
from public.products p
left join public.categories c on c.id = p.category_id
left join lateral (
  select m.created_at
  from public.stock_movements m
  where m.product_id = p.id
    and m.type = 'venta'
  order by m.seq desc
  limit 1
) ls on true
left join lateral (
  select m.created_at
  from public.stock_movements m
  where m.product_id = p.id
  order by m.seq desc
  limit 1
) lm on true
left join lateral (
  select m.created_at
  from public.stock_movements m
  where m.product_id = p.id
  order by m.seq asc
  limit 1
) fm on true;

comment on view public.report_product_last_movement is
  'Producto con saldo vigente, valor a costo, ultima venta / ultimo / primer movimiento del libro (por seq) e idle_since (dia Caracas desde el que no se vende) (REP-07). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 2. Flujo diario del libro por producto: neto, vendido neto y costo de lo vendido
-- -----------------------------------------------------------------------------

create or replace view public.report_stock_daily_flow
with (security_invoker = true) as
select
  m.store_id,
  (m.created_at at time zone 'America/Caracas')::date as movement_date,
  m.product_id,
  sum(m.quantity_delta)::integer as net_delta,
  coalesce(sum(-m.quantity_delta) filter (where k.is_sale), 0)::integer as sold_units,
  coalesce(
    sum(round(-m.quantity_delta * coalesce(sc.unit_cost_ref, p.current_cost_ref), 2)) filter (where k.is_sale),
    0
  ) as cogs_ref
from public.stock_movements m
join public.products p on p.id = m.product_id
cross join lateral (
  select (
    m.type in ('venta', 'devolucion_cliente')
    or (m.type = 'ajuste_entrada' and m.sale_id is not null)
  ) as is_sale
) k
left join lateral (
  select sum(si.unit_cost_ref_snapshot * si.quantity) / nullif(sum(si.quantity), 0) as unit_cost_ref
  from public.sale_items si
  where si.sale_id = m.sale_id
    and si.product_id = m.product_id
) sc on k.is_sale and m.sale_id is not null
group by
  m.store_id,
  (m.created_at at time zone 'America/Caracas')::date,
  m.product_id;

comment on view public.report_stock_daily_flow is
  'Libro de stock por tienda, dia Caracas y producto: neto de todos los movimientos, unidades vendidas netas de reversiones y su costo (snapshot de la linea de venta) (REP-07). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 3. Ajustes manuales (incluye mermas) con motivo y valor a costo
-- -----------------------------------------------------------------------------

create or replace view public.report_stock_adjustments
with (security_invoker = true) as
select
  m.store_id,
  m.id as movement_id,
  m.seq,
  m.created_at,
  (m.created_at at time zone 'America/Caracas')::date as movement_date,
  m.product_id,
  p.sku,
  p.name as product_name,
  m.type::text as movement_type,
  m.quantity_delta,
  coalesce(nullif(btrim(regexp_replace(m.reason, '\s+', ' ', 'g')), ''), 'Sin motivo') as reason,
  p.current_cost_ref as unit_cost_ref,
  round(m.quantity_delta * p.current_cost_ref, 2) as value_ref,
  'current_cost'::text as cost_basis
from public.stock_movements m
join public.products p on p.id = m.product_id
where m.type in ('ajuste_entrada', 'ajuste_salida')
  and m.sale_id is null
  and m.purchase_id is null;

comment on view public.report_stock_adjustments is
  'Ajustes manuales del libro (ajuste_entrada / ajuste_salida sin documento) con motivo normalizado y valor al costo ACTUAL del producto (cost_basis = current_cost) (REP-07). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 4. Permisos: sin public / anon; lectura para authenticated y service_role
-- -----------------------------------------------------------------------------

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'report_product_last_movement',
    'report_stock_daily_flow',
    'report_stock_adjustments'
  ]
  loop
    execute format('alter view public.%I set (security_invoker = true)', v_view);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
