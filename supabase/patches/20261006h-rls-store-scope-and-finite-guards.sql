-- =============================================================================
-- 20261006h — RLS por tienda, caja / baul solo por RPC y guardas de NaN (STK-615)
-- Proyecto: BodegaHub (plan stock-integrity, fase 6, reparacion tras la pasada 1)
-- Requiere: 20261006a, b, c, e, f y g; 20260716-multi-store.sql;
--           20260811b-cash-registers-vault.sql; 20260812c-vault-efectivo-vs-cuenta.sql;
--           20260904b-cash-lifecycle.sql
-- Origen: .notes/stock-integrity-gtm/qa/pass-1/13-rpc-review.txt (N1, N2, N3, N4,
--         N6 y R5 parte c), confirmados en 12-own-b-rpc-review*.log.
--
--   N1   sale_items, purchase_items, product_price_history,
--        supplier_product_price_history y supplier_product_pack_units se leian
--        desde cualquier tienda (politicas SELECT "using (true)" anteriores a
--        multitienda). Ninguna tiene store_id: la lectura pasa a exigir que el
--        padre (sales, purchases, products, supplier_products) sea de la tienda
--        del usuario, igual que las politicas vigentes de esas tablas.
--   N2   supplier_product_pack_units (for all) y el INSERT de los dos historiales
--        solo miraban el rol: un admin / almacen de otra tienda escribia empaques
--        e historial ajenos. Mismo filtro de tienda en using y with check. El BFF
--        escribe los empaques con la sesion del usuario
--        (supplierProducts.server.ts) y sigue funcionando para su tienda.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. N1 — lectura por tienda en las tablas hijas sin store_id.
--    El exists busca al padre por su clave primaria y las columnas sale_id,
--    purchase_id, product_id y supplier_product_id ya estan indexadas
--    (idx_sale_items_sale_id, idx_purchase_items_purchase_id,
--    idx_product_price_history_product_id,
--    idx_supplier_product_price_history_sp_created,
--    idx_supplier_product_pack_units_sp_id): no hace falta ningun indice nuevo.
-- -----------------------------------------------------------------------------

drop policy if exists "Authenticated users read sale items" on public.sale_items;
create policy "Authenticated users read sale items"
on public.sale_items for select
to authenticated
using (
  exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and s.store_id = public.current_user_store_id()
  )
);

drop policy if exists "Authenticated users read purchase items" on public.purchase_items;
create policy "Authenticated users read purchase items"
on public.purchase_items for select
to authenticated
using (
  exists (
    select 1 from public.purchases pu
    where pu.id = purchase_items.purchase_id
      and pu.store_id = public.current_user_store_id()
  )
);

drop policy if exists "Authenticated users read price history" on public.product_price_history;
create policy "Authenticated users read price history"
on public.product_price_history for select
to authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = product_price_history.product_id
      and p.store_id = public.current_user_store_id()
  )
);

drop policy if exists "Authenticated users read supplier product price history" on public.supplier_product_price_history;
create policy "Authenticated users read supplier product price history"
on public.supplier_product_price_history for select
to authenticated
using (
  exists (
    select 1 from public.supplier_products sp
    where sp.id = supplier_product_price_history.supplier_product_id
      and sp.store_id = public.current_user_store_id()
  )
);

drop policy if exists "Authenticated users read supplier product pack units" on public.supplier_product_pack_units;
create policy "Authenticated users read supplier product pack units"
on public.supplier_product_pack_units for select
to authenticated
using (
  exists (
    select 1 from public.supplier_products sp
    where sp.id = supplier_product_pack_units.supplier_product_id
      and sp.store_id = public.current_user_store_id()
  )
);

-- -----------------------------------------------------------------------------
-- 2. N2 — escritura por tienda (mismo rol de antes: admin / almacen).
-- -----------------------------------------------------------------------------

drop policy if exists "Admins and warehouse manage supplier product pack units" on public.supplier_product_pack_units;
create policy "Admins and warehouse manage supplier product pack units"
on public.supplier_product_pack_units for all
to authenticated
using (
  public.current_user_role() in ('admin', 'almacen')
  and exists (
    select 1 from public.supplier_products sp
    where sp.id = supplier_product_pack_units.supplier_product_id
      and sp.store_id = public.current_user_store_id()
  )
)
with check (
  public.current_user_role() in ('admin', 'almacen')
  and exists (
    select 1 from public.supplier_products sp
    where sp.id = supplier_product_pack_units.supplier_product_id
      and sp.store_id = public.current_user_store_id()
  )
);

drop policy if exists "Admins and warehouse insert price history" on public.product_price_history;
create policy "Admins and warehouse insert price history"
on public.product_price_history for insert
to authenticated
with check (
  public.current_user_role() in ('admin', 'almacen')
  and exists (
    select 1 from public.products p
    where p.id = product_price_history.product_id
      and p.store_id = public.current_user_store_id()
  )
);

drop policy if exists "Admins and warehouse insert supplier product price history" on public.supplier_product_price_history;
create policy "Admins and warehouse insert supplier product price history"
on public.supplier_product_price_history for insert
to authenticated
with check (
  public.current_user_role() in ('admin', 'almacen')
  and exists (
    select 1 from public.supplier_products sp
    where sp.id = supplier_product_price_history.supplier_product_id
      and sp.store_id = public.current_user_store_id()
  )
);

commit;

notify pgrst, 'reload schema';
