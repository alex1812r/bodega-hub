-- =============================================================================
-- 20260813 — RPC add_product_barcode: asignar barcode solo si el producto no tiene
-- Permite a vendedor (cajero) completar codigo sin editar el resto del producto.
-- Idempotente.
-- =============================================================================

create or replace function public.add_product_barcode(
  p_product_id uuid,
  p_barcode text
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_barcode text;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen', 'vendedor') then
    raise exception 'No autorizado para agregar codigo de barras';
  end if;

  v_barcode := nullif(trim(p_barcode), '');
  if v_barcode is null then
    raise exception 'El codigo de barras es obligatorio';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  if v_product.barcode is not null and length(trim(v_product.barcode)) > 0 then
    raise exception 'El producto ya tiene codigo de barras; no se puede modificar desde esta accion';
  end if;

  if exists (
    select 1
    from public.products p
    where p.store_id = v_store_id
      and p.id <> p_product_id
      and p.barcode = v_barcode
  ) then
    raise exception 'Ya existe un producto con este codigo de barras';
  end if;

  update public.products
  set barcode = v_barcode,
      updated_at = now()
  where id = p_product_id
  returning * into v_product;

  return v_product;
end;
$$;

revoke all on function public.add_product_barcode(uuid, text) from public;
grant execute on function public.add_product_barcode(uuid, text) to authenticated;

notify pgrst, 'reload schema';
