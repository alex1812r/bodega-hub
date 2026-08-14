-- =============================================================================
-- 20260813c — One-shot: backfill products.current_cost_ref con IVA de la
-- ultima compra recibida (unit_cost_ref * (1 + tax_rate/100)).
-- Tambien alinea supplier_products.last_cost_* con la ultima compra de ese
-- proveedor+producto.
--
-- Idempotente: re-ejecutar deja los mismos montos.
-- Requiere: purchase_items.tax_rate (20260810b) y compras en status 'recibido'.
-- Uso: Supabase Dashboard → SQL Editor → Run.
-- =============================================================================

do $$
declare
  v_products_updated integer := 0;
  v_supplier_updated integer := 0;
begin
  -- 1) Producto: costo = ultima linea de compra recibida (cualquier proveedor)
  with last_line as (
    select distinct on (pi.product_id)
      pi.product_id,
      p.store_id,
      pi.unit_cost_ref,
      pi.tax_rate
    from public.purchase_items pi
    inner join public.purchases p on p.id = pi.purchase_id
    where p.status = 'recibido'
    order by
      pi.product_id,
      p.created_at desc,
      pi.id desc
  ),
  computed as (
    select
      product_id,
      store_id,
      round(
        coalesce(unit_cost_ref, 0) * (1 + coalesce(tax_rate, 0) / 100.0),
        2
      ) as cost_with_tax_ref
    from last_line
  ),
  updated as (
    update public.products pr
    set current_cost_ref = c.cost_with_tax_ref,
        updated_at = now()
    from computed c
    where pr.id = c.product_id
      and pr.store_id = c.store_id
      and pr.current_cost_ref is distinct from c.cost_with_tax_ref
    returning pr.id
  )
  select count(*) into v_products_updated from updated;

  -- 2) Relacion proveedor-producto: ultima compra de ESE proveedor
  with last_line as (
    select distinct on (pi.product_id, p.supplier_id)
      pi.product_id,
      p.supplier_id,
      p.store_id,
      pi.unit_cost_ref,
      pi.unit_cost_ves,
      pi.tax_rate
    from public.purchase_items pi
    inner join public.purchases p on p.id = pi.purchase_id
    where p.status = 'recibido'
    order by
      pi.product_id,
      p.supplier_id,
      p.created_at desc,
      pi.id desc
  ),
  computed as (
    select
      product_id,
      supplier_id,
      store_id,
      round(
        coalesce(unit_cost_ref, 0) * (1 + coalesce(tax_rate, 0) / 100.0),
        2
      ) as cost_with_tax_ref,
      round(
        coalesce(unit_cost_ves, 0) * (1 + coalesce(tax_rate, 0) / 100.0),
        2
      ) as cost_with_tax_ves
    from last_line
  ),
  updated as (
    update public.supplier_products sp
    set last_cost_ref = c.cost_with_tax_ref,
        last_cost_ves = c.cost_with_tax_ves,
        updated_at = now()
    from computed c
    where sp.product_id = c.product_id
      and sp.supplier_id = c.supplier_id
      and sp.store_id = c.store_id
      and (
        sp.last_cost_ref is distinct from c.cost_with_tax_ref
        or sp.last_cost_ves is distinct from c.cost_with_tax_ves
      )
    returning sp.id
  )
  select count(*) into v_supplier_updated from updated;

  raise notice
    'Backfill costo c/IVA: products actualizados=%, supplier_products actualizados=%',
    v_products_updated,
    v_supplier_updated;
end;
$$;

-- Vista rapida de verificacion (descomentar y ejecutar aparte si quieres revisar):
-- select
--   pr.sku,
--   pr.name,
--   pr.current_cost_ref as cost_guardado,
--   round(last_buy.unit_cost_ref * (1 + coalesce(last_buy.tax_rate, 0) / 100.0), 2) as cost_esperado,
--   last_buy.unit_cost_ref,
--   last_buy.tax_rate,
--   last_buy.purchase_number,
--   last_buy.created_at
-- from public.products pr
-- inner join lateral (
--   select
--     pi.unit_cost_ref,
--     pi.tax_rate,
--     p.purchase_number,
--     p.created_at
--   from public.purchase_items pi
--   join public.purchases p on p.id = pi.purchase_id
--   where pi.product_id = pr.id
--     and p.status = 'recibido'
--   order by p.created_at desc, pi.id desc
--   limit 1
-- ) last_buy on true
-- order by pr.sku;
