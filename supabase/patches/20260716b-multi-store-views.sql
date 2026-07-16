-- Patch: recrear vistas con store_id (post multitienda)
-- Ejecutar DESPUES de 20260716a + 20260716-multi-store.sql
-- Corrige 500 en dashboard/summary, sales-trend, low-stock, reportes e inventario.
--
-- Nota: hay que DROP + CREATE (no REPLACE) porque se agrega store_id y PostgreSQL
-- no permite cambiar nombre/orden de columnas de una vista existente (error 42P16).

drop view if exists public.stock_card;
drop view if exists public.low_stock_products;
drop view if exists public.supplier_purchase_summary;
drop view if exists public.customer_purchase_summary;
drop view if exists public.product_profitability;
drop view if exists public.gross_profit_summary;
drop view if exists public.daily_sales_summary;

create view public.daily_sales_summary as
select
  store_id,
  date_trunc('day', created_at)::date as sale_date,
  count(*) as sales_count,
  sum(total_ref) as total_ref,
  sum(total_ves) as total_ves,
  sum(paid_ves) as paid_ves
from public.sales
where status not in ('cancelada', 'devuelta')
group by store_id, date_trunc('day', created_at)::date;

create view public.gross_profit_summary as
select
  s.store_id,
  date_trunc('day', s.created_at)::date as sale_date,
  sum(si.subtotal_ref) as revenue_ref,
  sum(si.unit_cost_ref_snapshot * si.quantity) as cost_ref,
  sum(si.gross_profit_ref) as gross_profit_ref
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.status not in ('cancelada', 'devuelta')
group by s.store_id, date_trunc('day', s.created_at)::date;

create view public.product_profitability as
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
where s.status not in ('cancelada', 'devuelta')
group by p.store_id, p.id, p.sku, p.name;

create view public.customer_purchase_summary as
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
 and s.status not in ('cancelada', 'devuelta')
where c.type in ('cliente', 'ambos')
group by c.store_id, c.id, c.name;

create view public.supplier_purchase_summary as
select
  c.store_id,
  c.id as supplier_id,
  c.name,
  count(p.id) as purchases_count,
  coalesce(sum(p.total_ref), 0) as total_ref,
  coalesce(sum(p.total_ves), 0) as total_ves,
  coalesce(sum(p.total_ves - p.paid_ves), 0) as pending_ves,
  max(p.created_at) as last_purchase_at
from public.contacts c
left join public.purchases p
  on p.supplier_id = c.id
 and p.status not in ('cancelado', 'devuelto')
where c.type in ('proveedor', 'ambos')
group by c.store_id, c.id, c.name;

create view public.low_stock_products as
select *
from public.products
where is_active = true
  and current_stock <= min_stock;

create view public.stock_card as
select
  sm.id,
  sm.store_id,
  sm.product_id,
  p.sku,
  p.name as product_name,
  sm.type,
  sm.quantity_delta,
  sm.stock_after,
  sm.sale_id,
  sm.purchase_id,
  sm.reason,
  sm.created_by,
  sm.created_at
from public.stock_movements sm
join public.products p on p.id = sm.product_id;

grant select on public.daily_sales_summary to authenticated;
grant select on public.gross_profit_summary to authenticated;
grant select on public.product_profitability to authenticated;
grant select on public.customer_purchase_summary to authenticated;
grant select on public.supplier_purchase_summary to authenticated;
grant select on public.low_stock_products to authenticated;
grant select on public.stock_card to authenticated;

notify pgrst, 'reload schema';
