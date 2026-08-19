-- =============================================================================
-- 20260815-one-shot-backfill-vault-mercaseu-C-20260814214845696.sql
-- Deposito efectivo + pago efectivo_ves + purchase_out (mismo patron que 20260813g).
-- Compra C-20260814214845696 (Mercaseu) — recibida, paid=0.
-- Net baul efectivo = 0.
-- Idempotente: BACKFILL_VAULT:C-20260814214845696
-- =============================================================================

do $$
declare
  v_purchase public.purchases%rowtype;
  v_vault public.store_vaults%rowtype;
  v_payment_id uuid;
  v_marker text := 'BACKFILL_VAULT:C-20260814214845696';
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_at timestamptz;
  v_pay_at timestamptz;
begin
  select * into v_purchase
  from public.purchases
  where id = '3cb6c288-b39f-4df4-881e-aad0f5523e58'
  for update;

  if not found then
    raise exception 'Compra C-20260814214845696 no encontrada';
  end if;

  if exists (
    select 1 from public.vault_movements
    where store_id = v_purchase.store_id
      and notes like v_marker || '%'
  ) then
    raise notice 'Backfill ya aplicado para %; no se repite.', v_marker;
    return;
  end if;

  if exists (
    select 1 from public.payments
    where purchase_id = v_purchase.id
      and status = 'activo'
  ) then
    raise exception 'La compra ya tiene pago activo; no crear backfill duplicado.';
  end if;

  v_amount_ves := round(v_purchase.total_ves, 2);
  v_amount_ref := round(v_purchase.total_ref, 2);
  v_at := v_purchase.created_at;
  v_pay_at := v_at + interval '1 second';

  perform public.ensure_store_vault(v_purchase.store_id);
  select * into v_vault
  from public.store_vaults
  where store_id = v_purchase.store_id
  for update;

  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_purchase.store_id,
    v_vault.id,
    'deposit',
    'efectivo',
    v_amount_ves,
    v_amount_ref,
    v_marker || ' deposito efectivo para cubrir pago compra ' || v_purchase.purchase_number
      || ' (factura 00005635)',
    v_purchase.user_id,
    v_at
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves,
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
    v_marker || ' pago efectivo historico factura 00005635',
    v_purchase.user_id,
    v_pay_at,
    'activo'
  ) returning id into v_payment_id;

  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, payment_id, notes, created_by, created_at
  ) values (
    v_purchase.store_id,
    v_vault.id,
    'purchase_out',
    'efectivo',
    v_amount_ves,
    v_amount_ref,
    v_payment_id,
    v_marker || ' egreso compra ' || v_purchase.purchase_number,
    v_purchase.user_id,
    v_pay_at
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves - v_amount_ves,
      balance_ref = balance_ref - v_amount_ref,
      updated_at = now()
  where id = v_vault.id;

  update public.purchases
  set paid_ves = round(coalesce(paid_ves, 0) + v_amount_ves, 2),
      paid_ref = round(coalesce(paid_ref, 0) + v_amount_ref, 2),
      updated_at = now()
  where id = v_purchase.id;

  raise notice
    'Backfill OK C-20260814214845696: deposit efectivo + payment + purchase_out % REF / % VES (payment %)',
    v_amount_ref, v_amount_ves, v_payment_id;
end;
$$;
