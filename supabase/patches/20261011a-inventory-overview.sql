-- =============================================================================
-- 20261011a — vista unica de stock (INV-01a; plan ux-mejoras §4.6)
-- Proyecto: BodegaHub
-- Requiere: 20260716 (store_id en products y stock_movements), 20261006a
--           (stock_movements.seq) y 20261006h (RLS por tienda).
--
-- public.inventory_overview: una fila por producto de public.products (activos
-- e inactivos; el BFF filtra is_active) con lo que lee GET /api/inventory:
--
--   * las columnas del listado: id, store_id, category_id, sku, barcode, name,
--     sale_price_ref, current_cost_ref, current_stock, min_stock, image_url,
--     is_active;
--   * entries_30d        suma de los quantity_delta positivos del producto con
--                        created_at >= now() - 30 dias (ventana movil de 30 x
--                        24 h, no dias de calendario); 0 sin movimientos;
--   * exits_30d          suma de |quantity_delta| de los negativos en la misma
--                        ventana; 0 sin movimientos;
--   * last_movement_at / last_movement_type
--                        created_at y type del movimiento de mayor seq del
--                        producto (el orden real del libro, 20261006a); null si
--                        el producto no tiene movimientos;
--   * stock_status       'out' si current_stock = 0; 'low' si current_stock <=
--                        min_stock; 'ok' en otro caso. Es la regla de
--                        getInventoryStockStatus (inventoryStockStatus.ts), en
--                        ese orden, para filtrar y paginar en el servidor.
--
-- Las cifras del libro son subconsultas escalares y no joins: el conteo y los
-- filtros (todos sobre columnas de products) no tocan stock_movements, y con
-- order by + limit solo se calculan para las filas de la pagina.
--
-- security_invoker: aplican las RLS de products y stock_movements del que
-- consulta (otra tienda no ve filas). Select solo para authenticated y
-- service_role, como las vistas de integridad (20261006d).
--
-- Indice idx_stock_movements_product_seq (product_id, seq desc): "ultimo
-- movimiento del producto" en una lectura de indice. La ventana de 30 dias usa
-- idx_stock_movements_product_created_at (product_id, created_at desc), que ya
-- existe (schema base).
--
-- Solo lectura: no toca stock, dinero, politicas ni RPC. Idempotente, una
-- transaccion.
-- =============================================================================

begin;

create index if not exists idx_stock_movements_product_seq
  on public.stock_movements (product_id, seq desc);

create or replace view public.inventory_overview
with (security_invoker = true) as
select
  p.id,
  p.store_id,
  p.category_id,
  p.sku,
  p.barcode,
  p.name,
  p.sale_price_ref,
  p.current_cost_ref,
  p.current_stock,
  p.min_stock,
  p.image_url,
  p.is_active,
  coalesce((
    select sum(m.quantity_delta)
    from public.stock_movements m
    where m.product_id = p.id
      and m.quantity_delta > 0
      and m.created_at >= now() - interval '30 days'
  ), 0)::integer as entries_30d,
  coalesce((
    select sum(-m.quantity_delta)
    from public.stock_movements m
    where m.product_id = p.id
      and m.quantity_delta < 0
      and m.created_at >= now() - interval '30 days'
  ), 0)::integer as exits_30d,
  (
    select m.created_at
    from public.stock_movements m
    where m.product_id = p.id
    order by m.seq desc
    limit 1
  ) as last_movement_at,
  (
    select m.type
    from public.stock_movements m
    where m.product_id = p.id
    order by m.seq desc
    limit 1
  ) as last_movement_type,
  case
    when p.current_stock = 0 then 'out'
    when p.current_stock <= p.min_stock then 'low'
    else 'ok'
  end as stock_status
from public.products p
;

comment on view public.inventory_overview is
  'Vista unica de stock (INV-01): producto + entradas / salidas de 30 dias, ultimo movimiento (mayor seq) y stock_status.';

revoke all on public.inventory_overview from public, anon, authenticated, service_role;
grant select on public.inventory_overview to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
