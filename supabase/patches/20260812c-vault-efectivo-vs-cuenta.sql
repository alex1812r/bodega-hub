-- Separa baúl efectivo vs cuenta (VES) y registra PM/transferencia/punto en caja (cubeta cuenta).
-- balance_ves existente = cuenta bancaria (movimientos históricos se mantienen ahí).
-- balance_efectivo_ves nuevo = efectivo físico (depósitos/retiros/cierres/compras cash).

alter table public.store_vaults
  add column if not exists balance_efectivo_ves numeric(14,2) not null default 0
    check (balance_efectivo_ves >= 0);

alter table public.vault_movements
  add column if not exists bucket text not null default 'cuenta'
    check (bucket in ('efectivo', 'cuenta'));

-- Histórico: todo lo ya cargado quedó en balance_ves (cuenta).
update public.vault_movements set bucket = 'cuenta' where bucket is distinct from 'cuenta';

alter table public.cash_movements drop constraint if exists cash_movements_type_check;
alter table public.cash_movements
  add constraint cash_movements_type_check
  check (type in (
    'sale_in', 'transfer_out', 'opening', 'adjustment', 'refund_out',
    'account_in', 'account_out'
  ));

alter table public.vault_movements drop constraint if exists vault_movements_type_check;
alter table public.vault_movements
  add constraint vault_movements_type_check
  check (type in (
    'transfer_in', 'purchase_out', 'deposit', 'withdrawal', 'adjustment', 'sale_in'
  ));

create or replace function public.register_vault_deposit(
  p_amount_ves numeric, p_amount_ref numeric, p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_vault public.store_vaults;
begin
  v_store_id := public.assert_store_context();
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

create or replace function public.register_vault_withdrawal(
  p_amount_ves numeric, p_amount_ref numeric, p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_vault public.store_vaults;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un administrador puede registrar retiros del baúl';
  end if;
  if coalesce(p_amount_ves, 0) < 0 or coalesce(p_amount_ref, 0) < 0
     or (coalesce(p_amount_ves, 0) = 0 and coalesce(p_amount_ref, 0) = 0) then
    raise exception 'Debe retirar al menos un monto mayor a cero';
  end if;
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;
  if p_amount_ves > v_vault.balance_efectivo_ves or p_amount_ref > v_vault.balance_ref then
    raise exception 'Saldo insuficiente en el baul (efectivo). Disponible VES: %, REF: %',
      v_vault.balance_efectivo_ves, v_vault.balance_ref;
  end if;
  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by
  ) values (
    v_store_id, v_vault.id, 'withdrawal', 'efectivo',
    round(p_amount_ves, 2), round(p_amount_ref, 2), nullif(trim(p_notes), ''), auth.uid()
  );
  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves - round(p_amount_ves, 2),
      balance_ref = balance_ref - round(p_amount_ref, 2)
  where id = v_vault.id
  returning * into v_vault;
  return v_vault;
end;
$$;

create or replace function public.transfer_cash_closures_to_vault(
  p_session_ids uuid[],
  p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_session public.cash_sessions;
  v_vault public.store_vaults;
  v_session_id uuid;
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_notes text;
  v_transferred int := 0;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un administrador puede transferir efectivo al baúl';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    raise exception 'Selecciona al menos un cierre de caja para transferir';
  end if;

  v_notes := nullif(trim(p_notes), '');
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  foreach v_session_id in array p_session_ids loop
    select * into v_session
    from public.cash_sessions
    where id = v_session_id and store_id = v_store_id
    for update;

    if not found then raise exception 'Sesión de caja no encontrada'; end if;
    if v_session.status <> 'closed' then
      raise exception 'Solo se pueden transferir cierres. La caja sigue en circulación hasta que registres un cierre';
    end if;
    if v_session.vault_transferred_at is not null then
      raise exception 'El cierre seleccionado ya fue transferido al baúl';
    end if;
    if v_session.absorbed_by_session_id is not null then
      raise exception 'El cierre ya fue absorbido por una apertura posterior y no se puede transferir por separado';
    end if;

    v_amount_ves := round(coalesce(v_session.closing_ves, 0), 2);
    v_amount_ref := round(coalesce(v_session.closing_ref, 0), 2);
    if v_amount_ves <= 0 and v_amount_ref <= 0 then
      raise exception 'El cierre no tiene monto para transferir';
    end if;

    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, from_session_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'transfer_in', 'efectivo',
      v_amount_ves, v_amount_ref, v_session.id, v_notes, auth.uid()
    );

    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves,
        balance_ref = balance_ref + v_amount_ref
    where id = v_vault.id
    returning * into v_vault;

    update public.cash_sessions
    set vault_transferred_at = now()
    where id = v_session.id;

    v_transferred := v_transferred + 1;
  end loop;

  if v_transferred = 0 then
    raise exception 'Selecciona al menos un cierre de caja para transferir';
  end if;

  return v_vault;
end;
$$;

create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null
) returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_sale public.sales; v_purchase public.purchases; v_payment public.payments;
  v_direction public.payment_direction; v_contact_id uuid; v_rate numeric(14,4);
  v_currency public.payment_currency; v_amount_ves numeric(14,2); v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2); v_paid_ref numeric(14,2); v_session public.cash_sessions;
  v_vault public.store_vaults; v_movement_ves numeric(14,2); v_movement_ref numeric(14,2);
  v_is_bank boolean;
begin
  v_store_id := public.assert_store_context();
  if p_amount is null or p_amount <= 0 then raise exception 'El monto del pago debe ser mayor a cero'; end if;
  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra';
  end if;
  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then raise exception 'Pago Móvil requiere banco'; end if;
    if p_phone is null or length(trim(p_phone)) = 0 then raise exception 'Pago Móvil requiere teléfono'; end if;
    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then raise exception 'Pago Móvil requiere referencia de 4 dígitos'; end if;
  end if;
  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then raise exception 'Transferencia requiere banco'; end if;
    if p_reference_code is null or length(trim(p_reference_code)) = 0 then raise exception 'Transferencia requiere número de transferencia'; end if;
  end if;

  v_is_bank := p_method in ('pago_movil', 'transferencia', 'punto_venta');

  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then
      raise exception 'No autorizado para registrar pagos de ventas';
    end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada'; end if;
    v_direction := 'entrada'; v_contact_id := v_sale.customer_id; v_rate := v_sale.ref_rate_ves;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;
    update public.sales set paid_ves = paid_ves + v_amount_ves,
      status = case when paid_ves + v_amount_ves >= total_ves then 'pagada'::public.sale_status else 'pendiente_pago'::public.sale_status end
    where id = p_sale_id returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then
      raise exception 'No autorizado para registrar pagos a proveedores';
    end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada'; end if;
    v_direction := 'salida'; v_contact_id := v_purchase.supplier_id;
    select rate_ves into v_rate from public.exchange_rates where store_id = v_store_id order by created_at desc limit 1;
    if v_rate is null or v_rate <= 0 then v_rate := v_purchase.ref_rate_ves; end if;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;
    update public.purchases set paid_ves = paid_ves + v_amount_ves, paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
  end if;

  insert into public.payments (
    direction, sale_id, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref,
    ref_rate_ves, bank_name, phone, reference_code, notes, created_by, store_id
  ) values (
    v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id
  ) returning * into v_payment;

  -- Efectivo venta → solo caja (físico).
  if p_method in ('efectivo_ves', 'efectivo_usd') and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada';
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
          greatest(v_movement_ves - v_vault.balance_efectivo_ves, 0);
      else
        raise exception 'Saldo insuficiente en el baul. Faltante REF: %',
          greatest(v_movement_ref - v_vault.balance_ref, 0);
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
      raise exception 'No puede registrar pago móvil/transferencia/punto: no hay sesión de caja abierta';
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
        greatest(v_payment.amount_ves - v_vault.balance_ves, 0);
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

  return v_payment;
end;
$$;

create or replace function public.cancel_payment(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_payment public.payments; v_sale public.sales; v_purchase public.purchases;
  v_vault public.store_vaults; v_vault_movement public.vault_movements;
  v_new_paid_ves numeric(14,2); v_new_paid_ref numeric(14,2);
  v_is_bank boolean;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() not in ('admin', 'contador') then
    raise exception 'No autorizado para anular pagos';
  end if;
  select * into v_payment from public.payments where id = p_payment_id and store_id = v_store_id for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if v_payment.status = 'anulado' then raise exception 'El pago ya fue anulado'; end if;

  v_is_bank := v_payment.method in ('pago_movil', 'transferencia', 'punto_venta');

  if v_payment.sale_id is not null then
    select * into v_sale from public.sales where id = v_payment.sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada'; end if;
    if v_sale.status in ('cancelada', 'devuelta') then
      raise exception 'No se puede anular un pago de una venta cancelada o devuelta';
    end if;
    if v_sale.paid_ves < v_payment.amount_ves then
      raise exception 'El monto del pago excede lo registrado en la venta';
    end if;
    v_new_paid_ves := v_sale.paid_ves - v_payment.amount_ves;
    update public.sales set paid_ves = v_new_paid_ves, status = case
      when v_sale.status = 'borrador' then v_sale.status
      when v_new_paid_ves >= v_sale.total_ves then 'pagada'::public.sale_status
      else 'pendiente_pago'::public.sale_status end where id = v_payment.sale_id;

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
    if not found then raise exception 'Compra no encontrada'; end if;
    if v_purchase.status in ('cancelado', 'devuelto') then
      raise exception 'No se puede anular un pago de una compra cancelada o devuelta';
    end if;
    if v_purchase.paid_ves < v_payment.amount_ves then
      raise exception 'El monto del pago excede lo registrado en la compra';
    end if;
    if coalesce(v_purchase.paid_ref, 0) < v_payment.amount_ref then
      raise exception 'El monto REF del pago excede lo registrado en la compra';
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
        if not found then raise exception 'Baúl no encontrado para revertir el pago en efectivo'; end if;
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

notify pgrst, 'reload schema';
