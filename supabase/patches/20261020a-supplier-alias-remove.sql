-- =============================================================================
-- 20261020a — quitar un alias aprendido de facturas desde el detalle del
--             proveedor (SCN-09b; plan factura-escaneo §5.3 SCN-09, §4
--             supplier_product_aliases, caso 6.10)
-- Proyecto: BodegaHub
-- Requiere: 20261019b-supplier-product-aliases (tabla, RLS de solo lectura) y
--           20261006a (assert_store_context: perfil activo -> tienda).
--
-- remove_supplier_product_alias(p_alias_id uuid) -> uuid (el id borrado)
--   * security definer, search_path fijo (public), tienda del llamador =
--     assert_store_context() (current_user_store_id() con perfil activo; 42501
--     sin perfil activo), igual que las RPC hermanas de 20261019b.
--   * Rol: purchases.create = admin | almacen (espejo de la matriz de
--     @bodega/core/permissions, como learn_invoice_aliases). Otro rol ->
--     PT403 'No autorizado para quitar alias de facturas'.
--   * Borra la fila solo si es de la tienda del llamador. Alias de otra tienda o
--     inexistente -> PT404 'Alias no encontrado' (el BFF lo mapea a 404; no se
--     distingue ajeno de inexistente para no filtrar ids de otras tiendas).
--   * Execute: revoke public / anon; grant authenticated / service_role.
--
-- Por qué RPC con la sesión del usuario y no BFF con service role (patrón de
-- 20261019g / 20261019i): aquellas RPC se cerraron a service_role porque
-- escribían cuota y lecturas del modelo que el usuario no debe poder inventar
-- (C1/C2/C3 de caos-3). Quitar un alias es una acción que el rol ya puede hacer
-- desde la UI, no toca cuota, stock ni dinero, y la tienda sale del JWT dentro
-- de la RPC; es el mismo patrón que learn_invoice_aliases (authenticated).
-- authenticated sigue sin delete directo sobre la tabla (19b): solo esta RPC.
--
-- Idempotente: create or replace + revoke/grant; se puede aplicar varias veces.
-- No toca stock ni dinero.
-- =============================================================================

begin;

create or replace function public.remove_supplier_product_alias(p_alias_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_id uuid;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para quitar alias de facturas';
  end if;

  delete from public.supplier_product_aliases a
  where a.id = p_alias_id
    and a.store_id = v_store_id
  returning a.id into v_id;

  if v_id is null then
    raise exception using errcode = 'PT404', message = 'Alias no encontrado';
  end if;

  return v_id;
end;
$$;

comment on function public.remove_supplier_product_alias(uuid) is
  'Quita un alias aprendido de facturas de la tienda del llamador (admin | almacen). PT404 si es ajeno o no existe (SCN-09b).';

revoke all on function public.remove_supplier_product_alias(uuid) from public, anon;
grant execute on function public.remove_supplier_product_alias(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
