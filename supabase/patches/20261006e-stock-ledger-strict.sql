-- =============================================================================
-- 20261006e — Libro mayor de stock en modo estricto
-- Proyecto: BodegaHub (plan stock-integrity, fase 5, STK-505)
--
-- Cierra los dos pases TRANSITORIOS que el parche 20261006a dejo abiertos
-- mientras las RPC de stock se reescribian (parches b y c):
--
--   1. stock_movements_apply() ya no tiene modo legado: IGNORA el stock_after
--      que traiga quien inserta y siempre calcula saldo = stock actual + delta,
--      rechaza el saldo negativo y actualiza el producto (exactamente 1 fila).
--      Es la UNICA funcion de public que escribe el stock de products.
--   2. products_stock_guard() ya no deja pasar a las funciones security definer
--      (current_user = 'postgres'). El stock de products solo cambia:
--        * desde stock_movements_apply() (GUC app.stock_writer = '1'), o
--        * en una conexion directa a la base (session_user postgres o
--          supabase_admin: migraciones, one-shots, preparacion de tests).
--      Por PostgREST session_user es "authenticator": admin, almacen,
--      service_role y cualquier RPC quedan fuera.
--
-- OJO para one-shots y scripts por conexion directa: insertar un movimiento YA
-- mueve el stock del producto. No acompanarlo de un update manual del stock (lo
-- duplicaria) y no esperar que se respete un stock_after escrito a mano.
--
-- Requiere 20261006a, b y c (todas las RPC insertan ya con stock_after NULL).
-- Reaplicar 20261006a reinstala el modo legado: aplicar siempre este parche
-- despues. Idempotente, una sola transaccion.
-- =============================================================================

begin;

-- El update de products va en el BEFORE (no en un AFTER) a proposito: los AFTER
-- ROW se disparan al final de la sentencia y un "insert ... select" con dos
-- filas del mismo producto romperia la cadena.
create or replace function public.stock_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_stock integer;
  v_store_id uuid;
  v_rows integer;
begin
  select p.current_stock, p.store_id
  into v_current_stock, v_store_id
  from public.products p
  where p.id = new.product_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  if new.store_id is null then
    new.store_id := v_store_id;
  elsif new.store_id <> v_store_id then
    raise exception using
      errcode = 'PT409',
      message = 'El movimiento de stock no corresponde a la tienda del producto';
  end if;

  -- Despues del lock: el orden por seq es el orden real de la cadena del producto.
  new.seq := nextval('public.stock_movements_seq');

  -- El saldo lo fija siempre el libro; el valor que envie quien inserta se descarta.
  new.stock_after := v_current_stock + new.quantity_delta;

  if new.stock_after < 0 then
    raise exception using errcode = 'PT409', message = 'Stock insuficiente';
  end if;

  perform set_config('app.stock_writer', '1', true);

  update public.products
  set current_stock = new.stock_after
  where id = new.product_id;

  get diagnostics v_rows = row_count;
  perform set_config('app.stock_writer', '', true);

  if v_rows <> 1 then
    raise exception using
      errcode = 'PT409',
      message = 'No se pudo actualizar el stock del producto';
  end if;

  return new;
end;
$$;

create or replace function public.products_stock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Migraciones, one-shots y preparacion de tests: conexion directa a la base.
  -- Por PostgREST session_user es "authenticator" (admin, almacen y service_role quedan fuera).
  if session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception using
      errcode = 'PT400',
      message = 'El stock inicial se registra con un movimiento inventario_inicial';
  end if;

  -- Escritura hecha por stock_movements_apply().
  if coalesce(current_setting('app.stock_writer', true), '') = '1' then
    return new;
  end if;

  raise exception using
    errcode = 'PT409',
    message = 'El stock solo se modifica registrando un movimiento de inventario';
end;
$$;

-- Los triggers se disparan sin privilegio de EXECUTE; nadie debe llamarlos a mano.
revoke all on function public.stock_movements_apply() from public, anon, authenticated;
revoke all on function public.products_stock_guard() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
