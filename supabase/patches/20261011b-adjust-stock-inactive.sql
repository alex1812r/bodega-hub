-- =============================================================================
-- 20261011b — adjust_stock no acepta entradas libres a un producto inactivo
--             (COM-15a; plan ux-mejoras §0b: "producto inactivo acepta compras y
--             ajustes", parte de AJUSTES)
-- Proyecto: BodegaHub
-- Requiere: 20261006a, b, c, e, f y g (adjust_stock vigente: 20261006g).
--
-- Redefine completa adjust_stock, copia literal de 20261006g con UN cambio. La
-- firma de 7 argumentos no cambia y sigue habiendo una sola.
--
-- Regla nueva (decision del supervisor de Inventario, 2026-10-08). Sobre un
-- producto INACTIVO (products.is_active = false):
--
--   * delta > 0 sin venta ligada (ajuste_entrada, inventario_inicial y el tipo
--     por defecto de un delta positivo)  ->  PT409 "El producto esta inactivo:
--     reactivalo antes de registrar una entrada de stock". Sin efectos: ni
--     movimiento, ni stock, ni clave de idempotencia consumida (la excepcion
--     deshace la transaccion; reintentar con la misma clave tras reactivar el
--     producto registra el ajuste).
--   * delta < 0 (ajuste_salida: merma, salida, correccion a la baja)  ->  SE
--     PERMITE. Es lo conservador: un producto dado de baja que aun tiene stock
--     debe poder dejarse en cero.
--   * Devoluciones LIGADAS a su documento  ->  NO cambian. devolucion_cliente
--     con p_sale_id es una entrada (delta > 0) y sigue entrando aunque el
--     producto ya este inactivo: la mercancia vuelve por la venta, con su tope
--     "vendido - ya devuelto". devolucion_proveedor con p_purchase_id es una
--     salida. Por eso la guarda lleva "p_sale_id is null" (a esa altura
--     p_sale_id solo puede acompanar a devolucion_cliente, y devolucion_cliente
--     no existe sin p_sale_id: R4).
--
-- Donde va la guarda: justo despues de bloquear el producto y comprobar que
-- existe en la tienda (hace falta la fila bloqueada para leer is_active). Todo
-- lo anterior conserva su precedencia: PT403 de rol, reintento con clave (un
-- ajuste registrado cuando el producto estaba activo se sigue devolviendo tal
-- cual aunque despues se desactive), PT400 de forma, PT404 / PT409 del
-- documento y PT404 del producto.
--
-- Todo lo demas queda IDENTICO (regla 9 del plan: no cambia la semantica de
-- stock): orden de bloqueo documento -> producto, movimiento con stock_after
-- NULL (lo fija stock_movements_apply), idempotencia y huella del contenido,
-- permisos y mensajes. Sobre un producto activo la funcion se comporta igual
-- que la de 20261006g (test diferencial en
-- scripts/stock-lab/regression/adjust-inactive.test.ts).
--
-- NO toca create_purchase ni receive_purchase: que un producto inactivo acepte
-- compras sigue abierto y es del modulo Compras.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- Reaplicar 20261006c o 20261006g reinstala la version anterior de
-- adjust_stock (sin esta guarda): volver a aplicar este parche despues.
-- NO aplicado a produccion.
-- =============================================================================

begin;

create or replace function public.adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reason text default null,
  p_type public.stock_movement_type default null,
  p_client_request_id uuid default null,
  p_sale_id uuid default null,
  p_purchase_id uuid default null
)
returns public.stock_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_type public.stock_movement_type;
  v_movement public.stock_movements;
  v_sale public.sales;
  v_purchase public.purchases;
  v_document_quantity integer;
  v_already_returned integer;
  v_request_hash text;
  v_replay jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para ajustar stock';
  end if;

  -- C6 — reintento del mismo ajuste: se devuelve el movimiento original.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('stock-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'adjust_stock', p_product_id, p_quantity_delta, p_reason, p_type, p_sale_id, p_purchase_id
    ));
    v_replay := public.stock_request_replay(v_store_id, p_client_request_id, 'adjust_stock', v_request_hash);

    if v_replay is not null then
      v_movement := jsonb_populate_record(null::public.stock_movements, v_replay);
      return v_movement;
    end if;
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception using errcode = 'PT400', message = 'El ajuste de stock no puede ser cero';
  end if;

  v_type := coalesce(
    p_type,
    case
      when p_quantity_delta > 0 then 'ajuste_entrada'::public.stock_movement_type
      else 'ajuste_salida'::public.stock_movement_type
    end
  );

  if v_type in ('venta', 'compra', 'conversion_entrada', 'conversion_salida') then
    raise exception using
      errcode = 'PT400',
      message = 'Use create_sale, create_purchase o convert_pack_to_units para este tipo de movimiento';
  end if;

  if v_type in ('ajuste_salida', 'devolucion_proveedor') and p_quantity_delta > 0 then
    raise exception using
      errcode = 'PT400',
      message = 'ajuste_salida / devolucion_proveedor requiere quantity_delta negativo';
  end if;

  if v_type in ('ajuste_entrada', 'devolucion_cliente', 'inventario_inicial')
     and p_quantity_delta < 0 then
    raise exception using errcode = 'PT400', message = 'Este tipo de ajuste requiere quantity_delta positivo';
  end if;

  -- C15 — el documento solo acompana a su devolucion.
  if p_sale_id is not null and v_type <> 'devolucion_cliente' then
    raise exception using
      errcode = 'PT400',
      message = 'Solo una devolucion de cliente puede ligarse a una venta';
  end if;

  if p_purchase_id is not null and v_type <> 'devolucion_proveedor' then
    raise exception using
      errcode = 'PT400',
      message = 'Solo una devolucion a proveedor puede ligarse a una compra';
  end if;

  -- R4 — y la devolucion no existe sin su documento: sin el no hay tope (vendido /
  -- recibido menos ya devuelto) y return_sale / return_purchase no la descuentan,
  -- asi que las unidades se duplicaban con la reconciliacion en 0. La devolucion
  -- suelta deja de existir como ajuste libre.
  if v_type = 'devolucion_cliente' and p_sale_id is null then
    raise exception using
      errcode = 'PT400',
      message = 'Una devolucion de cliente debe indicar la venta a la que corresponde';
  end if;

  if v_type = 'devolucion_proveedor' and p_purchase_id is null then
    raise exception using
      errcode = 'PT400',
      message = 'Una devolucion a proveedor debe indicar la compra a la que corresponde';
  end if;

  -- Orden de bloqueo: documento -> producto.
  if p_sale_id is not null then
    select * into v_sale
    from public.sales
    where id = p_sale_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using errcode = 'PT404', message = 'Venta no encontrada';
    end if;

    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception using errcode = 'PT409', message = 'La venta ya fue cancelada o devuelta';
    end if;

    if v_sale.status not in ('pagada', 'pendiente_pago') then
      raise exception using
        errcode = 'PT409',
        message = 'Solo se pueden devolver ventas pagadas o pendientes de pago';
    end if;
  end if;

  if p_purchase_id is not null then
    select * into v_purchase
    from public.purchases
    where id = p_purchase_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using errcode = 'PT404', message = 'Compra no encontrada';
    end if;

    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception using errcode = 'PT409', message = 'La compra ya fue cancelada o devuelta';
    end if;

    if v_purchase.status <> 'recibido' then
      raise exception using errcode = 'PT409', message = 'Solo se pueden devolver compras recibidas';
    end if;
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- COM-15a — un producto inactivo no recibe entradas libres: hay que reactivarlo
  -- antes. Las salidas (delta < 0) si pasan, para poder dejarlo en cero, y la
  -- devolucion de cliente ligada a su venta tambien (entra por el documento).
  if not v_product.is_active and p_quantity_delta > 0 and p_sale_id is null then
    raise exception using
      errcode = 'PT409',
      message = 'El producto esta inactivo: reactivalo antes de registrar una entrada de stock';
  end if;

  -- C15 — tope: lo vendido (o recibido) de ese producto en el documento menos
  -- lo ya devuelto con movimientos ligados a el.
  if p_sale_id is not null then
    select coalesce(sum(quantity), 0)::integer
    into v_document_quantity
    from public.sale_items
    where sale_id = p_sale_id
      and product_id = p_product_id;

    if v_document_quantity = 0 then
      raise exception using errcode = 'PT400', message = 'El producto no pertenece a la venta indicada';
    end if;

    select coalesce(sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where sale_id = p_sale_id
      and product_id = p_product_id
      and type = 'devolucion_cliente';

    if p_quantity_delta > v_document_quantity - v_already_returned then
      raise exception using
        errcode = 'PT409',
        message = format(
          'La devolucion supera lo vendido en la venta %s: vendido %s, ya devuelto %s',
          v_sale.invoice_number, v_document_quantity, v_already_returned
        );
    end if;
  end if;

  if p_purchase_id is not null then
    select coalesce(sum(quantity), 0)::integer
    into v_document_quantity
    from public.purchase_items
    where purchase_id = p_purchase_id
      and product_id = p_product_id;

    if v_document_quantity = 0 then
      raise exception using errcode = 'PT400', message = 'El producto no pertenece a la compra indicada';
    end if;

    select coalesce(-sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where purchase_id = p_purchase_id
      and product_id = p_product_id
      and type = 'devolucion_proveedor';

    if -p_quantity_delta > v_document_quantity - v_already_returned then
      raise exception using
        errcode = 'PT409',
        message = format(
          'La devolucion supera lo recibido en la compra %s: recibido %s, ya devuelto %s',
          v_purchase.purchase_number, v_document_quantity, v_already_returned
        );
    end if;
  end if;

  if v_product.current_stock + p_quantity_delta < 0 then
    raise exception using errcode = 'PT409', message = 'Stock insuficiente';
  end if;

  -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
  -- actualiza el stock del producto.
  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    sale_id,
    purchase_id,
    reason,
    created_by,
    store_id
  )
  values (
    p_product_id,
    v_type,
    p_quantity_delta,
    p_sale_id,
    p_purchase_id,
    p_reason,
    auth.uid(),
    v_store_id
  )
  returning * into v_movement;

  if p_client_request_id is not null then
    insert into public.stock_request_keys (
      store_id, client_request_id, operation, request_hash, user_id, result
    )
    values (
      v_store_id, p_client_request_id, 'adjust_stock', v_request_hash, auth.uid(), to_jsonb(v_movement)
    );
  end if;

  return v_movement;
end;
$$;

revoke all on function public.adjust_stock(
  uuid, integer, text, public.stock_movement_type, uuid, uuid, uuid
) from public, anon;
grant execute on function public.adjust_stock(
  uuid, integer, text, public.stock_movement_type, uuid, uuid, uuid
) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
