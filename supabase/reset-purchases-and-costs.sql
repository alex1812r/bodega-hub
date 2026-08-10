-- =============================================================================
-- Limpieza: compras + historial/costos de precio (conserva productos y contactos)
-- Uso: Supabase Dashboard → SQL Editor → Run
-- NO usar en produccion sin backup.
-- =============================================================================
-- Borra:
--   - pagos asociados a compras
--   - movimientos de stock de compras (y revierte stock)
--   - purchase_items / purchases
--   - supplier_product_price_history
--   - product_price_history (precios de venta)
-- Resetea a 0:
--   - products.current_cost_ref
--   - supplier_products.last_cost_ref / last_cost_ves / last_pack_cost_ref
-- Deja:
--   - 1 fila inicial de historial por cada supplier_product (costo 0)
-- Conserva:
--   - products, contacts, categories, users/profiles, sales, exchange_rates, etc.
-- =============================================================================

begin;

-- 1) Revertir stock aportado por compras antes de borrar movimientos
update public.products p
set
  current_stock = greatest(
    0,
    p.current_stock - coalesce((
      select sum(sm.quantity_delta)::integer
      from public.stock_movements sm
      where sm.product_id = p.id
        and sm.purchase_id is not null
    ), 0)
  ),
  updated_at = now();

-- 2) Pagos ligados a compras
delete from public.payments
where purchase_id is not null;

-- 3) Movimientos de inventario de compras
delete from public.stock_movements
where purchase_id is not null;

-- 4) Compras (items primero por FK; cascade tambien cubre, pero explicito es mas claro)
delete from public.purchase_items;
delete from public.purchases;

-- 5) Historiales de precio
truncate table public.supplier_product_price_history restart identity cascade;
truncate table public.product_price_history restart identity cascade;

-- 6) Costos actuales a 0
update public.products
set
  current_cost_ref = 0,
  updated_at = now();

update public.supplier_products
set
  last_cost_ref = 0,
  last_cost_ves = 0,
  last_pack_cost_ref = 0,
  last_purchased_at = null,
  updated_at = now();

-- 7) Historial inicial (baseline en 0) por cada relacion proveedor-producto
insert into public.supplier_product_price_history (
  supplier_product_id,
  old_cost_ref,
  new_cost_ref,
  old_cost_ves,
  new_cost_ves,
  origin,
  notes
)
select
  sp.id,
  null,
  0,
  null,
  0,
  'ajuste',
  'Reset inicial de costos (limpieza post-errores de compra)'
from public.supplier_products sp;

commit;

-- Verificacion rapida (opcional)
-- select count(*) as purchases from public.purchases;
-- select count(*) as purchase_items from public.purchase_items;
-- select count(*) as purchase_payments from public.payments where purchase_id is not null;
-- select count(*) as purchase_movements from public.stock_movements where purchase_id is not null;
-- select count(*) as price_history from public.supplier_product_price_history;
-- select count(*) as products_nonzero_cost from public.products where current_cost_ref <> 0;
-- select count(*) as sp_nonzero_cost from public.supplier_products where coalesce(last_cost_ref, 0) <> 0;
