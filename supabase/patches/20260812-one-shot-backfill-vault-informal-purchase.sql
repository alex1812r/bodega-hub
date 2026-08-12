-- One-shot: backfill vault for cash purchase registered before cash/vault module.
-- Purchase C-20260810204259934 (Compras informales / calle) — unpaid in payments,
-- treated as cash paid outside vault. Creates deposit + purchase_out + payment
-- with the purchase timestamp so the audit trail matches the business day.
-- Idempotent via notes marker BACKFILL_VAULT:C-20260810204259934
-- Net vault balance unchanged (deposit then purchase_out).

do $$
declare
  v_purchase public.purchases%rowtype;
  v_vault public.store_vaults%rowtype;
  v_payment_id uuid;
  v_marker text := 'BACKFILL_VAULT:C-20260810204259934';
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_at timestamptz;
begin
  select * into v_purchase
  from public.purchases
  where id = 'a50f6ef4-e008-4d08-bcce-a2c2257b18f5'
  for update;

  if not found then
    raise exception 'Compra a50f6ef4-e008-4d08-bcce-a2c2257b18f5 no encontrada';
  end if;

  if exists (
    select 1 from public.vault_movements
    where store_id = v_purchase.store_id
      and notes like v_marker || '%'
  ) then
    raise notice 'Backfill ya aplicado para %; no se repite.', v_marker;
    return;
  end if;

  v_amount_ves := round(v_purchase.total_ves, 2);
  v_amount_ref := round(v_purchase.total_ref, 2);
  v_at := v_purchase.created_at;

  perform public.ensure_store_vault(v_purchase.store_id);
  select * into v_vault from public.store_vaults where store_id = v_purchase.store_id for update;

  insert into public.vault_movements (
    store_id, vault_id, type, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_purchase.store_id,
    v_vault.id,
    'deposit',
    v_amount_ves,
    v_amount_ref,
    v_marker || ' deposito para cubrir pago efectivo historico de compra ' || v_purchase.purchase_number,
    v_purchase.user_id,
    v_at
  );

  update public.store_vaults
  set balance_ves = balance_ves + v_amount_ves,
      balance_ref = balance_ref + v_amount_ref,
      updated_at = now()
  where id = v_vault.id
  returning * into v_vault;

  insert into public.payments (
    store_id,
    direction,
    purchase_id,
    contact_id,
    method,
    currency,
    amount,
    amount_ves,
    amount_ref,
    ref_rate_ves,
    notes,
    created_by,
    created_at,
    status
  ) values (
    v_purchase.store_id,
    'salida',
    v_purchase.id,
    v_purchase.supplier_id,
    'efectivo_ves',
    'VES',
    v_amount_ves,
    v_amount_ves,
    v_amount_ref,
    v_purchase.ref_rate_ves,
    v_marker || ' pago efectivo historico (antes de modulo baul)',
    v_purchase.user_id,
    v_at + interval '1 second',
    'activo'
  ) returning id into v_payment_id;

  insert into public.vault_movements (
    store_id, vault_id, type, amount_ves, amount_ref, payment_id, notes, created_by, created_at
  ) values (
    v_purchase.store_id,
    v_vault.id,
    'purchase_out',
    v_amount_ves,
    v_amount_ref,
    v_payment_id,
    v_marker || ' egreso compra ' || v_purchase.purchase_number,
    v_purchase.user_id,
    v_at + interval '1 second'
  );

  update public.store_vaults
  set balance_ves = balance_ves - v_amount_ves,
      balance_ref = balance_ref - v_amount_ref,
      updated_at = now()
  where id = v_vault.id;

  update public.purchases
  set paid_ves = round(coalesce(paid_ves, 0) + v_amount_ves, 2),
      paid_ref = round(coalesce(paid_ref, 0) + v_amount_ref, 2),
      updated_at = now()
  where id = v_purchase.id;

  raise notice 'Backfill OK: deposit+purchase_out+payment % REF / % VES @ %',
    v_amount_ref, v_amount_ves, v_at;
end;
$$;
