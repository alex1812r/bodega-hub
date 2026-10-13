-- =============================================================================
-- 20261017a — clave de idempotencia del reprecio masivo y reprecio sin cambio
--             que no escribe historial (FIN-03; hallazgo B2 del caos global)
-- Proyecto: BodegaHub
-- Requiere: 20261009c (update_product_price con instantanea, product_margin_band)
--           y 20261009f (reprice_product_to_markup, price_from_markup,
--           assert_expected_cost_ref).
--
-- POST /api/products/price-review/reprice llama a reprice_product_to_markup una
-- vez por producto. La RPC delegaba SIEMPRE en update_product_price, que inserta
-- una fila de historial aunque el precio no cambie: 8 llamadas iguales dejaban 8
-- filas por producto. Y sin clave, un reintento tardio (respuesta perdida) volvia
-- a calcular el precio y pisaba un cambio hecho entre medias.
--
--   1. product_price_history.client_request_id / client_request_hash + indice
--      unico parcial (product_id, client_request_id). Opcionales: solo las
--      escribe reprice_product_to_markup cuando recibe clave.
--   2. reprice_product_to_markup gana p_client_request_id (al final, default
--      null). Se elimina la firma de cuatro argumentos para no dejar dos
--      sobrecargas vivas (PGRST203); las llamadas con cuatro siguen resolviendo.
--      Con el producto ya bloqueado:
--        a. Reintento: si el producto ya tiene una fila con esa clave, devuelve
--           el producto tal como esta, sin calcular ni escribir nada. La misma
--           clave con otro % -> PT409.
--        b. Sin nada que registrar: si el precio calculado es el vigente y la
--           ultima instantanea del producto ya guarda ese precio, el costo
--           vigente y la banda vigente, devuelve el producto sin insertar. La
--           fila que se omite seria identica a la ultima; un producto en la cola
--           "Por revisar" (costo o banda distintos de su instantanea) SI recibe
--           su fila, que es la que lo saca de la cola.
--        c. En otro caso delega en update_product_price como antes y marca la
--           fila recien insertada con la clave y la huella (el % a dos decimales).
--
-- El precio se calcula igual (price_from_markup, mismo redondeo). No cambian
-- update_product_price, update_product_price_checked ni keep_product_price; no
-- toca stock, dinero ni politicas. Las columnas nuevas no son numeric (los
-- triggers de 20261006i no se regeneran). Idempotente, una sola transaccion.
-- Ejecutar en SQL Editor o via db-up ANTES de desplegar el BFF que envia la clave.
-- OJO: reaplicar 20261009f reinstala la firma de cuatro argumentos y deja dos
-- sobrecargas: volver a aplicar este parche despues.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Clave de idempotencia en la fila de historial que deja el reprecio.
-- -----------------------------------------------------------------------------

alter table public.product_price_history
  add column if not exists client_request_id uuid,
  add column if not exists client_request_hash text;

comment on column public.product_price_history.client_request_id is
  'Clave de idempotencia del reprecio masivo que inserto la fila (unica por producto). NULL en el resto de filas.';
comment on column public.product_price_history.client_request_hash is
  'Huella del contenido enviado con client_request_id (el % de ganancia a dos decimales). La misma clave con otra huella se rechaza.';

create unique index if not exists product_price_history_product_client_request_unique
  on public.product_price_history (product_id, client_request_id)
  where client_request_id is not null;

-- -----------------------------------------------------------------------------
-- 2. reprice_product_to_markup — copia de 20261009f + reintento por clave y
--    reprecio sin cambio. Firma nueva (5 argumentos): se elimina la de 4.
-- -----------------------------------------------------------------------------

drop function if exists public.reprice_product_to_markup(uuid, numeric, text, numeric);

create or replace function public.reprice_product_to_markup(
  p_product_id uuid,
  p_markup_pct numeric,
  p_reason text default null,
  p_expected_cost_ref numeric default null,
  p_client_request_id uuid default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_new_price numeric;
  v_request_hash text;
  v_prior_hash text;
  v_last public.product_price_history;
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
  -- abajo, ve el mismo costo que se uso para calcular, y dos llamadas con la
  -- misma clave pasan una detras de otra.
  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- a. Reintento de una llamada que ya cambio este producto: no se repite.
  if p_client_request_id is not null then
    v_request_hash := round(p_markup_pct, 2)::text;

    select h.client_request_hash into v_prior_hash
    from public.product_price_history h
    where h.product_id = p_product_id
      and h.client_request_id = p_client_request_id;

    if found then
      if v_prior_hash is distinct from v_request_hash then
        raise exception using
          errcode = 'PT409',
          message = 'Esta solicitud de reprecio ya se usó con otro % de ganancia',
          hint = 'REQUEST_REUSED';
      end if;

      return v_product;
    end if;
  end if;

  if coalesce(v_product.current_cost_ref, 0) <= 0 then
    raise exception using
      errcode = 'PT400',
      message = 'Sin costo no se puede calcular el precio',
      hint = 'NO_COST';
  end if;

  perform public.assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref);

  v_new_price := public.price_from_markup(v_product.current_cost_ref, p_markup_pct);

  -- b. Mismo precio y la ultima instantanea ya lo guarda con el costo y la banda
  --    vigentes: la fila nueva seria identica, no se escribe.
  if v_new_price = v_product.sale_price_ref then
    select * into v_last
    from public.product_price_history h
    where h.product_id = p_product_id
      and h.snapshot_seq is not null
    order by h.snapshot_seq desc
    limit 1;

    if found
       and v_last.new_sale_price_ref = v_new_price
       and v_last.cost_ref_snapshot = v_product.current_cost_ref
       and v_last.margin_band_snapshot = public.product_margin_band(v_store_id, v_product.margin_pct) then
      return v_product;
    end if;
  end if;

  -- c. Cambio real: mismo camino que antes (historial e instantanea).
  v_product := public.update_product_price(p_product_id, v_new_price, p_reason);

  if p_client_request_id is not null then
    -- La fila mas reciente del producto es la que acaba de insertar
    -- update_product_price: el producto sigue bloqueado por esta transaccion.
    update public.product_price_history h
    set client_request_id = p_client_request_id,
        client_request_hash = v_request_hash
    where h.id = (
      select l.id
      from public.product_price_history l
      where l.product_id = p_product_id
        and l.snapshot_seq is not null
      order by l.snapshot_seq desc
      limit 1
    );
  end if;

  return v_product;
end;
$$;

comment on function public.reprice_product_to_markup(uuid, numeric, text, numeric, uuid) is
  'Reprecio a un % de ganancia: lee el costo con el producto bloqueado, calcula el precio y delega en update_product_price. Costo esperado distinto -> PT409 sin cambiar nada. Con clave, repetir la llamada no repite el cambio (misma clave con otro % -> PT409). Si el precio no cambia y la ultima instantanea ya guarda el costo y la banda vigentes, no inserta historial.';

revoke all on function public.reprice_product_to_markup(uuid, numeric, text, numeric, uuid) from public, anon;
grant execute on function public.reprice_product_to_markup(uuid, numeric, text, numeric, uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
