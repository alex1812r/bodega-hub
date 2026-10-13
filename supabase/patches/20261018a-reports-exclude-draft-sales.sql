-- =============================================================================
-- 20261018a — los reportes no cuentan las ventas en borrador (DEC-01)
-- Proyecto: BodegaHub
-- Requiere: 20260716b (product_profitability y customer_purchase_summary con
--           store_id), 20261006a (security_invoker en las vistas de reportes),
--           20261006h (RLS por tienda) y 20261013a (daily_sales_summary y
--           gross_profit_summary en dia operativo de Caracas, y las vistas
--           report_sales_by_hour y report_sales_by_category).
--
-- SOLO LECTURA: redefine vistas. No toca tablas, filas, RPC, politicas, stock
-- ni dinero.
--
-- DECISION DE NEGOCIO (DEC-01): una venta en 'borrador' NO es una venta. Hasta este parche
-- el criterio unico de los reportes (cabecera de 20261013a) solo dejaba fuera
-- 'cancelada' y 'devuelta', asi que un borrador sumaba en ventas diarias,
-- ganancia bruta, rentabilidad por producto, compras por cliente, ventas por
-- hora y ventas por categoria.
--
-- CRITERIO UNICO DE ESTADOS de los reportes de ventas desde este parche
-- (enum public.sale_status: 'borrador', 'pendiente_pago', 'pagada',
-- 'cancelada', 'devuelta'):
--
--     cuenta    : status in ('pendiente_pago', 'pagada')   (mueven stock)
--     no cuenta : 'borrador', 'cancelada', 'devuelta'
--
-- Se escribe como lista POSITIVA: un estado nuevo del enum no cuenta hasta que
-- alguien lo decida. En el BFF la misma lista vive en un solo sitio:
-- src/shared/sales/countedSaleStatuses.ts (COUNTED_SALE_STATUSES), que usan
-- los servicios de reportes y del dashboard y sus mocks.
--
-- Vistas que se redefinen (las 6 que filtran ventas por estado), cada una
-- copiada de su version VIGENTE con el filtro como unico cambio:
--
--   daily_sales_summary        20261013a (dia operativo America/Caracas)
--   gross_profit_summary       20261013a (dia operativo America/Caracas)
--   report_sales_by_hour       20261013a
--   report_sales_by_category   20261013a
--   product_profitability      20260716b (+ security_invoker de 20261006a)
--   customer_purchase_summary  20260716b (+ security_invoker de 20261006a)
--
-- Mismas columnas, tipos y orden (create or replace view), security_invoker y
-- los mismos permisos: sin acceso para public / anon, select para authenticated
-- y service_role.
--
-- Vistas que NO cambian, y por que:
--   * report_open_documents_aging (20261013a): venta abierta = 'pendiente_pago'
--     con saldo; un borrador nunca entro.
--   * store_capital_summary (20260906 / 20260906c): cuentas por cobrar =
--     'pendiente_pago'.
--   * report_product_last_movement, report_stock_daily_flow y
--     report_stock_adjustments (20261013b): leen el libro stock_movements, no
--     sales.status. Ninguna RPC mueve stock de una venta en borrador
--     (cancel_sale y return_sale la rechazan; register_payment tambien), y una
--     venta en borrador con movimientos es una fila de
--     movements_without_document con issue = 'document_status_mismatch'
--     (20261006d), no una venta.
--   * supplier_purchase_summary: es de compras.
--
-- CAMBIO DE COMPORTAMIENTO: solo para bases que tengan ventas en 'borrador'.
-- Ninguna RPC ni pantalla las crea hoy (create_sale y
-- create_sale_with_payments nacen 'pendiente_pago' o 'pagada'); con 0
-- borradores todas las cifras son identicas a las de antes. Para contarlos
-- antes de aplicar:
--
--     select store_id, count(*), sum(total_ref)
--     from public.sales where status = 'borrador' group by store_id;
--
-- ORDEN DE PARCHES. No depende del BFF: va en la tanda previa, despues de
-- 20261017a. Cualquier parche que recree una de las 6 vistas le devuelve el
-- criterio anterior y obliga a REAPLICAR este al final:
--   * 20260716b-multi-store-views.sql (drop + create de daily_sales_summary,
--     gross_profit_summary, product_profitability y customer_purchase_summary;
--     ademas las devuelve a dia UTC y les quita security_invoker): despues,
--     20261006a -> 20261013a -> 20261018a.
--   * 20261013a-report-money-views.sql (create or replace de
--     daily_sales_summary, gross_profit_summary, report_sales_by_hour y
--     report_sales_by_category): despues, 20261018a.
-- 20261006a solo hace alter view (security_invoker y permisos): no cambia el
-- filtro. verify-patches.sql detecta las dos regresiones (filas "(20261018a)").
--
-- Idempotente, una transaccion.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Resumenes diarios (dia operativo de Caracas, como en 20261013a)
-- -----------------------------------------------------------------------------

create or replace view public.daily_sales_summary
with (security_invoker = true) as
select
  store_id,
  (created_at at time zone 'America/Caracas')::date as sale_date,
  count(*) as sales_count,
  sum(total_ref) as total_ref,
  sum(total_ves) as total_ves,
  sum(paid_ves) as paid_ves
from public.sales
where status in ('pendiente_pago', 'pagada')
group by store_id, (created_at at time zone 'America/Caracas')::date;

create or replace view public.gross_profit_summary
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.status in ('pendiente_pago', 'pagada')
group by s.store_id, (s.created_at at time zone 'America/Caracas')::date;

-- -----------------------------------------------------------------------------
-- 2. Ventas por hora y por categoria (20261013a)
-- -----------------------------------------------------------------------------

create or replace view public.report_sales_by_hour
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer as dow,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer as hour,
  count(*) as sales_count,
  sum(s.total_ref) as total_ref,
  sum(s.total_ves) as total_ves
from public.sales s
where s.status in ('pendiente_pago', 'pagada')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer;

comment on view public.report_sales_by_hour is
  'Ventas que cuentan (pendiente_pago y pagada; no borrador, cancelada ni devuelta) por tienda, dia Caracas, dia de la semana ISO (1 = lunes) y hora Caracas (REP-06, DEC-01).';

create or replace view public.report_sales_by_category
with (security_invoker = true) as
select
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date as sale_date,
  p.category_id,
  coalesce(c.name, 'Sin categoría') as category_name,
  sum(si.quantity) as units,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
left join public.products p on p.id = si.product_id
left join public.categories c on c.id = p.category_id
where s.status in ('pendiente_pago', 'pagada')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  p.category_id,
  coalesce(c.name, 'Sin categoría');

-- -----------------------------------------------------------------------------
-- 3. Rentabilidad por producto y compras por cliente (20260716b)
-- -----------------------------------------------------------------------------

create or replace view public.product_profitability
with (security_invoker = true) as
select
  p.store_id,
  p.id as product_id,
  p.sku,
  p.name,
  sum(si.quantity) as units_sold,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.products p
join public.sale_items si on si.product_id = p.id
join public.sales s on s.id = si.sale_id
where s.status in ('pendiente_pago', 'pagada')
group by p.store_id, p.id, p.sku, p.name;

create or replace view public.customer_purchase_summary
with (security_invoker = true) as
select
  c.store_id,
  c.id as customer_id,
  c.name,
  count(s.id) as sales_count,
  coalesce(sum(s.total_ref), 0) as total_ref,
  coalesce(sum(s.total_ves), 0) as total_ves,
  coalesce(sum(s.total_ves - s.paid_ves), 0) as pending_ves,
  max(s.created_at) as last_purchase_at
from public.contacts c
left join public.sales s
  on s.customer_id = c.id
 and s.status in ('pendiente_pago', 'pagada')
where c.type in ('cliente', 'ambos')
group by c.store_id, c.id, c.name;

-- -----------------------------------------------------------------------------
-- 4. Permisos: sin public / anon; lectura para authenticated y service_role
-- -----------------------------------------------------------------------------

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'daily_sales_summary',
    'gross_profit_summary',
    'report_sales_by_hour',
    'report_sales_by_category',
    'product_profitability',
    'customer_purchase_summary'
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
