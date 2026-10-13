-- =============================================================================
-- 20261009f — precio calculado y comprobado DENTRO de la base, y clave de
--             idempotencia del alta de producto (PRO-F9; hallazgos de caos
--             ALTA-1, ALTA-2 y M1 del modulo Productos; reglas 9, 10 y 10b)
-- Proyecto: BodegaHub
-- Requiere: 20261006c (stock_request_keys: idempotencia de adjust_stock),
--           20261006h (assert_finite_numeric) y 20261009c (update_product_price
--           con instantanea, keep_product_price y la cola "Por revisar").
--
-- ALTA-1: el reprecio masivo leia el costo en el BFF y despues llamaba a
-- update_product_price con un precio ya calculado. Si entre la lectura y la
-- llamada se recibia una compra, el precio quedaba calculado sobre un costo que
-- ya no existia (por debajo del costo nuevo), la respuesta era de exito y la
-- instantanea nueva sacaba al producto de la cola. M1: "Mantener precio"
-- confirmaba una ganancia que el usuario no habia visto. ALTA-2: reintentar un
-- alta de producto cuya respuesta se perdio creaba un segundo producto con su
-- inventario_inicial.
--
--   1. price_from_markup(costo, pct): precio = costo x (1 + pct / 100) a dos
--      decimales. MISMO redondeo que priceFromMarkup de @bodega/core
--      (packages/core/src/pricing.ts): costo al centimo, % a dos decimales,
--      producto exacto (numeric, sin coma flotante) y medio centimo hacia
--      arriba. Costo <= 0 -> 0. Diferencia conocida: un % con MAS de dos
--      decimales se redondea aqui en decimal exacto (1.005 -> 1.01) y en
--      @bodega/core con Math.round sobre coma flotante (1.005 * 100 =
--      100.4999... -> 1.00). El BFF envia el % ya redondeado con la regla de
--      @bodega/core, asi que por el BFF no hay diferencia.
--   2. assert_expected_cost_ref(costo_actual, costo_esperado): interna. Sin
--      costo esperado no hace nada; si viene y difiere del actual (a dos
--      decimales) -> PT409 'El costo cambió de X a Y; revisa el precio' con
--      hint COST_CHANGED.
--   3. reprice_product_to_markup(p_product_id, p_markup_pct, p_reason,
--      p_expected_cost_ref): bloquea el producto, lee SU costo bajo el bloqueo,
--      calcula el precio y delega en update_product_price (misma transaccion,
--      mismo historial e instantanea). Sin costo -> PT400 (hint NO_COST); % fuera
--      de (0, 1000] o no finito -> PT400; costo esperado distinto -> PT409 sin
--      cambiar nada.
--   4. update_product_price_checked(p_product_id, p_new_sale_price_ref,
--      p_reason, p_expected_cost_ref): precio fijo con la misma comprobacion de
--      costo esperado bajo el bloqueo; delega en update_product_price.
--   5. keep_product_price gana p_expected_cost_ref (al final, default null). Se
--      elimina la firma de dos argumentos para no dejar dos sobrecargas vivas
--      (PGRST203); las llamadas con dos argumentos siguen resolviendo.
--   6. products.client_request_id / client_request_hash + indice unico parcial
--      (store_id, client_request_id). Columnas opcionales: el formulario las
--      envia, la importacion masiva y las RPC que crean productos no. El BFF
--      reconoce el reintento por la violacion de ESE indice y devuelve el
--      producto ya creado; el stock inicial viaja a adjust_stock con una clave
--      derivada de la del producto (idempotencia de 20261006c).
--
-- update_product_price NO cambia (ni firma ni cuerpo): el camino sin costo
-- esperado da el mismo resultado que antes. No toca stock, dinero, politicas ni
-- las RPC de compras. No anade columnas numeric (los triggers de 20261006i no se
-- regeneran). Idempotente, una sola transaccion. Ejecutar en SQL Editor o via
-- db-up ANTES de desplegar el BFF que llama a las RPC nuevas.
-- OJO: reaplicar 20261009c reinstala keep_product_price(uuid, text) y deja dos
-- sobrecargas: volver a aplicar este parche despues.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Precio a partir de un % de ganancia. Mismo redondeo que @bodega/core.
-- -----------------------------------------------------------------------------

create or replace function public.price_from_markup(p_cost_ref numeric, p_markup_pct numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_cost_ref is null or p_markup_pct is null or round(p_cost_ref, 2) <= 0 then 0
    -- Producto exacto en numeric; round() de numeric lleva el medio centimo hacia arriba.
    else greatest(round(round(p_cost_ref, 2) * (10000 + round(p_markup_pct, 2) * 100) * 0.0001, 2), 0)
  end;
$$;

comment on function public.price_from_markup(numeric, numeric) is
  'Precio = costo x (1 + pct / 100) a dos decimales, con el redondeo de priceFromMarkup de @bodega/core (costo al centimo, % a dos decimales, medio centimo hacia arriba).';

revoke all on function public.price_from_markup(numeric, numeric) from public, anon;
grant execute on function public.price_from_markup(numeric, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Costo esperado: lo que el usuario vio al decidir. Interna (no es RPC).
-- -----------------------------------------------------------------------------

create or replace function public.assert_expected_cost_ref(p_current_cost_ref numeric, p_expected_cost_ref numeric)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_expected_cost_ref is null then
    return;
  end if;

  perform public.assert_finite_numeric(p_expected_cost_ref, 'el costo esperado');

  if round(coalesce(p_current_cost_ref, 0), 2) <> round(p_expected_cost_ref, 2) then
    raise exception using
      errcode = 'PT409',
      message = format(
        'El costo cambió de %s a %s; revisa el precio',
        round(p_expected_cost_ref, 2),
        round(coalesce(p_current_cost_ref, 0), 2)
      ),
      hint = 'COST_CHANGED';
  end if;
end;
$$;

revoke all on function public.assert_expected_cost_ref(numeric, numeric) from public, anon, authenticated;
grant execute on function public.assert_expected_cost_ref(numeric, numeric) to service_role;

-- -----------------------------------------------------------------------------
-- 3. reprice_product_to_markup — el precio se calcula con el producto bloqueado.
-- -----------------------------------------------------------------------------

create or replace function public.reprice_product_to_markup(
  p_product_id uuid,
  p_markup_pct numeric,
  p_reason text default null,
  p_expected_cost_ref numeric default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
begin
  v_store_id := public.assert_store_context();
  perform public.assert_finite_numeric(p_markup_pct, 'el % de ganancia');

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  if p_markup_pct is null or p_markup_pct <= 0 or p_markup_pct > 1000 then
    raise exception using
      errcode = 'PT400',
      message = 'El % de ganancia debe ser mayor que 0 y como máximo 1000';
  end if;

  -- El bloqueo dura hasta el final de la transaccion: update_product_price, mas
  -- abajo, ve el mismo costo que se uso para calcular.
  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  if coalesce(v_product.current_cost_ref, 0) <= 0 then
    raise exception using
      errcode = 'PT400',
      message = 'Sin costo no se puede calcular el precio',
      hint = 'NO_COST';
  end if;

  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  return public.update_product_price(
    p_product_id,
    public.price_from_markup(v_product.current_cost_ref, p_markup_pct),
    p_reason
  );
end;
$$;

comment on function public.reprice_product_to_markup(uuid, numeric, text, numeric) is
  'Reprecio a un % de ganancia: lee el costo con el producto bloqueado, calcula el precio y delega en update_product_price. Con costo esperado distinto del actual responde PT409 sin cambiar nada.';

revoke all on function public.reprice_product_to_markup(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.reprice_product_to_markup(uuid, numeric, text, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. update_product_price_checked — precio fijo sobre el costo que se vio.
-- -----------------------------------------------------------------------------

create or replace function public.update_product_price_checked(
  p_product_id uuid,
  p_new_sale_price_ref numeric,
  p_reason text default null,
  p_expected_cost_ref numeric default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  return public.update_product_price(p_product_id, p_new_sale_price_ref, p_reason);
end;
$$;

comment on function public.update_product_price_checked(uuid, numeric, text, numeric) is
  'Cambio de precio con costo esperado: bloquea el producto, responde PT409 si el costo ya no es el que vio el usuario y, si coincide, delega en update_product_price.';

revoke all on function public.update_product_price_checked(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.update_product_price_checked(uuid, numeric, text, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. keep_product_price — copia de 20261009c + costo esperado. Firma nueva
--    (3 argumentos): se elimina la de 2 (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.keep_product_price(uuid, text);

create or replace function public.keep_product_price(
  p_product_id uuid,
  p_reason text default null,
  p_expected_cost_ref numeric default null
)
returns public.product_price_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_history public.product_price_history;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para mantener precios';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- M1 — la instantanea que se guarda es la que el usuario acepto, o ninguna.
  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    p_product_id,
    v_product.sale_price_ref,
    v_product.sale_price_ref,
    coalesce(nullif(btrim(p_reason), ''), 'Precio mantenido'),
    auth.uid(),
    v_product.current_cost_ref,
    public.product_margin_band(v_store_id, v_product.margin_pct),
    nextval('public.stock_movements_seq')
  )
  returning * into v_history;

  return v_history;
end;
$$;

comment on function public.keep_product_price(uuid, text, numeric) is
  'Mantener precio: fila de historial sin cambio de precio con el costo y la banda actuales. Con costo esperado distinto del actual responde PT409 sin insertar. No toca products ni stock.';

revoke all on function public.keep_product_price(uuid, text, numeric) from public, anon;
grant execute on function public.keep_product_price(uuid, text, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Clave de idempotencia del alta de producto.
-- -----------------------------------------------------------------------------

alter table public.products
  add column if not exists client_request_id uuid,
  add column if not exists client_request_hash text;

comment on column public.products.client_request_id is
  'Clave de idempotencia enviada por el cliente al crear el producto (unica por tienda). NULL en importaciones, RPC y productos anteriores a 20261009f.';
comment on column public.products.client_request_hash is
  'Huella del contenido enviado con client_request_id. La misma clave con otra huella se rechaza.';

create unique index if not exists products_store_client_request_unique
  on public.products (store_id, client_request_id)
  where client_request_id is not null;

commit;

notify pgrst, 'reload schema';
