-- =============================================================================
-- 20260813h — Fix adjust_stock: incluir store_id en stock_movements
--
-- Error: null value in column "store_id" of relation "stock_movements"
-- La firma usada por la app (p_reason, p_type) no setaba store_id tras multi-store.
-- Idempotente: replace + drop overload antigua (p_movement_type, p_reason).
-- =============================================================================

drop function if exists public.adjust_stock(uuid, integer, public.stock_movement_type, text);
drop function if exists public.adjust_stock(uuid, integer, text, public.stock_movement_type);

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text default null,
  p_type public.stock_movement_type default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_new_stock integer;
  v_type public.stock_movement_type;
  v_movement public.stock_movements;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para ajustar stock';
  end if;

  if p_quantity_delta = 0 then
    raise exception 'El ajuste de stock no puede ser cero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Producto no encontrado';
  end if;

  v_new_stock := v_product.current_stock + p_quantity_delta;

  if v_new_stock < 0 then
    raise exception 'Stock insuficiente';
  end if;

  v_type := coalesce(
    p_type,
    case
      when p_quantity_delta > 0 then 'ajuste_entrada'::public.stock_movement_type
      else 'ajuste_salida'::public.stock_movement_type
    end
  );

  if v_type in ('venta', 'compra', 'conversion_entrada', 'conversion_salida') then
    raise exception 'Use create_sale, create_purchase o convert_pack_to_units para este tipo de movimiento';
  end if;

  if v_type in ('ajuste_salida', 'devolucion_proveedor') and p_quantity_delta > 0 then
    raise exception 'ajuste_salida / devolucion_proveedor requiere quantity_delta negativo';
  end if;

  if v_type in ('ajuste_entrada', 'devolucion_cliente', 'inventario_inicial')
     and p_quantity_delta < 0 then
    raise exception 'Este tipo de ajuste requiere quantity_delta positivo';
  end if;

  update public.products
  set current_stock = v_new_stock,
      updated_at = now()
  where id = p_product_id;

  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    stock_after,
    reason,
    created_by,
    store_id
  )
  values (
    p_product_id,
    v_type,
    p_quantity_delta,
    v_new_stock,
    p_reason,
    auth.uid(),
    v_store_id
  )
  returning * into v_movement;

  return v_movement;
end;
$$;

grant execute on function public.adjust_stock(uuid, integer, text, public.stock_movement_type)
  to authenticated;

notify pgrst, 'reload schema';
