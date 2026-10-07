-- =============================================================================
-- 20261006b — RPC de ventas y pagos en modo estricto del libro mayor
-- Proyecto: BodegaHub (plan stock-integrity, fase 5, STK-502)
-- Requiere: 20261006a-stock-ledger-guards.sql (trigger stock_movements_apply),
--           20260909-create-sale-with-payments.sql (sales.client_request_id),
--           20260904-payment-guards.sql (register_payment / cancel_payment)
--
-- Redefine completas, partiendo de su version vigente y con el cambio minimo:
--   create_sale (20260904c), create_sale_with_payments (20260909),
--   cancel_sale (20260904c), return_sale (20260810),
--   register_payment y cancel_payment (20260904).
--
-- En todas las que mueven stock:
--   * ya no hay "update products set current_stock": se inserta el movimiento
--     con stock_after NULL y el trigger del parche a calcula el saldo y escribe
--     products.
--   * orden de bloqueo: documento -> TODOS los productos tocados en una sola
--     sentencia ordenada por id -> (pagos / baul) -> bucle por linea.
--   * "if not found" tras cada select for update (PT404, no 23502 crudo).
--   * errores de negocio con SQLSTATE PT400 / PT403 / PT404 / PT409 y los
--     textos de siempre.
--
-- Causas (.notes/stock-integrity-gtm/causes.md):
--   C4  clave de idempotencia + sales.client_request_hash: la misma clave solo
--       devuelve la venta si el contenido coincide, es del mismo usuario y
--       sigue viva; si no, PT409. Dos peticiones simultaneas con la misma clave
--       se serializan con un advisory lock por (tienda, clave): la segunda
--       recibe la venta de la primera, nunca un 23505.
--   C7  return_sale anula los pagos activos en la misma transaccion con la
--       logica de cancel_payment (cancel_payment_apply): caja y baul quedan
--       como si el cobro no hubiera existido. Si el cierre de caja de ese cobro
--       ya viajo al baul la devolucion se rechaza (guarda F4 de cuadre-baul.md).
--   C8  register_payment rechaza ventas cancelada / devuelta.
--   C10 bloqueo de productos en orden determinista (por id).
--   C11 invoice_number por secuencia: 'V-YYYYMMDD-NNNNNN'.
--   C15 return_sale repone por producto vendido - ya devuelto (movimientos
--       devolucion_cliente con ese sale_id).
--   C19 el vendedor no vende por debajo del precio de lista ni con un
--       descuento que deje la venta en cero.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Esquema: huella del contenido de la venta y secuencia de facturas
-- -----------------------------------------------------------------------------

alter table public.sales
  add column if not exists client_request_hash text;

comment on column public.sales.client_request_hash is
  'Huella del contenido enviado con client_request_id (cliente, lineas, descuento, impuesto, pagos). La misma clave con otra huella se rechaza.';

create sequence if not exists public.sales_invoice_seq as bigint;
revoke all on sequence public.sales_invoice_seq from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Funciones internas (no son RPC: sin execute para los roles de PostgREST)
-- -----------------------------------------------------------------------------

-- Huella del contenido de una venta. Los numeros de las lineas y de los pagos
-- se toman tal como llegan (texto): un reintento del mismo intento de cobro
-- reenvia el mismo cuerpo.
create or replace function public.sale_request_hash(
  p_customer_id uuid,
  p_items jsonb,
  p_discount_ref numeric,
  p_tax_ref numeric,
  p_payments jsonb
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(jsonb_build_array(
    p_customer_id,
    round(coalesce(p_discount_ref, 0), 2)::text,
    round(coalesce(p_tax_ref, 0), 2)::text,
    coalesce((
      select jsonb_agg(
        jsonb_build_array(i.value ->> 'product_id', i.value ->> 'quantity', i.value ->> 'unit_price_ref')
        order by i.ordinality
      )
      from jsonb_array_elements(
        case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
      ) with ordinality as i(value, ordinality)
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_array(
          p.value ->> 'method', p.value ->> 'amount', p.value ->> 'change_method',
          coalesce(nullif(p.value ->> 'change_amount', ''), '0')
        )
        order by p.ordinality
      )
      from jsonb_array_elements(
        case when jsonb_typeof(p_payments) = 'array' then p_payments else '[]'::jsonb end
      ) with ordinality as p(value, ordinality)
    ), '[]'::jsonb)
  )::text, 'UTF8')), 'hex');
$$;

-- C4 — venta ya registrada con esa clave en la tienda. NULL si no hay ninguna;
-- la venta si es un reintento legitimo; PT409 en cualquier otro caso.
create or replace function public.sale_idempotent_replay(
  p_store_id uuid,
  p_client_request_id uuid,
  p_client_request_hash text
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
begin
  select * into v_sale
  from public.sales
  where store_id = p_store_id
    and client_request_id = p_client_request_id;

  if not found then
    return null;
  end if;

  if v_sale.client_request_hash is distinct from p_client_request_hash
     or v_sale.user_id is distinct from auth.uid()
     or v_sale.status in ('cancelada', 'devuelta') then
    raise exception using
      errcode = 'PT409',
      message = 'La clave de idempotencia ya se uso en otra venta. Revisa la venta registrada antes de reintentar.';
  end if;

  return v_sale;
end;
$$;

-- C7 — cuerpo de cancel_payment (20260904) sin la guarda de rol: lo comparten
-- cancel_payment (admin / contador) y return_sale (quien puede devolver la venta).
create or replace function public.cancel_payment_apply(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_payment public.payments; v_sale public.sales; v_purchase public.purchases;
  v_vault public.store_vaults; v_vault_movement public.vault_movements;
  v_change_movement public.vault_movements;
  v_new_paid_ves numeric(14,2); v_new_paid_ref numeric(14,2);
  v_is_bank boolean; v_change_ves numeric(14,2); v_net_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  -- Orden de bloqueo venta -> pago, el mismo de register_payment y return_sale.
  perform 1 from public.sales s
  where s.store_id = v_store_id
    and s.id = (select p.sale_id from public.payments p where p.id = p_payment_id and p.store_id = v_store_id)
  for update;
  select * into v_payment from public.payments where id = p_payment_id and store_id = v_store_id for update;
  if not found then raise exception 'Pago no encontrado' using errcode = 'PT404'; end if;
  if v_payment.status = 'anulado' then
    raise exception 'El pago ya fue anulado' using errcode = 'PT409';
  end if;

  -- F4 — si el cierre de esa sesión ya viajó al baúl, borrar sus movimientos
  -- dejaría el `theoretical_closing_*` guardado sin respaldo mientras el baúl
  -- conserva el dinero: el descuadre saldría en el próximo arqueo.
  if exists (
    select 1
    from public.cash_movements m
    join public.cash_sessions s on s.id = m.session_id
    where m.payment_id = v_payment.id
      and m.store_id = v_store_id
      and s.status = 'closed'
      and s.vault_transferred_at is not null
  ) then
    raise exception 'No se puede anular este pago: su cierre de caja ya fue transferido al baúl. Registre un ajuste explícito de caja o baúl para corregirlo'
      using errcode = 'PT409';
  end if;

  v_is_bank := v_payment.method in ('pago_movil', 'transferencia', 'punto_venta');
  v_change_ves := round(coalesce(v_payment.change_ves, 0), 2);
  -- A la venta se le aplicó el neto, así que se le devuelve el neto.
  v_net_ves := round(v_payment.amount_ves - v_change_ves, 2);

  if v_payment.sale_id is not null then
    select * into v_sale from public.sales where id = v_payment.sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede anular un pago de una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    if v_sale.paid_ves < v_net_ves then
      raise exception 'El monto del pago excede lo registrado en la venta' using errcode = 'PT400';
    end if;
    v_new_paid_ves := v_sale.paid_ves - v_net_ves;
    update public.sales set paid_ves = v_new_paid_ves, status = case
      when v_sale.status = 'borrador' then v_sale.status
      when v_new_paid_ves >= v_sale.total_ves then 'pagada'::public.sale_status
      else 'pendiente_pago'::public.sale_status end where id = v_payment.sale_id;

    -- Vuelto entregado por cuenta bancaria: devolver el saldo al baúl (cubeta cuenta).
    if v_change_ves > 0 and v_payment.change_method in ('pago_movil', 'transferencia', 'punto_venta') then
      select * into v_change_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'withdrawal' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_change_movement.vault_id and store_id = v_store_id for update;
        if not found then raise exception 'Baúl no encontrado para revertir el vuelto' using errcode = 'PT404'; end if;
        update public.store_vaults
        set balance_ves = balance_ves + v_change_movement.amount_ves
        where id = v_vault.id;
        delete from public.vault_movements where id = v_change_movement.id;
      end if;
    end if;

    -- Borra el sale_in / account_in y, si lo hubo, el change_out / account_out del vuelto.
    if v_payment.method in ('efectivo_ves', 'efectivo_usd') then
      delete from public.cash_movements where payment_id = v_payment.id and store_id = v_store_id;
    elsif v_is_bank then
      delete from public.cash_movements where payment_id = v_payment.id and store_id = v_store_id;
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'sale_in' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        update public.store_vaults
        set balance_ves = greatest(balance_ves - v_vault_movement.amount_ves, 0)
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    end if;
  else
    select * into v_purchase from public.purchases where id = v_payment.purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede anular un pago de una compra cancelada o devuelta' using errcode = 'PT409';
    end if;
    if v_purchase.paid_ves < v_payment.amount_ves then
      raise exception 'El monto del pago excede lo registrado en la compra' using errcode = 'PT400';
    end if;
    if coalesce(v_purchase.paid_ref, 0) < v_payment.amount_ref then
      raise exception 'El monto REF del pago excede lo registrado en la compra' using errcode = 'PT400';
    end if;
    v_new_paid_ves := v_purchase.paid_ves - v_payment.amount_ves;
    v_new_paid_ref := greatest(round(coalesce(v_purchase.paid_ref, 0) - v_payment.amount_ref, 2), 0);
    update public.purchases set paid_ves = v_new_paid_ves, paid_ref = v_new_paid_ref where id = v_payment.purchase_id;

    if v_payment.method in ('efectivo_ves', 'efectivo_usd') then
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'purchase_out' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        if not found then raise exception 'Baúl no encontrado para revertir el pago en efectivo' using errcode = 'PT404'; end if;
        update public.store_vaults
        set balance_efectivo_ves = balance_efectivo_ves + v_vault_movement.amount_ves,
            balance_ref = balance_ref + v_vault_movement.amount_ref
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    elsif v_is_bank then
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'purchase_out' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        update public.store_vaults
        set balance_ves = balance_ves + v_vault_movement.amount_ves
        where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    end if;
  end if;

  update public.payments set status = 'anulado', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

revoke all on function public.sale_request_hash(uuid, jsonb, numeric, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.sale_idempotent_replay(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_payment_apply(uuid) from public, anon, authenticated;
grant execute on function public.sale_request_hash(uuid, jsonb, numeric, numeric, jsonb) to service_role;
grant execute on function public.sale_idempotent_replay(uuid, uuid, text) to service_role;
grant execute on function public.cancel_payment_apply(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. create_sale — copia de 20260904c + C4, C10, C11, C19 y modo estricto
--    Firma nueva (9 argumentos): se elimina la de 8 para no dejar dos
--    sobrecargas vivas (PGRST203).
-- -----------------------------------------------------------------------------

drop function if exists public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text);

create or replace function public.create_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null,
  p_client_request_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Banda permitida entre la tasa enviada y la ultima tasa registrada de la tienda.
  -- 0.05 = +-5%. Ver cabecera de 20260904c para la justificacion.
  c_rate_tolerance constant numeric := 0.05;
  v_store_id uuid;
  v_role text;
  v_rate numeric(14,4);
  v_reference_rate numeric(14,4);
  v_sale public.sales;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_product_ids uuid[];
  v_quantity integer;
  v_unit_price_ref numeric(12,2);
  v_unit_cost_ref numeric(12,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_subtotal_ref numeric(14,2) := 0;
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_request_hash text;
  v_invoice_seq bigint;
begin
  v_store_id := public.assert_store_context();
  v_role := coalesce(public.current_user_role()::text, '');

  if v_role not in ('admin', 'vendedor') then
    raise exception using errcode = 'PT403', message = 'No autorizado para crear ventas';
  end if;

  -- C4 — reintento del mismo intento de cobro. El advisory lock serializa dos
  -- peticiones simultaneas con la misma clave: la segunda espera el commit de la
  -- primera y encuentra su venta (nunca llega al indice unico).
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('sale-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.sale_request_hash(p_customer_id, p_items, p_discount_ref, p_tax_ref, '[]'::jsonb);
    v_sale := public.sale_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_sale.id is not null then
      return v_sale;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'La venta debe tener al menos un item';
  end if;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id
      and store_id = v_store_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception using errcode = 'PT400', message = 'Debe indicar una tasa ref/VES valida';
  end if;

  -- Tasa vigente de la tienda: ultima fila registrada.
  select rate_ves into v_reference_rate
  from public.exchange_rates
  where store_id = v_store_id
  order by created_at desc
  limit 1;

  if v_reference_rate is not null and v_reference_rate > 0 then
    if v_rate < v_reference_rate * (1 - c_rate_tolerance)
       or v_rate > v_reference_rate * (1 + c_rate_tolerance) then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Tasa ref/VES fuera de rango: se envio %s Bs/REF y la tasa vigente de la tienda es %s Bs/REF (tolerancia +-%s). Actualiza la tasa y vuelve a intentar.',
          round(v_rate, 4),
          round(v_reference_rate, 4),
          trim(trailing '.' from trim(trailing '0' from round(c_rate_tolerance * 100, 2)::text)) || '%'
        );
    end if;
  end if;

  perform public.assert_contact_type(p_customer_id, array['cliente', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_customer_id
      and store_id = v_store_id
  ) then
    raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
  end if;

  -- C11 — el numero por defecto sale de una secuencia: dos ventas en el mismo
  -- milisegundo ya no chocan en sales_store_invoice_unique.
  if p_invoice_number is null then
    v_invoice_seq := nextval('public.sales_invoice_seq');
  end if;

  insert into public.sales (
    invoice_number,
    customer_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes,
    store_id,
    client_request_id,
    client_request_hash
  )
  values (
    coalesce(
      p_invoice_number,
      'V-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-'
        || lpad(v_invoice_seq::text, greatest(6, length(v_invoice_seq::text)), '0')
    ),
    p_customer_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    coalesce(p_discount_ref, 0),
    coalesce(p_tax_ref, 0),
    'pendiente_pago',
    p_notes,
    v_store_id,
    p_client_request_id,
    case when p_client_request_id is not null then v_request_hash end
  )
  returning * into v_sale;

  -- C10 — documento primero; despues TODOS los productos de la venta en una sola
  -- sentencia y en orden fijo. Dos ventas con las mismas lineas en orden inverso
  -- ya no se bloquean entre si.
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_product_ids
  from jsonb_array_elements(p_items) as e(value);

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    if v_quantity is null or v_quantity <= 0 then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de venta';
    end if;

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
      and is_active = true
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado o inactivo: %s', v_product_id);
    end if;

    if v_product.current_stock < v_quantity then
      raise exception using
        errcode = 'PT409',
        message = format('Stock insuficiente para producto %s', v_product.sku);
    end if;

    v_unit_price_ref := coalesce((v_item ->> 'unit_price_ref')::numeric, v_product.sale_price_ref);

    if v_unit_price_ref is null or v_unit_price_ref < 0 then
      raise exception using
        errcode = 'PT400',
        message = format('Precio unitario invalido para el producto %s', v_product.sku);
    end if;

    -- Un precio unitario en cero solo se acepta si el producto vale cero de lista.
    if v_unit_price_ref = 0 and coalesce(v_product.sale_price_ref, 0) <> 0 then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Precio unitario en cero no permitido para el producto %s (precio de lista: %s REF)',
          v_product.sku, round(v_product.sale_price_ref, 2)
        );
    end if;

    -- C19 — el vendedor no vende por debajo del precio de lista (el admin si
    -- puede fijar otro precio).
    if v_role = 'vendedor' and v_unit_price_ref < round(coalesce(v_product.sale_price_ref, 0), 2) then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Precio unitario por debajo del precio de lista para el producto %s (precio de lista: %s REF)',
          v_product.sku, round(v_product.sale_price_ref, 2)
        );
    end if;

    v_unit_cost_ref := coalesce(v_product.current_cost_ref, 0);
    v_line_subtotal_ref := round(v_quantity::numeric * v_unit_price_ref, 2);
    v_line_subtotal_ves := round(v_line_subtotal_ref * v_rate, 2);
    v_subtotal_ref := v_subtotal_ref + v_line_subtotal_ref;

    insert into public.sale_items (
      sale_id,
      product_id,
      quantity,
      unit_price_ref,
      unit_cost_ref_snapshot,
      subtotal_ves
    )
    values (
      v_sale.id,
      v_product_id,
      v_quantity,
      v_unit_price_ref,
      v_unit_cost_ref,
      v_line_subtotal_ves
    );

    -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
    -- actualiza products.current_stock.
    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      sale_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_product_id,
      'venta',
      -v_quantity,
      v_sale.id,
      'Venta ' || v_sale.invoice_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  -- C19 — el vendedor no deja la venta en cero con el descuento.
  if v_role = 'vendedor'
     and coalesce(p_discount_ref, 0) > 0
     and coalesce(p_discount_ref, 0) >= v_subtotal_ref then
    raise exception using
      errcode = 'PT400',
      message = format(
        'El descuento (%s REF) debe ser menor que el subtotal de la venta (%s REF)',
        round(p_discount_ref, 2), round(v_subtotal_ref, 2)
      );
  end if;

  v_total_ref := greatest(round(v_subtotal_ref - coalesce(p_discount_ref, 0) + coalesce(p_tax_ref, 0), 2), 0);
  v_total_ves := round(v_total_ref * v_rate, 2);

  update public.sales
  set subtotal_ref = v_subtotal_ref,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. create_sale_with_payments — copia de 20260909 + C4 (misma firma)
-- -----------------------------------------------------------------------------

create or replace function public.create_sale_with_payments(
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_invoice_number text default null,
  p_client_request_id uuid default null
)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_payment jsonb;
  v_change_amount numeric;
  v_request_hash text;
begin
  v_store_id := public.assert_store_context();

  -- C4 — reintento del mismo intento de cobro: la venta ya quedo registrada.
  -- Solo se devuelve si el contenido (incluidos los pagos) es el mismo, es del
  -- mismo usuario y sigue viva; si no, PT409. Mismo advisory lock que create_sale.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('sale-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.sale_request_hash(p_customer_id, p_items, p_discount_ref, p_tax_ref, p_payments);
    v_sale := public.sale_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_sale.id is not null then
      return v_sale;
    end if;
  end if;

  if p_payments is not null and jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Los pagos de la venta deben venir como lista' using errcode = 'PT400';
  end if;

  -- create_sale escribe la clave y la huella (sin pagos) en el INSERT.
  v_sale := public.create_sale(
    p_customer_id,
    p_items,
    p_exchange_rate_id,
    p_ref_rate_ves,
    p_discount_ref,
    p_tax_ref,
    p_notes,
    p_invoice_number,
    p_client_request_id
  );

  -- La huella definitiva incluye los pagos de este intento de cobro.
  if p_client_request_id is not null then
    update public.sales
    set client_request_hash = v_request_hash
    where id = v_sale.id;
  end if;

  for v_payment in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    v_change_amount := coalesce((v_payment ->> 'change_amount')::numeric, 0);

    -- Cualquier excepcion aqui (saldo, vuelto, billetes, caja cerrada, permisos)
    -- aborta la funcion completa y Postgres revierte la venta y el stock.
    perform public.register_payment(
      p_sale_id => v_sale.id,
      p_purchase_id => null,
      p_method => (v_payment ->> 'method')::public.payment_method,
      p_amount => (v_payment ->> 'amount')::numeric,
      p_bank_name => v_payment ->> 'bank_name',
      p_phone => v_payment ->> 'phone',
      p_reference_code => v_payment ->> 'reference_code',
      p_notes => v_payment ->> 'notes',
      p_change_method => case
        when v_change_amount > 0 then (v_payment ->> 'change_method')::public.payment_method
        else null
      end,
      p_change_amount => v_change_amount,
      p_received_denominations => case
        when jsonb_typeof(v_payment -> 'received_denominations') = 'object'
          then v_payment -> 'received_denominations'
        else null
      end,
      p_change_denominations => case
        when jsonb_typeof(v_payment -> 'change_denominations') = 'object'
          then v_payment -> 'change_denominations'
        else null
      end
    );
  end loop;

  -- `register_payment` actualiza paid_ves y status: se relee la fila final.
  select * into v_sale
  from public.sales
  where id = v_sale.id;

  return v_sale;
end;
$$;

revoke all on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) from public, anon;
grant execute on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. cancel_sale — copia de 20260904c + modo estricto, C10 y PT4xx
-- -----------------------------------------------------------------------------

create or replace function public.cancel_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_item public.sale_items;
  v_product public.products;
  v_product_ids uuid[];
  v_active_payments integer;
  v_active_ves numeric(14,2);
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'vendedor') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cancelar ventas';
  end if;

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

  -- El dinero se saca por `cancel_payment`, no por aqui: cancelar una venta con pagos
  -- vivos dejaba el efectivo en caja y bloqueaba la anulacion del pago para siempre.
  select count(*), coalesce(sum(amount_ves), 0)
  into v_active_payments, v_active_ves
  -- Sin filtro por store_id a proposito: la venta ya quedo alcanzada arriba y aqui
  -- interesa no dejar fuera ningun pago vivo colgado de ella.
  from public.payments
  where sale_id = p_sale_id
    and status = 'activo';

  if v_active_payments > 0 then
    raise exception using
      errcode = 'PT409',
      message = format(
        'La venta %s tiene %s pago(s) activo(s) por Bs %s. Anula primero los pagos y luego cancela la venta.',
        v_sale.invoice_number, v_active_payments, round(v_active_ves, 2)
      );
  end if;

  -- Todos los productos de la venta, en orden fijo, antes del bucle.
  select array_agg(distinct product_id)
  into v_product_ids
  from public.sale_items
  where sale_id = p_sale_id;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  for v_item in
    select *
    from public.sale_items
    where sale_id = p_sale_id
    order by product_id, id
  loop
    select * into v_product
    from public.products
    where id = v_item.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format(
          'Producto no encontrado en tu tienda (%s): no se puede reponer el stock de la venta %s',
          v_item.product_id, v_sale.invoice_number
        );
    end if;

    insert into public.stock_movements (
      product_id,
      type,
      quantity_delta,
      sale_id,
      reason,
      created_by,
      store_id
    )
    values (
      v_item.product_id,
      'ajuste_entrada',
      v_item.quantity,
      p_sale_id,
      'Cancelacion ' || v_sale.invoice_number,
      auth.uid(),
      v_store_id
    );
  end loop;

  update public.sales
  set status = 'cancelada'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.cancel_sale(uuid) from public, anon;
grant execute on function public.cancel_sale(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. return_sale — copia de 20260810 + C7, C8, C15, C10, modo estricto y PT4xx
-- -----------------------------------------------------------------------------

create or replace function public.return_sale(p_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sale public.sales;
  v_line record;
  v_product public.products;
  v_product_ids uuid[];
  v_payment_id uuid;
  v_already_returned integer;
  v_quantity integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'vendedor') then
    raise exception using errcode = 'PT403', message = 'No autorizado para devolver ventas';
  end if;

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

  -- C8 — solo se devuelve una venta viva.
  if v_sale.status not in ('pagada', 'pendiente_pago') then
    raise exception using
      errcode = 'PT409',
      message = 'Solo se pueden devolver ventas pagadas o pendientes de pago';
  end if;

  -- Orden de bloqueo: venta -> productos (por id) -> pagos / baul. Es el mismo
  -- orden de create_sale_with_payments (productos antes que el baul).
  select array_agg(distinct product_id)
  into v_product_ids
  from public.sale_items
  where sale_id = p_sale_id;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  -- C7 — el dinero sale con la venta: cada pago activo se anula con la misma
  -- logica de cancel_payment (caja, baul, paid_ves). Si alguno no se puede
  -- anular (p. ej. su cierre de caja ya fue transferido al baul) la devolucion
  -- completa se rechaza y no se mueve stock.
  for v_payment_id in
    select id
    from public.payments
    where sale_id = p_sale_id
      and status = 'activo'
    order by created_at, id
  loop
    perform public.cancel_payment_apply(v_payment_id);
  end loop;

  -- C15 — por producto: lo vendido menos lo ya devuelto con movimientos
  -- devolucion_cliente ligados a esta venta.
  for v_line in
    select product_id, sum(quantity)::integer as sold
    from public.sale_items
    where sale_id = p_sale_id
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_line.product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format(
          'Producto no encontrado en tu tienda (%s): no se puede reponer el stock de la venta %s',
          v_line.product_id, v_sale.invoice_number
        );
    end if;

    select coalesce(sum(quantity_delta), 0)::integer
    into v_already_returned
    from public.stock_movements
    where sale_id = p_sale_id
      and product_id = v_line.product_id
      and type = 'devolucion_cliente';

    v_quantity := v_line.sold - v_already_returned;

    if v_quantity > 0 then
      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        sale_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_line.product_id,
        'devolucion_cliente',
        v_quantity,
        p_sale_id,
        'Devolucion ' || v_sale.invoice_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  update public.sales
  set status = 'devuelta'
  where id = p_sale_id
  returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.return_sale(uuid) from public, anon;
grant execute on function public.return_sale(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. register_payment — copia de 20260904 + C8 (misma firma de 12 argumentos)
-- -----------------------------------------------------------------------------

create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null,
  p_change_method public.payment_method default null,
  p_change_amount numeric default 0,
  p_received_denominations jsonb default null,
  p_change_denominations jsonb default null
) returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_sale public.sales; v_purchase public.purchases; v_payment public.payments;
  v_direction public.payment_direction; v_contact_id uuid; v_rate numeric(14,4);
  v_currency public.payment_currency; v_amount_ves numeric(14,2); v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2); v_paid_ref numeric(14,2); v_session public.cash_sessions;
  v_vault public.store_vaults; v_movement_ves numeric(14,2); v_movement_ref numeric(14,2);
  v_is_bank boolean;
  v_change_method public.payment_method; v_change_amount numeric(14,2);
  v_change_ves numeric(14,2) := 0; v_change_ref numeric(14,2) := 0;
  v_change_is_bank boolean := false; v_net_ves numeric(14,2);
  v_change_notes text;
  v_outstanding_ves numeric(14,2); v_overpay_tolerance numeric(14,2);
  v_cash_ves numeric(14,2); v_cash_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del pago debe ser mayor a cero' using errcode = 'PT400';
  end if;
  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra' using errcode = 'PT400';
  end if;
  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Pago Móvil requiere banco' using errcode = 'PT400';
    end if;
    if p_phone is null or length(trim(p_phone)) = 0 then
      raise exception 'Pago Móvil requiere teléfono' using errcode = 'PT400';
    end if;
    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then
      raise exception 'Pago Móvil requiere referencia de 4 dígitos' using errcode = 'PT400';
    end if;
  end if;
  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
      raise exception 'Transferencia requiere banco' using errcode = 'PT400';
    end if;
    if p_reference_code is null or length(trim(p_reference_code)) = 0 then
      raise exception 'Transferencia requiere número de transferencia' using errcode = 'PT400';
    end if;
  end if;

  -- Validación del vuelto (solo aplica a ventas).
  v_change_amount := round(coalesce(p_change_amount, 0), 2);
  if v_change_amount < 0 then
    raise exception 'El monto del vuelto no puede ser negativo' using errcode = 'PT400';
  end if;
  if p_purchase_id is not null and (p_change_method is not null or v_change_amount > 0) then
    raise exception 'No se puede registrar vuelto en un pago de compra: el vuelto solo aplica a pagos de venta'
      using errcode = 'PT400';
  end if;
  if v_change_amount > 0 and p_change_method is null then
    raise exception 'Debe indicar el método del vuelto' using errcode = 'PT400';
  end if;
  if v_change_amount > 0 then
    v_change_method := p_change_method;
  else
    v_change_method := null;
  end if;
  v_change_is_bank := coalesce(v_change_method in ('pago_movil', 'transferencia', 'punto_venta'), false);

  v_is_bank := p_method in ('pago_movil', 'transferencia', 'punto_venta');

  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas' using errcode = 'PT403';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    -- C8 — una venta cancelada o devuelta no admite cobros: el pago la devolvia a
    -- pendiente_pago y permitia devolverla (y reponer stock) otra vez.
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede registrar un pago en una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    v_direction := 'entrada'; v_contact_id := v_sale.customer_id; v_rate := v_sale.ref_rate_ves;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    -- El vuelto se expresa siempre en Bs. a la tasa de la venta.
    if v_change_method is not null then
      if v_change_method = 'efectivo_usd' then
        v_change_ref := v_change_amount;
        v_change_ves := round(v_change_amount * v_rate, 2);
      else
        v_change_ref := 0;
        v_change_ves := round(v_change_amount, 2);
      end if;
      if v_change_ves <= 0 then
        raise exception 'El monto del vuelto debe ser mayor a cero' using errcode = 'PT400';
      end if;
      if v_change_ves > v_amount_ves then
        raise exception 'El vuelto (Bs %) no puede superar el monto recibido en esta línea (Bs %)',
          v_change_ves, v_amount_ves using errcode = 'PT400';
      end if;
    end if;

    -- A la venta se aplica el NETO recibido, no lo entregado por el cliente.
    v_net_ves := round(v_amount_ves - v_change_ves, 2);

    -- F2 — el neto no puede superar el saldo pendiente de la venta.
    --
    -- Sin saldo pendiente no hay nada que cobrar: ahí es donde se colaba el
    -- doble cobro (dos pagos idénticos dejaban `paid_ves` en 2x `total_ves`).
    --
    -- Con saldo pendiente sí hay una holgura legítima: el "redondeo a favor"
    -- (docs/cobro-pos-billetes.md §2). El cliente entrega billetes y el vuelto
    -- exacto casi nunca se puede armar, así que la gaveta se queda con la
    -- diferencia. Ese sobrante nunca supera el billete más pequeño de la moneda
    -- con la que se salda el resto:
    --   · vuelto en Bs. (efectivo o bancario) → Bs 10, el billete más chico;
    --     `greatest(10, 0.01 * rate)` mantiene el piso aun con tasas altas.
    --   · efectivo USD sin vuelto, o vuelto en efectivo USD → el ajuste fino es
    --     de $1 (no hay monedas), o sea `rate` bolívares.
    -- Cualquier exceso mayor es un monto errado, no un redondeo.
    v_outstanding_ves := round(v_sale.total_ves - coalesce(v_sale.paid_ves, 0), 2);
    if v_outstanding_ves <= 0.01 then
      raise exception 'La venta no tiene saldo pendiente: ya está cobrada (saldo pendiente: Bs %)',
        greatest(v_outstanding_ves, 0) using errcode = 'PT400';
    end if;
    v_overpay_tolerance := greatest(10, round(0.01 * v_rate, 2));
    if v_change_method = 'efectivo_usd'
       or (v_change_method is null and p_method = 'efectivo_usd') then
      v_overpay_tolerance := greatest(v_overpay_tolerance, round(v_rate, 2));
    end if;
    if v_net_ves > v_outstanding_ves + v_overpay_tolerance then
      raise exception 'El pago excede el saldo pendiente de la venta. Saldo pendiente: Bs %, neto del pago: Bs %',
        v_outstanding_ves, v_net_ves using errcode = 'PT400';
    end if;

    update public.sales set paid_ves = paid_ves + v_net_ves,
      status = case when paid_ves + v_net_ves >= total_ves then 'pagada'::public.sale_status else 'pendiente_pago'::public.sale_status end
    where id = p_sale_id returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores' using errcode = 'PT403';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
    v_direction := 'salida'; v_contact_id := v_purchase.supplier_id;
    select rate_ves into v_rate from public.exchange_rates where store_id = v_store_id order by created_at desc limit 1;
    if v_rate is null or v_rate <= 0 then v_rate := v_purchase.ref_rate_ves; end if;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;

    -- F3 — un pago a proveedor no puede superar el saldo pendiente de la factura.
    -- Aquí no hay vuelto ni billetes que redondear: la única holgura es el
    -- centavo de bolívar que puede aportar el redondeo de la conversión.
    v_outstanding_ves := round(v_purchase.total_ves - coalesce(v_purchase.paid_ves, 0), 2);
    if v_amount_ves > v_outstanding_ves + 0.01 then
      raise exception 'El pago excede el saldo pendiente de la compra. Saldo pendiente: Bs %, monto del pago: Bs %',
        v_outstanding_ves, v_amount_ves using errcode = 'PT400';
    end if;

    update public.purchases set paid_ves = paid_ves + v_amount_ves, paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
  end if;

  -- F5 — los desgloses de billetes tienen que describir el dinero real.
  if p_received_denominations is not null then
    if p_method not in ('efectivo_ves', 'efectivo_usd') then
      raise exception 'El desglose de billetes recibidos solo aplica a pagos en efectivo'
        using errcode = 'PT400';
    end if;
    perform public.assert_payment_denominations(
      p_received_denominations,
      case when p_method = 'efectivo_usd' then 'USD' else 'VES' end,
      case when p_method = 'efectivo_usd' then v_amount_ref else v_amount_ves end,
      'recibidos'
    );
  end if;

  if p_change_denominations is not null then
    if v_change_method is null then
      raise exception 'No se puede enviar un desglose de billetes del vuelto si no hay vuelto'
        using errcode = 'PT400';
    end if;
    if v_change_method not in ('efectivo_ves', 'efectivo_usd') then
      raise exception 'El desglose de billetes del vuelto solo aplica a vueltos en efectivo'
        using errcode = 'PT400';
    end if;
    perform public.assert_payment_denominations(
      p_change_denominations,
      case when v_change_method = 'efectivo_usd' then 'USD' else 'VES' end,
      case when v_change_method = 'efectivo_usd' then v_change_ref else v_change_ves end,
      'del vuelto'
    );
  end if;

  insert into public.payments (
    direction, sale_id, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref,
    ref_rate_ves, bank_name, phone, reference_code, notes, created_by, store_id,
    change_method, change_amount, change_ves, change_ref,
    received_denominations, change_denominations
  ) values (
    v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id,
    v_change_method, case when v_change_method is null then 0 else v_change_amount end, v_change_ves, v_change_ref,
    p_received_denominations, p_change_denominations
  ) returning * into v_payment;

  -- Efectivo venta → solo caja (físico).
  if p_method in ('efectivo_ves', 'efectivo_usd') and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada'
        using errcode = 'PT400';
    end if;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'sale_in', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo de venta'), auth.uid());

  -- Efectivo compra → baúl efectivo.
  elsif p_method in ('efectivo_ves', 'efectivo_usd') and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    if (p_method = 'efectivo_ves' and v_vault.balance_efectivo_ves < v_movement_ves)
       or (p_method = 'efectivo_usd' and v_vault.balance_ref < v_movement_ref) then
      if p_method = 'efectivo_ves' then
        raise exception 'Saldo insuficiente en el baul (efectivo). Faltante VES: %',
          greatest(v_movement_ves - v_vault.balance_efectivo_ves, 0) using errcode = 'PT402';
      else
        raise exception 'Saldo insuficiente en el baul. Faltante REF: %',
          greatest(v_movement_ref - v_vault.balance_ref, 0) using errcode = 'PT402';
      end if;
    end if;
    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves - v_movement_ves,
        balance_ref = balance_ref - v_movement_ref
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'purchase_out', 'efectivo', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo a proveedor'), auth.uid()
    );

  -- Cuenta (PM / transferencia / punto) venta → caja account_in + baúl cuenta.
  elsif v_is_bank and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta'
        using errcode = 'PT400';
    end if;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'account_in', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Cobro en cuenta (' || p_method::text || ')'), auth.uid());
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    update public.store_vaults
    set balance_ves = balance_ves + v_payment.amount_ves
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'sale_in', 'cuenta', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Ingreso a cuenta por venta (' || p_method::text || ')'), auth.uid()
    );

  -- Cuenta compra → baúl cuenta (sin caja).
  elsif v_is_bank and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    if v_vault.balance_ves < v_payment.amount_ves then
      raise exception 'Saldo insuficiente en el baul (cuenta). Faltante VES: %',
        greatest(v_payment.amount_ves - v_vault.balance_ves, 0) using errcode = 'PT402';
    end if;
    update public.store_vaults
    set balance_ves = balance_ves - v_payment.amount_ves
    where id = v_vault.id;
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'purchase_out', 'cuenta', v_payment.amount_ves, 0, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago a proveedor desde cuenta (' || p_method::text || ')'), auth.uid()
    );
  end if;

  -- Asiento del vuelto (docs/cobro-pos-billetes.md §3.4 y §6).
  if v_change_method is not null then
    if v_session.id is null then
      raise exception 'No puede registrar el vuelto: no hay sesión de caja abierta' using errcode = 'PT400';
    end if;
    v_change_notes := coalesce(
      nullif(trim(p_notes), ''),
      'Vuelto de venta (' || v_change_method::text || ')'
    );

    if v_change_method in ('efectivo_ves', 'efectivo_usd') then
      -- F1 — el vuelto en efectivo sale de la gaveta: solo se puede entregar lo
      -- que la gaveta tiene. Se recalcula el efectivo físico de la sesión con la
      -- misma fórmula de `close_cash_session` (el `sale_in` de ESTE pago ya está
      -- escrito en esta transacción y, con razón, cuenta como disponible).
      select round(v_session.opening_ves + coalesce(sum(case
               when type in ('sale_in', 'adjustment') then amount_ves
               when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
             round(v_session.opening_ref + coalesce(sum(case
               when type in ('sale_in', 'adjustment') then amount_ref
               when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
      into v_cash_ves, v_cash_ref
      from public.cash_movements where session_id = v_session.id;

      if v_change_method = 'efectivo_ves' and v_change_ves > v_cash_ves then
        raise exception 'No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: Bs %, vuelto: Bs %',
          v_cash_ves, v_change_ves using errcode = 'PT400';
      end if;
      if v_change_method = 'efectivo_usd' and v_change_ref > v_cash_ref then
        raise exception 'No hay suficiente efectivo en la caja para entregar el vuelto. Disponible: $ %, vuelto: $ %',
          v_cash_ref, v_change_ref using errcode = 'PT400';
      end if;

      -- Sale de la gaveta: en Bs. o en USD. El baúl no se toca.
      insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
      values (
        v_store_id, v_session.id, 'change_out',
        case when v_change_method = 'efectivo_ves' then v_change_ves else 0 end,
        case when v_change_method = 'efectivo_usd' then v_change_ref else 0 end,
        v_payment.id, v_change_notes, auth.uid()
      );
    elsif v_change_is_bank then
      -- Sale de la cuenta bancaria: caja lo refleja y el baúl (cubeta cuenta) baja.
      insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
      values (v_store_id, v_session.id, 'account_out', v_change_ves, 0, v_payment.id, v_change_notes, auth.uid());

      perform public.ensure_store_vault(v_store_id);
      select * into v_vault from public.store_vaults where store_id = v_store_id for update;
      if v_vault.balance_ves < v_change_ves then
        raise exception 'Saldo insuficiente en el baul (cuenta) para entregar el vuelto. Faltante VES: %',
          greatest(v_change_ves - v_vault.balance_ves, 0) using errcode = 'PT402';
      end if;
      update public.store_vaults
      set balance_ves = balance_ves - v_change_ves
      where id = v_vault.id;
      insert into public.vault_movements (
        store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by
      ) values (
        v_store_id, v_vault.id, 'withdrawal', 'cuenta', v_change_ves, 0, v_payment.id,
        v_change_notes, auth.uid()
      );
    end if;
  end if;

  return v_payment;
end;
$$;

revoke all on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) from public, anon;
grant execute on function public.register_payment(
  uuid, uuid, public.payment_method, numeric, text, text, text, text,
  public.payment_method, numeric, jsonb, jsonb
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. cancel_payment — guarda de rol + cancel_payment_apply (C7). Mismo
--    comportamiento que 20260904 para quien la llama por PostgREST.
-- -----------------------------------------------------------------------------

create or replace function public.cancel_payment(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_store_context();
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador') then
    raise exception 'No autorizado para anular pagos' using errcode = 'PT403';
  end if;
  return public.cancel_payment_apply(p_payment_id);
end;
$$;

revoke all on function public.cancel_payment(uuid) from public, anon;
grant execute on function public.cancel_payment(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
