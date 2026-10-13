-- =============================================================================
-- 20261012b — la cola "Por revisar" atribuye a la compra el costo de los
--             componentes de un empaque desarmado en su recepcion (INT-04;
--             plan ux-mejoras, integracion de la Ola 1: Productos x Compras)
-- Proyecto: BodegaHub
-- Requiere: 20261009c (vista products_price_review y price_review(products)) y
--           20261010d (purchase_items.disassembled_conversion_id).
--
-- Fallo: al recibir una compra con "Desarmar al recibir" (20261010d), el costo
-- de cada componente lo fija convert_pack_to_units y el movimiento que deja es
-- una `conversion_entrada` SIN purchase_id. La vista de 20261009c solo miraba
-- movimientos `compra`: los componentes que bajaban de banda entraban en la cola
-- con purchase_id / proveedor nulos y el aviso de reprecio del detalle de ESA
-- compra (que filtra la vista por purchase_id) no los listaba.
--
-- Arreglo (solo lectura): la "compra causante" de un producto pasa a ser la del
-- movimiento mas reciente posterior a su ultima instantanea de precio que sea
--   * una `compra` con purchase_id (como hasta ahora), o
--   * una `conversion_entrada` cuya apertura (stock_movements.conversion_id) es
--     la que una linea de compra guardo al desarmarse en la recepcion
--     (purchase_items.disassembled_conversion_id): la compra de esa linea.
-- Una apertura hecha a mano (sin linea de compra que la apunte) sigue sin
-- atribuirse a ninguna compra. Si despues del desarme llega una compra directa
-- del componente, manda esa (la mas reciente), igual que entre dos compras.
--
-- Mismas columnas, mismos tipos y mismo orden que 20261009c: price_review(products)
-- y el BFF no cambian. security_invoker: la linea de compra y la compra se leen
-- con el RLS de quien consulta, como ya pasaba con purchases.
--
-- Indice parcial en purchase_items(disassembled_conversion_id) para el enlace.
-- El `create index` no es `concurrently`: bloquea las escrituras de
-- purchase_items mientras se construye (tabla pequena; aplicar fuera de hora pico).
--
-- No toca stock, costos, precios, dinero, filas, politicas, grants ni ninguna
-- RPC: no cambia QUE productos estan en la cola, solo a que compra se atribuyen.
-- Idempotente, una sola transaccion. No depende del BFF (el desplegado lee las
-- mismas columnas): puede ir antes o despues.
-- OJO: reaplicar 20261009c reinstala la vista sin este enlace: volver a aplicar
-- este parche despues y correr verify-patches.sql.
-- =============================================================================

begin;

create index if not exists idx_purchase_items_disassembled_conversion
  on public.purchase_items (disassembled_conversion_id)
  where disassembled_conversion_id is not null;

create or replace view public.products_price_review
with (security_invoker = true) as
select
  p.id as product_id,
  p.store_id,
  p.name,
  p.sku,
  p.sale_price_ref,
  s.cost_ref_snapshot as previous_cost_ref,
  p.current_cost_ref,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) as previous_margin_pct,
  p.margin_pct as current_margin_pct,
  s.margin_band_snapshot as previous_band,
  b.current_band,
  public.margin_band_rank(b.current_band) as current_band_rank,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) - p.margin_pct as margin_drop_pct,
  s.created_at as snapshot_at,
  pu.id as purchase_id,
  pu.purchase_number,
  m.created_at as purchase_received_at,
  pu.supplier_id,
  c.name as supplier_name
from public.products p
join lateral (
  select h.cost_ref_snapshot, h.margin_band_snapshot, h.snapshot_seq, h.created_at
  from public.product_price_history h
  where h.product_id = p.id
    and h.snapshot_seq is not null
  order by h.snapshot_seq desc
  limit 1
) s on true
left join public.app_settings a on a.store_id = p.store_id
cross join lateral (
  select public.margin_band_from_thresholds(
    p.margin_pct,
    coalesce(a.margin_yellow_from_pct, 15),
    coalesce(a.margin_green_from_pct, 25)
  ) as current_band
) b
left join lateral (
  -- INT-04: la compra del movimiento, o la de la linea que se desarmo al recibir
  -- y cuya apertura dejo esta `conversion_entrada` en el componente.
  select coalesce(sm.purchase_id, d.purchase_id) as purchase_id, sm.created_at
  from public.stock_movements sm
  left join lateral (
    select pi.purchase_id
    from public.purchase_items pi
    where sm.type = 'conversion_entrada'
      and sm.conversion_id is not null
      and pi.disassembled_conversion_id = sm.conversion_id
    limit 1
  ) d on true
  where sm.product_id = p.id
    and sm.seq > s.snapshot_seq
    and (
      (sm.type = 'compra' and sm.purchase_id is not null)
      or (sm.type = 'conversion_entrada' and d.purchase_id is not null)
    )
  order by sm.seq desc
  limit 1
) m on true
left join public.purchases pu on pu.id = m.purchase_id
left join public.contacts c on c.id = pu.supplier_id
where p.is_active
  and s.cost_ref_snapshot > 0
  and p.current_cost_ref > s.cost_ref_snapshot
  and public.margin_band_rank(b.current_band) < public.margin_band_rank(s.margin_band_snapshot);

comment on view public.products_price_review is
  'Cola "Por revisar": productos activos cuyo costo subio y cuya banda de ganancia es peor que la de su ultima instantanea de precio. La compra es la del movimiento mas reciente que fijo el costo: una compra recibida o el desarme de un empaque en su recepcion.';

-- `create or replace view` conserva los privilegios; se repiten para que el parche
-- sea autosuficiente (Supabase concede ALL por defecto a los roles de PostgREST).
revoke all on public.products_price_review from public, anon, authenticated;
grant select on public.products_price_review to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
