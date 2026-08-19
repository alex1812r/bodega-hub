-- =============================================================================
-- 20260816 — One-shot: corrige pago venta V-20260816003248078
-- Error: efectivo_ves → real: efectivo_usd $3 + vuelto Bs 23.13 por pago movil.
-- Idempotente si payment.method ya es efectivo_usd y amount_ref=3.
-- =============================================================================

do $$
declare
  v_sale public.sales%rowtype;
  v_payment public.payments%rowtype;
  v_vault public.store_vaults%rowtype;
  v_marker text := 'FIX_PAYMENT:V-20260816003248078';
  v_rate numeric(14,4);
  v_amount_ref numeric(14,2) := 3;
  v_amount_ves numeric(14,2);
  v_change_ves numeric(14,2);
begin
  select * into v_sale
  from public.sales
  where id = '66382491-dfc9-4e75-ae5e-96f3290b24af'
  for update;
  if not found then raise exception 'Venta no encontrada'; end if;

  select * into v_payment
  from public.payments
  where id = '0a65516a-ec25-4585-a6f4-377d4705459c'
    and sale_id = v_sale.id
  for update;
  if not found then raise exception 'Pago no encontrado'; end if;

  if v_payment.method = 'efectivo_usd' and v_payment.amount_ref = 3 then
    raise notice 'Pago ya corregido a efectivo_usd $3. Nada que hacer.';
    return;
  end if;

  v_rate := v_sale.ref_rate_ves;
  v_amount_ves := round(v_amount_ref * v_rate, 2);
  v_change_ves := round(v_amount_ves - v_sale.total_ves, 2);

  update public.payments
  set method = 'efectivo_usd',
      currency = 'USD',
      amount = v_amount_ref,
      amount_ref = v_amount_ref,
      amount_ves = v_amount_ves,
      notes = v_marker || ' efectivo USD $3 recibidos; vuelto por pago movil Bs ' || v_change_ves::text
  where id = v_payment.id;

  update public.cash_movements
  set amount_ves = 0,
      amount_ref = v_amount_ref,
      notes = v_marker || ' Pago en efectivo USD de venta ($3 recibidos)'
  where payment_id = v_payment.id;

  update public.sales
  set paid_ves = v_amount_ves,
      status = 'pagada',
      updated_at = now()
  where id = v_sale.id;

  if v_change_ves > 0 and not exists (
    select 1 from public.vault_movements where notes like v_marker || '%'
  ) then
    perform public.ensure_store_vault(v_sale.store_id);
    select * into v_vault from public.store_vaults where store_id = v_sale.store_id for update;

    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by, created_at
    ) values (
      v_sale.store_id, v_vault.id, 'withdrawal', 'cuenta',
      v_change_ves, 0, v_payment.id,
      v_marker || ' vuelto por pago movil venta ' || v_sale.invoice_number,
      v_payment.created_by, v_payment.created_at
    );

    update public.store_vaults
    set balance_ves = balance_ves - v_change_ves,
        updated_at = now()
    where id = v_vault.id;
  end if;

  raise notice 'OK: venta % pago efectivo_usd $3 + vuelto cuenta Bs %',
    v_sale.invoice_number, v_change_ves;
end;
$$;
