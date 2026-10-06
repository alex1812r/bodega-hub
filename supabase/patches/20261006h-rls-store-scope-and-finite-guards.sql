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
--   N3   store_vaults, vault_movements, cash_movements y cash_sessions dejan de
--        ser escribibles por PostgREST (como C17 en 20261006a): sin privilegios
--        de insert / update / delete / truncate para anon y authenticated y sin
--        las politicas "Admins manage …". El BFF no las escribe con la sesion del
--        usuario (solo las lee y llama a las RPC, que escriben como propietario).
--        Ninguna funcion de caja cambia por este punto.
--   N4   'NaN'::numeric no es menor que 0, cumple los check ">= 0" y cabe en
--        numeric(14,2): atravesaba las guardas de los parametros numeric sueltos
--        (los montos dentro del jsonb ya los valida R6). Nueva funcion interna
--        assert_finite_numeric(valor, campo): PT400 si el valor es NaN o
--        +-Infinity. La llaman, justo despues de assert_store_context(),
--        create_sale, create_sale_with_payments, create_purchase,
--        update_product_price, register_supplier_product_price,
--        register_payment y, del barrido del resto de RPC con numeric de entrada,
--        close_cash_session (cerraba la sesion con contado NaN y asentaba la
--        diferencia NaN) y register_vault_deposit (dejaba el saldo del baul en
--        NaN). En esas dos la UNICA linea nueva es la guarda. No se anaden
--        constraints a las tablas.
--   N6   update_product_price, register_supplier_product_price y
--        deactivate_supplier_product comparan el rol con coalesce y responden
--        PT403 (antes P0001: el BFF contestaba 400).
--   R5c  cancel_payment_apply bloquea (for share) la sesion de caja abierta del
--        pago antes de evaluar F4 y de borrar cash_movements, con el patron de
--        R5 en register_payment: close_cash_session y el autocierre la toman for
--        update, asi que la anulacion espera al cierre y F4 se evalua despues,
--        con el cierre y su transferencia al baul ya confirmados (PT409). Orden
--        de bloqueo: documento -> pago -> sesion de caja -> baul, el mismo de
--        register_payment. Solo se bloquea la sesion ABIERTA: bloquear tambien
--        los cierres cruzaria con transfer_cash_closures_to_vault, que toma baul
--        -> sesion (13-rpc-review N8, abierto).
--
-- Redefine completas, partiendo de su version vigente y con el cambio minimo:
--   create_sale, create_sale_with_payments y create_purchase (20261006f),
--   register_payment, update_product_price, register_supplier_product_price,
--   deactivate_supplier_product y cancel_payment_apply (20261006g),
--   close_cash_session (20260904b) y register_vault_deposit (20260812c).
--   Ninguna firma cambia.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- Reaplicar 20261006b, c, f o g, 20260904b o 20260812c reinstala las versiones
-- anteriores de esas RPC: volver a aplicar este parche despues.
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

-- -----------------------------------------------------------------------------
-- 3. N3 — caja y baul solo se escriben por las RPC security definer (escriben
--    como propietario). Quedan las politicas de lectura de 20260811b. El BFF no
--    hace insert / update / delete sobre estas cuatro tablas con la sesion del
--    usuario (src/modules/cash y src/modules/vault solo las leen), asi que no se
--    conserva ningun privilegio de escritura por columnas.
-- -----------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on public.store_vaults, public.vault_movements, public.cash_movements, public.cash_sessions
  from public, anon, authenticated;

drop policy if exists "Admins manage store vault" on public.store_vaults;
drop policy if exists "Admins manage vault movements" on public.vault_movements;
drop policy if exists "Admins manage cash movements" on public.cash_movements;
drop policy if exists "Admins manage cash sessions" on public.cash_sessions;

-- -----------------------------------------------------------------------------
-- 4. N4 — guarda unica de numeros finitos. NULL pasa: cada RPC ya decide que
--    hace con un parametro ausente. Interna: solo la llaman las RPC security
--    definer (como propietario).
-- -----------------------------------------------------------------------------

create or replace function public.assert_finite_numeric(p_value numeric, p_field text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value = 'NaN'::numeric or p_value = 'Infinity'::numeric or p_value = '-Infinity'::numeric then
    raise exception using
      errcode = 'PT400',
      message = format('Valor numerico invalido en %s: debe ser un numero finito', p_field);
  end if;
end;
$$;

revoke all on function public.assert_finite_numeric(numeric, text) from public, anon, authenticated;
grant execute on function public.assert_finite_numeric(numeric, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. create_sale — copia de 20261006f + N4. Misma firma.
-- -----------------------------------------------------------------------------

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
  v_constraint text;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_ref_rate_ves, 'la tasa ref/VES');
  perform public.assert_finite_numeric(p_discount_ref, 'el descuento');
  perform public.assert_finite_numeric(p_tax_ref, 'el impuesto');
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

  -- R6 — forma de cada linea antes de convertirla: un uuid, un entero o un
  -- precio mal escritos salian como 22P02 / 22003 crudos.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'PT400', message = 'Identificador de producto invalido en item de venta';
    end if;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,9}$' then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de venta';
    end if;

    if (v_item ->> 'unit_price_ref') is not null
       and (v_item ->> 'unit_price_ref') !~ '^-?[0-9]{1,10}([.][0-9]+)?$' then
      raise exception using errcode = 'PT400', message = 'Precio unitario invalido en item de venta';
    end if;
  end loop;

  if coalesce(p_discount_ref, 0) < 0 or coalesce(p_tax_ref, 0) < 0 then
    raise exception using errcode = 'PT400', message = 'El descuento y el impuesto no pueden ser negativos';
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
exception
  -- R6 — tasa, precio x cantidad o totales que no caben en sus columnas.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Alguna cantidad o monto de la venta esta fuera del rango permitido';
  -- R6 — numero de factura repetido en la tienda. Cualquier otro choque sigue igual.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'sales_store_invoice_unique' then
      raise exception using
        errcode = 'PT409',
        message = format('Ya existe una venta con el numero de factura %s', p_invoice_number);
    end if;
    raise;
end;
$$;

revoke all on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.create_sale(uuid, jsonb, uuid, numeric, numeric, numeric, text, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. create_sale_with_payments — copia de 20261006f + N4. Misma firma.
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
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_ref_rate_ves, 'la tasa ref/VES');
  perform public.assert_finite_numeric(p_discount_ref, 'el descuento');
  perform public.assert_finite_numeric(p_tax_ref, 'el impuesto');

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

  -- R6 — forma de cada pago antes de convertirlo (metodo y montos): un metodo
  -- desconocido o un monto mal escrito salian como 22P02 crudo.
  for v_payment in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    if jsonb_typeof(v_payment) is distinct from 'object' then
      raise exception using errcode = 'PT400', message = 'Cada pago de la venta debe ser un objeto';
    end if;

    if coalesce(v_payment ->> 'method', '') <> all (enum_range(null::public.payment_method)::text[]) then
      raise exception using errcode = 'PT400', message = 'Metodo de pago invalido';
    end if;

    if coalesce(v_payment ->> 'amount', '') !~ '^-?[0-9]{1,10}([.][0-9]+)?$' then
      raise exception using errcode = 'PT400', message = 'Monto de pago invalido';
    end if;

    if (v_payment ->> 'change_amount') is not null
       and (v_payment ->> 'change_amount') !~ '^-?[0-9]{1,10}([.][0-9]+)?$' then
      raise exception using errcode = 'PT400', message = 'Monto del vuelto invalido';
    end if;

    -- El metodo del vuelto solo se usa cuando hay vuelto (igual que abajo).
    if coalesce((v_payment ->> 'change_amount')::numeric, 0) > 0
       and (v_payment ->> 'change_method') is not null
       and (v_payment ->> 'change_method') <> all (enum_range(null::public.payment_method)::text[]) then
      raise exception using errcode = 'PT400', message = 'Metodo del vuelto invalido';
    end if;
  end loop;

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
exception
  -- R6 — un monto de pago que no cabe en sus columnas al convertirlo a Bs / REF.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Algun monto del cobro esta fuera del rango permitido';
end;
$$;

revoke all on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) from public, anon;
grant execute on function public.create_sale_with_payments(
  uuid, jsonb, jsonb, uuid, numeric, numeric, numeric, text, text, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. create_purchase — copia de 20261006f + N4. Misma firma.
-- -----------------------------------------------------------------------------

create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_purchase_number text default null,
  p_status public.purchase_status default 'recibido',
  p_discount_ves numeric default null,
  p_tax_ves numeric default null,
  p_subtotal_ves numeric default null,
  p_subtotal_ref numeric default null,
  p_client_request_id uuid default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate numeric(14,4);
  v_purchase public.purchases;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_product_ids uuid[];
  v_quantity integer;
  v_unit_cost_ref numeric(12,2);
  v_unit_cost_ves numeric(14,2);
  v_cost_with_tax_ref numeric(12,2);
  v_cost_with_tax_ves numeric(14,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_discount_ref numeric(14,2);
  v_discount_ves numeric(14,2);
  v_tax_ref numeric(14,2);
  v_tax_ves numeric(14,2);
  v_subtotal_ref numeric(14,2);
  v_subtotal_ves numeric(14,2);
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_supplier_sku text;
  v_sp_id uuid;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_entry_mode text;
  v_pack_label text;
  v_pack_count integer;
  v_units_per_pack integer;
  v_pack_cost_ref numeric(12,2);
  v_pack_cost_ves numeric(14,2);
  v_tax_rate numeric(5,2);
  v_line_tax_ref numeric(14,2);
  v_line_tax_ves numeric(14,2);
  v_cost_currency text;
  v_pair_units integer;
  v_request_hash text;
  v_number_seq bigint;
  v_rows integer;
  v_constraint text;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_ref_rate_ves, 'la tasa ref/VES');
  perform public.assert_finite_numeric(p_discount_ref, 'el descuento');
  perform public.assert_finite_numeric(p_tax_ref, 'el impuesto');
  perform public.assert_finite_numeric(p_discount_ves, 'el descuento en Bs');
  perform public.assert_finite_numeric(p_tax_ves, 'el impuesto en Bs');
  perform public.assert_finite_numeric(p_subtotal_ves, 'el subtotal en Bs');
  perform public.assert_finite_numeric(p_subtotal_ref, 'el subtotal');

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para crear compras';
  end if;

  -- C6 — reintento del mismo envio. El advisory lock serializa dos peticiones
  -- simultaneas con la misma clave: la segunda espera el commit de la primera y
  -- encuentra su compra (nunca llega al indice unico).
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('purchase-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'create_purchase',
      p_supplier_id,
      p_items,
      p_status,
      round(coalesce(p_discount_ref, 0), 2)::text,
      round(coalesce(p_tax_ref, 0), 2)::text,
      round(p_discount_ves, 2)::text,
      round(p_tax_ves, 2)::text,
      round(p_subtotal_ves, 2)::text,
      round(p_subtotal_ref, 2)::text
    ));
    v_purchase := public.purchase_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_purchase.id is not null then
      return v_purchase;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'La compra debe tener al menos un item';
  end if;

  -- R6 — forma de cada linea antes de convertirla: un uuid, un entero o un
  -- monto mal escritos salian como 22P02 crudo. Las cantidades se miran segun
  -- el modo de la linea, igual que en el bucle de abajo.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'PT400', message = 'Identificador de producto invalido en item de compra';
    end if;

    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');

    if exists (
      select 1
      from unnest(
        array['unit_cost_ref', 'unit_cost_ves', 'subtotal_ref', 'subtotal_ves', 'tax_rate', 'tax_ref', 'tax_ves']
        || case when v_entry_mode = 'pack' then array['pack_cost_ref', 'pack_cost_ves'] else array[]::text[] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,12}([.][0-9]+)?$'
    ) then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if exists (
      select 1
      from unnest(
        case when v_entry_mode = 'pack' then array['pack_count', 'units_per_pack'] else array['quantity'] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,9}$'
    ) then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
    end if;
  end loop;

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

  if p_status is null or p_status not in ('pedido', 'recibido') then
    raise exception using errcode = 'PT400', message = 'Solo se puede crear una compra en estado pedido o recibido';
  end if;

  if p_discount_ves is null or p_tax_ves is null or p_subtotal_ves is null or p_subtotal_ref is null then
    raise exception using
      errcode = 'PT400',
      message = 'Debe enviar subtotal/descuento/impuesto en REF y VES desde el cliente';
  end if;

  v_discount_ref := coalesce(p_discount_ref, 0);
  v_discount_ves := p_discount_ves;
  v_tax_ref := coalesce(p_tax_ref, 0);
  v_tax_ves := p_tax_ves;
  v_subtotal_ref := p_subtotal_ref;
  v_subtotal_ves := p_subtotal_ves;

  if v_discount_ref < 0 or v_discount_ves < 0 or v_tax_ref < 0 or v_tax_ves < 0
     or v_subtotal_ref < 0 or v_subtotal_ves < 0 then
    raise exception using errcode = 'PT400', message = 'Totales de compra invalidos';
  end if;

  perform public.assert_contact_type(p_supplier_id, array['proveedor', 'ambos']::public.contact_type[]);

  if not exists (
    select 1
    from public.contacts
    where id = p_supplier_id
      and store_id = v_store_id
  ) then
    raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
  end if;

  -- C11 — el numero por defecto sale de una secuencia: dos compras en el mismo
  -- milisegundo ya no chocan en purchases_store_number_unique.
  if p_purchase_number is null then
    v_number_seq := nextval('public.purchases_number_seq');
  end if;

  insert into public.purchases (
    purchase_number,
    supplier_id,
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
      p_purchase_number,
      'C-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-'
        || lpad(v_number_seq::text, greatest(6, length(v_number_seq::text)), '0')
    ),
    p_supplier_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    v_discount_ref,
    v_tax_ref,
    p_status,
    p_notes,
    v_store_id,
    p_client_request_id,
    case when p_client_request_id is not null then v_request_hash end
  )
  returning * into v_purchase;

  -- Documento primero; despues TODOS los productos de la compra en una sola
  -- sentencia y en orden fijo.
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
    v_supplier_sku := v_item ->> 'supplier_sku';
    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');
    v_cost_currency := coalesce(nullif(trim(v_item ->> 'cost_currency'), ''), 'ves');

    if v_cost_currency not in ('ves', 'ref') then
      raise exception using errcode = 'PT400', message = 'cost_currency invalido en item de compra';
    end if;

    v_unit_cost_ref := (v_item ->> 'unit_cost_ref')::numeric;
    v_unit_cost_ves := (v_item ->> 'unit_cost_ves')::numeric;
    v_line_subtotal_ref := (v_item ->> 'subtotal_ref')::numeric;
    v_line_subtotal_ves := (v_item ->> 'subtotal_ves')::numeric;
    v_tax_rate := (v_item ->> 'tax_rate')::numeric;
    v_line_tax_ref := (v_item ->> 'tax_ref')::numeric;
    v_line_tax_ves := (v_item ->> 'tax_ves')::numeric;

    if v_unit_cost_ref is null or v_unit_cost_ves is null
       or v_line_subtotal_ref is null or v_line_subtotal_ves is null
       or v_tax_rate is null or v_line_tax_ref is null or v_line_tax_ves is null then
      raise exception using
        errcode = 'PT400',
        message = 'Cada item debe enviar costos/subtotales/impuesto en REF y VES';
    end if;

    if v_unit_cost_ref < 0 or v_unit_cost_ves < 0
       or v_line_subtotal_ref < 0 or v_line_subtotal_ves < 0
       or v_tax_rate < 0 or v_tax_rate > 100
       or v_line_tax_ref < 0 or v_line_tax_ves < 0 then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if v_entry_mode = 'pack' then
      v_pack_label := nullif(trim(v_item ->> 'pack_label'), '');
      v_pack_count := (v_item ->> 'pack_count')::integer;
      v_units_per_pack := (v_item ->> 'units_per_pack')::integer;
      v_pack_cost_ref := (v_item ->> 'pack_cost_ref')::numeric;
      v_pack_cost_ves := (v_item ->> 'pack_cost_ves')::numeric;

      if v_pack_label is null
         or v_pack_count is null or v_pack_count <= 0
         or v_units_per_pack is null or v_units_per_pack <= 0
         or v_pack_cost_ref is null or v_pack_cost_ves is null
         or v_pack_cost_ref < 0 or v_pack_cost_ves < 0 then
        raise exception using
          errcode = 'PT400',
          message = 'Item pack incompleto: requiere label, conteos y pack_cost REF+VES';
      end if;

      -- C13 — si el producto pertenece a un par empaque -> unidad activo, las
      -- unidades por empaque las fija el par, no el cliente.
      select c.units_per_pack into v_pair_units
      from public.product_pack_conversions c
      where c.unit_product_id = v_product_id
        and c.store_id = v_store_id
        and c.is_active = true;

      if found then
        -- El producto es la UNIDAD del par: entran pack_count x unidades del par.
        if v_units_per_pack <> v_pair_units then
          raise exception using
            errcode = 'PT400',
            message = format(
              'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
              v_units_per_pack, v_pair_units
            );
        end if;

        v_quantity := v_pack_count * v_units_per_pack;
      else
        select c.units_per_pack into v_pair_units
        from public.product_pack_conversions c
        where c.pack_product_id = v_product_id
          and c.store_id = v_store_id
          and c.is_active = true;

        if found then
          if v_units_per_pack <> v_pair_units then
            raise exception using
              errcode = 'PT400',
              message = format(
                'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
                v_units_per_pack, v_pair_units
              );
          end if;

          -- El producto ES el empaque: su stock se cuenta en empaques. Entran
          -- pack_count empaques al costo del empaque y la linea se guarda en
          -- modo unidad (quantity = empaques), que es lo que leen
          -- receive_purchase y la vista purchases_without_movements.
          v_quantity := v_pack_count;
          v_unit_cost_ref := v_pack_cost_ref;
          v_unit_cost_ves := v_pack_cost_ves;
          v_entry_mode := 'unit';
          v_pack_label := null;
          v_pack_count := null;
          v_units_per_pack := null;
          v_pack_cost_ref := null;
          v_pack_cost_ves := null;
        else
          v_quantity := v_pack_count * v_units_per_pack;
        end if;
      end if;
    else
      v_entry_mode := 'unit';
      v_pack_label := null;
      v_pack_count := null;
      v_units_per_pack := null;
      v_pack_cost_ref := null;
      v_pack_cost_ves := null;
      v_quantity := (v_item ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
      end if;
    end if;

    -- Costo unitario final del producto: neto + IVA de esta linea (0% = exento).
    v_cost_with_tax_ref := round(v_unit_cost_ref * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);
    v_cost_with_tax_ves := round(v_unit_cost_ves * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado: %s', v_product_id);
    end if;

    insert into public.purchase_items (
      purchase_id,
      product_id,
      quantity,
      unit_cost_ref,
      unit_cost_ves,
      subtotal_ref,
      subtotal_ves,
      entry_mode,
      pack_label,
      pack_count,
      units_per_pack,
      pack_cost_ref,
      pack_cost_ves,
      tax_rate,
      tax_ref,
      tax_ves,
      cost_currency
    )
    values (
      v_purchase.id,
      v_product_id,
      v_quantity,
      v_unit_cost_ref,
      v_unit_cost_ves,
      v_line_subtotal_ref,
      v_line_subtotal_ves,
      v_entry_mode,
      v_pack_label,
      v_pack_count,
      v_units_per_pack,
      v_pack_cost_ref,
      v_pack_cost_ves,
      v_tax_rate,
      v_line_tax_ref,
      v_line_tax_ves,
      v_cost_currency
    );

    if p_status = 'recibido' then
      update public.products
      set current_cost_ref = v_cost_with_tax_ref
      where id = v_product_id
        and store_id = v_store_id;

      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception using
          errcode = 'PT409',
          message = format('No se pudo actualizar el costo del producto %s', v_product_id);
      end if;

      select id, last_cost_ref, last_cost_ves
      into v_sp_id, v_old_cost_ref, v_old_cost_ves
      from public.supplier_products
      where supplier_id = p_supplier_id
        and product_id = v_product_id
        and store_id = v_store_id;

      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        last_purchased_at,
        store_id
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        now(),
        v_store_id
      )
      on conflict (supplier_id, product_id)
      do update set
        supplier_sku = coalesce(excluded.supplier_sku, public.supplier_products.supplier_sku),
        last_cost_ref = excluded.last_cost_ref,
        last_cost_ves = excluded.last_cost_ves,
        last_purchased_at = excluded.last_purchased_at,
        is_active = true,
        updated_at = now()
      returning id into v_sp_id;

      perform public.append_supplier_product_price_history(
        v_sp_id,
        v_old_cost_ref,
        v_old_cost_ves,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        'compra',
        'Compra ' || v_purchase.purchase_number
      );

      -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
      -- actualiza el stock del producto.
      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_product_id,
        'compra',
        v_quantity,
        v_purchase.id,
        'Compra ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    end if;
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - v_discount_ref + v_tax_ref, 2), 0);
  v_total_ves := greatest(round(v_subtotal_ves - v_discount_ves + v_tax_ves, 2), 0);

  update public.purchases
  set subtotal_ref = v_subtotal_ref,
      subtotal_ves = v_subtotal_ves,
      discount_ves = v_discount_ves,
      tax_ves = v_tax_ves,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
exception
  -- R6 — tasa, costos, empaques x unidades o totales que no caben en sus columnas.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Alguna cantidad o monto de la compra esta fuera del rango permitido';
  -- R6 — numero de compra repetido en la tienda. Cualquier otro choque sigue igual.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'purchases_store_number_unique' then
      raise exception using
        errcode = 'PT409',
        message = format('Ya existe una compra con el numero %s', p_purchase_number);
    end if;
    raise;
end;
$$;

revoke all on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) from public, anon;
grant execute on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. register_payment — copia de 20261006g + N4. Misma firma de 12 argumentos.
--    Nada mas cambia (caja y baul intactos).
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
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_amount, 'el monto del pago');
  perform public.assert_finite_numeric(p_change_amount, 'el monto del vuelto');
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
    if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas' using errcode = 'PT403';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada' using errcode = 'PT404'; end if;
    -- C8 — una venta cancelada o devuelta no admite cobros: el pago la devolvia a
    -- pendiente_pago y permitia devolverla (y reponer stock) otra vez.
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede registrar un pago en una venta cancelada o devuelta' using errcode = 'PT409';
    end if;
    -- R17 — ni un borrador (la misma guarda de return_sale): el cobro lo pasaba a
    -- pendiente_pago / pagada sin que su stock hubiera salido nunca.
    if v_sale.status not in ('pagada', 'pendiente_pago') then
      raise exception 'No se puede registrar un pago en una venta en borrador' using errcode = 'PT409';
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
    if coalesce(public.current_user_role()::text, '') not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores' using errcode = 'PT403';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada' using errcode = 'PT404'; end if;
    -- C8 (rama de compras) — una compra cancelada o devuelta no admite pagos.
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede registrar un pago en una compra cancelada o devuelta' using errcode = 'PT409';
    end if;
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
    -- R5 — la sesion se bloquea antes de escribir en cash_movements y se revalida
    -- que siga abierta: close_cash_session y el autocierre la toman for update,
    -- asi que o el cierre espera a este cobro y lo incluye, o el cobro espera al
    -- cierre y se rechaza. Orden: documento -> productos -> pago -> sesion -> baul.
    select * into v_session from public.cash_sessions
    where id = v_session.id and status = 'open' for share;
    if not found then
      raise exception 'La sesión de caja se cerró mientras se registraba el cobro. Abre la caja y vuelve a intentarlo'
        using errcode = 'PT409';
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
    -- R5 — la sesion se bloquea antes de escribir en cash_movements y se revalida
    -- que siga abierta: close_cash_session y el autocierre la toman for update,
    -- asi que o el cierre espera a este cobro y lo incluye, o el cobro espera al
    -- cierre y se rechaza. Orden: documento -> productos -> pago -> sesion -> baul.
    select * into v_session from public.cash_sessions
    where id = v_session.id and status = 'open' for share;
    if not found then
      raise exception 'La sesión de caja se cerró mientras se registraba el cobro. Abre la caja y vuelve a intentarlo'
        using errcode = 'PT409';
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
-- 9. update_product_price — copia de 20261006g + N4 + N6
-- -----------------------------------------------------------------------------

create or replace function public.update_product_price(
  p_product_id uuid,
  p_new_sale_price_ref numeric,
  p_reason text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_old_price numeric(12,2);
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_new_sale_price_ref, 'el precio de venta');

  -- N6 — rol nulo = no autorizado, y PT403 en vez de P0001.
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  if p_new_sale_price_ref < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  v_old_price := v_product.sale_price_ref;

  update public.products
  set sale_price_ref = p_new_sale_price_ref
  where id = p_product_id
    and store_id = v_store_id
  returning * into v_product;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by
  )
  values (
    p_product_id,
    v_old_price,
    p_new_sale_price_ref,
    p_reason,
    auth.uid()
  );

  return v_product;
end;
$$;

revoke all on function public.update_product_price(uuid, numeric, text) from public, anon;
grant execute on function public.update_product_price(uuid, numeric, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. register_supplier_product_price — copia de 20261006g + N4 + N6.
--    Misma firma de 7 argumentos.
-- -----------------------------------------------------------------------------

create or replace function public.register_supplier_product_price(
  p_supplier_product_id uuid,
  p_new_cost_ref numeric,
  p_new_cost_ves numeric,
  p_origin text,
  p_notes text default null,
  p_new_pack_cost_ref numeric default null,
  p_price_input_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sp public.supplier_products;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_variation_percent numeric(8,2);
  v_history_id uuid;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_new_cost_ref, 'el costo');
  perform public.assert_finite_numeric(p_new_cost_ves, 'el costo en Bs');
  perform public.assert_finite_numeric(p_new_pack_cost_ref, 'el costo del empaque');

  -- N6 — rol nulo = no autorizado, y PT403 en vez de P0001.
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para registrar precios de proveedor';
  end if;

  if p_new_cost_ref is null or p_new_cost_ref < 0 then
    raise exception 'El costo no puede ser negativo';
  end if;

  if p_origin not in ('cotizacion', 'compra', 'ajuste', 'vinculacion') then
    raise exception 'Origen de precio invalido';
  end if;

  if p_price_input_mode is not null and p_price_input_mode not in ('unit', 'pack') then
    raise exception 'Modo de precio invalido';
  end if;

  if p_price_input_mode = 'pack' and (p_new_pack_cost_ref is null or p_new_pack_cost_ref < 0) then
    raise exception 'Indica un precio de empaque valido';
  end if;

  select * into v_sp
  from public.supplier_products
  where id = p_supplier_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Relacion proveedor-producto no encontrada';
  end if;

  if not v_sp.is_active then
    raise exception 'No se puede registrar precio en una relacion inactiva';
  end if;

  v_old_cost_ref := v_sp.last_cost_ref;
  v_old_cost_ves := v_sp.last_cost_ves;

  v_history_id := public.append_supplier_product_price_history(
    p_supplier_product_id,
    v_old_cost_ref,
    v_old_cost_ves,
    p_new_cost_ref,
    p_new_cost_ves,
    p_origin,
    p_notes
  );

  update public.supplier_products
  set last_cost_ref = p_new_cost_ref,
      last_cost_ves = p_new_cost_ves,
      last_pack_cost_ref = case
        when p_price_input_mode = 'pack' then p_new_pack_cost_ref
        when p_price_input_mode = 'unit' then null
        else last_pack_cost_ref
      end,
      last_purchased_at = case when p_origin = 'compra' then now() else last_purchased_at end,
      updated_at = now()
  where id = p_supplier_product_id
    and store_id = v_store_id
  returning * into v_sp;

  if not found then
    raise exception using errcode = 'PT404', message = 'Relacion proveedor-producto no encontrada';
  end if;

  if v_old_cost_ref is not null and v_old_cost_ref > 0 then
    v_variation_percent := round(((p_new_cost_ref - v_old_cost_ref) / v_old_cost_ref) * 100, 2);
  else
    v_variation_percent := null;
  end if;

  return jsonb_build_object(
    'supplier_product', to_jsonb(v_sp),
    'variation_percent', v_variation_percent,
    'history_id', v_history_id
  );
end;
$$;

revoke all on function public.register_supplier_product_price(uuid, numeric, numeric, text, text, numeric, text)
  from public, anon;
grant execute on function public.register_supplier_product_price(uuid, numeric, numeric, text, text, numeric, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. deactivate_supplier_product — copia de 20261006g + N6
-- -----------------------------------------------------------------------------

create or replace function public.deactivate_supplier_product(p_id uuid)
returns public.supplier_products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_sp public.supplier_products;
begin
  v_store_id := public.assert_store_context();

  -- N6 — rol nulo = no autorizado, y PT403 en vez de P0001.
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para desactivar relaciones proveedor-producto';
  end if;

  update public.supplier_products
  set is_active = false,
      updated_at = now()
  where id = p_id
    and store_id = v_store_id
  returning * into v_sp;

  if not found then
    raise exception using errcode = 'PT404', message = 'Relacion proveedor-producto no encontrada';
  end if;

  return v_sp;
end;
$$;

revoke all on function public.deactivate_supplier_product(uuid) from public, anon;
grant execute on function public.deactivate_supplier_product(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. cancel_payment_apply — copia de 20261006g + R5c (bloqueo de la sesion de caja
--    abierta antes de F4). Sigue sin execute por /rpc.
-- -----------------------------------------------------------------------------

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

  -- R5c — antes de evaluar F4 y de borrar cash_movements se bloquea la sesion
  -- abierta del pago, como hace register_payment (R5): close_cash_session y el
  -- autocierre la toman for update, asi que la anulacion espera al cierre y F4
  -- se evalua despues, con el cierre y su transferencia al baul ya confirmados.
  -- Orden: documento -> pago -> sesion -> baul.
  perform 1 from public.cash_sessions s
  where s.store_id = v_store_id
    and s.status = 'open'
    and s.id in (
      select m.session_id from public.cash_movements m
      where m.payment_id = v_payment.id and m.store_id = v_store_id
    )
  order by s.id
  for share;

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
        -- R7 — sin baul el update no tocaba nada y el asiento se borraba igual.
        if not found then raise exception 'Baúl no encontrado para revertir el cobro en cuenta' using errcode = 'PT404'; end if;
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
        -- R7 — sin baul el update no tocaba nada y el asiento se borraba igual.
        if not found then raise exception 'Baúl no encontrado para revertir el pago desde cuenta' using errcode = 'PT404'; end if;
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

revoke all on function public.cancel_payment_apply(uuid) from public, anon, authenticated;
grant execute on function public.cancel_payment_apply(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 13. close_cash_session — copia de 20260904b + N4 (unica linea nueva: la guarda)
-- -----------------------------------------------------------------------------

create or replace function public.close_cash_session(
  p_session_id uuid, p_closing_ves numeric, p_closing_ref numeric
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_session public.cash_sessions;
  v_ves numeric(14,2); v_ref numeric(14,2);
  v_counted_ves numeric(14,2); v_counted_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_closing_ves, 'el monto de cierre en Bs');
  perform public.assert_finite_numeric(p_closing_ref, 'el monto de cierre en REF');
  if p_closing_ves is null or p_closing_ref is null or p_closing_ves < 0 or p_closing_ref < 0 then
    raise exception 'Los montos de cierre deben ser válidos y no negativos';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id and store_id = v_store_id for update;
  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if v_session.status <> 'open' then raise exception 'La sesión de caja ya está cerrada'; end if;
  if public.current_user_role() <> 'admin' and v_session.opened_by is distinct from auth.uid() then
    raise exception 'Solo quien abrió la caja o un administrador puede cerrarla';
  end if;

  select round(v_session.opening_ves + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ves
           when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
         round(v_session.opening_ref + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ref
           when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
  into v_ves, v_ref
  from public.cash_movements where session_id = v_session.id;

  v_counted_ves := round(p_closing_ves, 2);
  v_counted_ref := round(p_closing_ref, 2);

  -- Sobrante / faltante como movimiento auditable, antes de cerrar la sesión.
  perform public.record_cash_close_difference(
    v_store_id, v_session.id, v_counted_ves, v_counted_ref, v_ves, v_ref,
    coalesce(auth.uid(), v_session.opened_by), 'Cuadre de cierre manual'
  );

  update public.cash_sessions set status = 'closed', closing_ves = v_counted_ves,
    closing_ref = v_counted_ref, theoretical_closing_ves = v_ves,
    theoretical_closing_ref = v_ref, closed_by = auth.uid(), closed_at = now(),
    closed_reason = 'manual'
  where id = v_session.id returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.close_cash_session(uuid, numeric, numeric) from public, anon;
grant execute on function public.close_cash_session(uuid, numeric, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 14. register_vault_deposit — copia de 20260812c + N4 (unica linea nueva: la guarda)
-- -----------------------------------------------------------------------------

create or replace function public.register_vault_deposit(
  p_amount_ves numeric, p_amount_ref numeric, p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_vault public.store_vaults;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_amount_ves, 'el monto en Bs');
  perform public.assert_finite_numeric(p_amount_ref, 'el monto en REF');
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un administrador puede registrar depósitos en el baúl';
  end if;
  if coalesce(p_amount_ves, 0) < 0 or coalesce(p_amount_ref, 0) < 0
     or (coalesce(p_amount_ves, 0) = 0 and coalesce(p_amount_ref, 0) = 0) then
    raise exception 'Debe registrar al menos un monto mayor a cero';
  end if;
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;
  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by
  ) values (
    v_store_id, v_vault.id, 'deposit', 'efectivo',
    round(p_amount_ves, 2), round(p_amount_ref, 2), nullif(trim(p_notes), ''), auth.uid()
  );
  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + round(p_amount_ves, 2),
      balance_ref = balance_ref + round(p_amount_ref, 2)
  where id = v_vault.id
  returning * into v_vault;
  return v_vault;
end;
$$;

revoke all on function public.register_vault_deposit(numeric, numeric, text) from public, anon;
grant execute on function public.register_vault_deposit(numeric, numeric, text) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
