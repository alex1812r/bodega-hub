-- =============================================================================
-- 20261013a — vistas de los reportes de dinero (REP-06a; plan ux-mejoras §4.9)
-- Proyecto: BodegaHub
-- Requiere: 20260716b (vistas con store_id), 20260811b / 20260819 (cash_sessions
--           con teorico, contado y closed_reason), 20261006a (security_invoker
--           en las vistas de reportes) y 20261006h (RLS por tienda).
--
-- SOLO LECTURA: crea / redefine vistas. No toca tablas, filas, RPC, politicas,
-- stock ni dinero. No escribe en cash_* ni en el baul.
--
-- 0. daily_sales_summary y gross_profit_summary agrupaban por dia UTC
--    (date_trunc('day', created_at)::date): una venta de 20:00-23:59 Caracas
--    caia en el dia siguiente. Pasan a dia operativo de Caracas
--    ((created_at at time zone 'America/Caracas')::date). Mismas columnas, tipos
--    y filtro de estado: los totales de un rango amplio no cambian, solo el dia
--    al que se asigna cada venta.
--
--    CAMBIO DE COMPORTAMIENTO (leer antes de comparar cifras por dia):
--    a) Desde este parche sale_date es el dia operativo America/Caracas. Antes
--       era el dia UTC: una fila diaria de antes y otra de despues NO son
--       comparables entre si (cambia el reparto por dia, no el total del rango).
--    b) ORDEN DE PARCHES: 20260716b-multi-store-views.sql hace drop + create de
--       estas dos vistas con date_trunc('day', created_at)::date. REAPLICAR
--       20260716b las DEVUELVE a dia UTC: despues hay que volver a aplicar este
--       parche (20261013a). verify-patches.sql lo detecta (fila "agrupan por dia
--       operativo de Caracas").
--    c) "Cierre del dia" (dailyCloseSummary.server.ts) y "Depreciacion FX"
--       (fxDepreciationReport.server.ts) NO leen estas vistas: leen sales,
--       sale_items, payments y exchange_rates con el rango ya convertido a dia
--       Caracas. Sus cifras son identicas antes y despues del parche (medido en
--       la base lab: .notes/ux-mejoras/reportes/lab/no-rompe/, diff vacio).
--
--    CRITERIO UNICO DE ESTADOS de los reportes de ventas (vistas existentes y
--    las de este parche): se excluyen SOLO 'cancelada' y 'devuelta'. Una venta
--    en 'borrador' CUENTA ('borrador', 'pendiente_pago' y 'pagada' entran).
--    Es un hallazgo abierto que no se cambia en el plan ux-mejoras: cambiarlo
--    exige hacerlo a la vez en todas las vistas y en el mock. Los reportes de
--    inventario (20261013b) no filtran por estado de venta: leen el libro
--    stock_movements, y una venta cancelada o devuelta aparece alli con su
--    salida y su reversion; para "que es una venta que cuenta" remiten a esta
--    definicion. Compras ("Compras por periodo", tabla purchases, sin vista):
--    por defecto se excluyen 'cancelado' y 'devuelto' en la tabla Y en la serie
--    (parametro status=all o un estado concreto para verlas).
--
-- 1. report_sales_by_hour: ventas no canceladas ni devueltas (criterio de
--    daily_sales_summary) por tienda, dia Caracas, dia de la semana ISO
--    (1 = lunes ... 7 = domingo) y hora Caracas (0-23).
--
-- 2. report_sales_by_category: lineas de venta por tienda, dia Caracas y
--    categoria ACTUAL del producto ("Sin categoría" si no tiene). Ingreso, costo
--    y ganancia salen de las mismas columnas que gross_profit_summary
--    (subtotal_ref, unit_cost_ref_snapshot * quantity, gross_profit_ref): no se
--    recalcula ningun costo. products y categories entran con left join para que
--    la suma de todas las categorias sea exactamente la de gross_profit_summary.
--
-- 3. report_open_documents_aging: documentos abiertos con su antiguedad. Es el
--    criterio de GET /api/payments/open-documents (openDocuments.server.ts):
--      * venta abierta  = status 'pendiente_pago' y round(total_ves - paid_ves, 2) > 0;
--        pendiente REF  = round(pendiente Bs / ref_rate_ves, 2) (tasa del documento);
--      * compra abierta = status 'pedido' o 'recibido' y round(total_ves - paid_ves, 2) > 0;
--        pendiente REF  = greatest(round(total_ref - paid_ref, 2), 0).
--    Las ventas no guardan lo cobrado en REF: paid_ref = total_ref - pendiente
--    REF. days = dias de calendario Caracas entre el documento y hoy (no existe
--    fecha de vencimiento en sales / purchases). bucket: '0-7', '8-30', '30+'.
--    report_open_documents_aging_summary: numero de documentos y pendiente por
--    tramo. contact_id null = todo el conjunto de la tienda; con valor = solo
--    ese contacto (customer_id / supplier_id son not null, no hay ambiguedad).
--
-- 4. report_cash_close_differences: una fila por sesion de caja cerrada y
--    moneda de efectivo ('ves' / 'ref') con lo esperado (theoretical_closing_*,
--    el teorico que guardo close_cash_session / el autocierre), lo contado
--    (closing_*) y la diferencia contado - esperado. No recalcula el teorico.
--    running_* es el acumulado de la tienda y moneda en orden de cierre
--    (closed_at, id), para paginar y totalizar un rango sin leerlo entero.
--    Las sesiones sin teorico o sin contado guardado no aparecen.
--
-- Todas: security_invoker (RLS de las tablas base del que consulta), sin acceso
-- para public / anon y select para authenticated y service_role. Nada por
-- vendedor / usuario. Idempotente, una transaccion.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Resumenes diarios en dia operativo de Caracas
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
where status not in ('cancelada', 'devuelta')
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
where s.status not in ('cancelada', 'devuelta')
group by s.store_id, (s.created_at at time zone 'America/Caracas')::date;

-- -----------------------------------------------------------------------------
-- 1. Ventas por hora y dia de la semana
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
where s.status not in ('cancelada', 'devuelta')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  extract(isodow from (s.created_at at time zone 'America/Caracas'))::integer,
  extract(hour from (s.created_at at time zone 'America/Caracas'))::integer;

comment on view public.report_sales_by_hour is
  'Ventas no canceladas ni devueltas por tienda, dia Caracas, dia de la semana ISO (1 = lunes) y hora Caracas (REP-06).';

-- -----------------------------------------------------------------------------
-- 2. Ventas y margen por categoria
-- -----------------------------------------------------------------------------

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
where s.status not in ('cancelada', 'devuelta')
group by
  s.store_id,
  (s.created_at at time zone 'America/Caracas')::date,
  p.category_id,
  coalesce(c.name, 'Sin categoría');

comment on view public.report_sales_by_category is
  'Unidades, ingreso, costo (snapshot de la linea) y ganancia por tienda, dia Caracas y categoria actual del producto; su suma es la de gross_profit_summary (REP-06).';

-- -----------------------------------------------------------------------------
-- 3. Cuentas por cobrar / por pagar con antiguedad
-- -----------------------------------------------------------------------------

create or replace view public.report_open_documents_aging
with (security_invoker = true) as
select
  d.store_id,
  d.doc_type,
  d.document_id,
  d.document_number,
  d.contact_id,
  c.name as contact_name,
  d.created_at,
  (d.created_at at time zone 'America/Caracas')::date as document_date,
  a.days,
  case when a.days <= 7 then '0-7' when a.days <= 30 then '8-30' else '30+' end as bucket,
  d.ref_rate_ves,
  d.total_ref,
  d.total_ves,
  d.paid_ref,
  d.paid_ves,
  d.pending_ref,
  d.pending_ves
from (
  select
    s.store_id,
    'sale'::text as doc_type,
    s.id as document_id,
    s.invoice_number as document_number,
    s.customer_id as contact_id,
    s.created_at,
    s.ref_rate_ves,
    s.total_ref,
    s.total_ves,
    greatest(round(s.total_ref - round(round(s.total_ves - s.paid_ves, 2) / s.ref_rate_ves, 2), 2), 0) as paid_ref,
    s.paid_ves,
    round(round(s.total_ves - s.paid_ves, 2) / s.ref_rate_ves, 2) as pending_ref,
    round(s.total_ves - s.paid_ves, 2) as pending_ves
  from public.sales s
  where s.status = 'pendiente_pago'
    and round(s.total_ves - s.paid_ves, 2) > 0
  union all
  select
    p.store_id,
    'purchase'::text as doc_type,
    p.id as document_id,
    p.purchase_number as document_number,
    p.supplier_id as contact_id,
    p.created_at,
    p.ref_rate_ves,
    p.total_ref,
    p.total_ves,
    p.paid_ref,
    p.paid_ves,
    greatest(round(p.total_ref - p.paid_ref, 2), 0) as pending_ref,
    round(p.total_ves - p.paid_ves, 2) as pending_ves
  from public.purchases p
  where p.status in ('pedido', 'recibido')
    and round(p.total_ves - p.paid_ves, 2) > 0
) d
left join public.contacts c on c.id = d.contact_id
cross join lateral (
  select greatest(
    (now() at time zone 'America/Caracas')::date - (d.created_at at time zone 'America/Caracas')::date,
    0
  ) as days
) a;

comment on view public.report_open_documents_aging is
  'Ventas por cobrar y compras por pagar (criterio de /api/payments/open-documents) con dias Caracas desde el documento y tramo 0-7 / 8-30 / 30+ (REP-06).';

create or replace view public.report_open_documents_aging_summary
with (security_invoker = true) as
select
  d.store_id,
  d.doc_type,
  d.contact_id,
  d.bucket,
  count(*) as documents_count,
  sum(d.pending_ref) as pending_ref,
  sum(d.pending_ves) as pending_ves
from public.report_open_documents_aging d
group by grouping sets (
  (d.store_id, d.doc_type, d.bucket),
  (d.store_id, d.doc_type, d.bucket, d.contact_id)
);

comment on view public.report_open_documents_aging_summary is
  'Documentos abiertos y pendiente por tramo: contact_id null = toda la tienda; con valor = ese contacto (REP-06).';

-- -----------------------------------------------------------------------------
-- 4. Diferencias de cierre de caja (contado - teorico guardado al cerrar)
-- -----------------------------------------------------------------------------

create or replace view public.report_cash_close_differences
with (security_invoker = true) as
select
  cs.store_id,
  cs.id as cash_session_id,
  cs.register_id,
  cr.name as register_name,
  cs.closed_at,
  (cs.closed_at at time zone 'America/Caracas')::date as close_date,
  cs.closed_reason,
  v.currency,
  v.expected,
  v.counted,
  v.counted - v.expected as difference,
  sum(v.expected) over w as running_expected,
  sum(v.counted) over w as running_counted,
  sum(v.counted - v.expected) over w as running_difference
from public.cash_sessions cs
left join public.cash_registers cr on cr.id = cs.register_id
cross join lateral (
  values
    ('ves'::text, cs.theoretical_closing_ves, cs.closing_ves),
    ('ref'::text, cs.theoretical_closing_ref, cs.closing_ref)
) as v(currency, expected, counted)
where cs.status = 'closed'
  and v.expected is not null
  and v.counted is not null
window w as (
  partition by cs.store_id, v.currency
  order by cs.closed_at, cs.id
  rows between unbounded preceding and current row
);

comment on view public.report_cash_close_differences is
  'Sesion de caja cerrada x moneda de efectivo: teorico guardado, contado, diferencia y acumulado por tienda y moneda en orden de cierre (REP-06). Solo lectura.';

-- -----------------------------------------------------------------------------
-- 5. Permisos: sin public / anon; lectura para authenticated y service_role
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
    'report_open_documents_aging',
    'report_open_documents_aging_summary',
    'report_cash_close_differences'
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
