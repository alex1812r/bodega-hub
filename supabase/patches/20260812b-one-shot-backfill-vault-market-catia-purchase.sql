-- One-shot: vault audit for EXISTING payment on Market Catia purchase
-- C-20260810155452483 / payment 036f0d49-ee67-4862-8c88-bbda8039fc6e (punto_venta).
-- Does NOT create a new payment. Does NOT change purchase paid_*.
-- Deposit dated = purchase.created_at; purchase_out dated = payment.created_at.
-- Idempotent marker: BACKFILL_VAULT:C-20260810155452483:EXISTING_PAYMENT

do $$
declare
  v_purchase public.purchases%rowtype;
  v_payment public.payments%rowtype;
  v_vault public.store_vaults%rowtype;
  v_marker text := 'BACKFILL_VAULT:C-20260810155452483:EXISTING_PAYMENT';
begin
  select * into v_purchase
  from public.purchases
  where id = 'd1c05299-b34e-4530-bd1a-e663323daefc'
  for update;
  if not found then
    raise exception 'Compra no encontrada';
  end if;

  select * into v_payment
  from public.payments
  where id = '036f0d49-ee67-4862-8c88-bbda8039fc6e'
    and purchase_id = v_purchase.id
  for update;
  if not found then
    raise exception 'Pago existente no encontrado';
  end if;

  if exists (
    select 1 from public.vault_movements
    where store_id = v_purchase.store_id
      and notes like v_marker || '%'
  ) then
    raise notice 'Backfill ya aplicado para %', v_marker;
    return;
  end if;

  perform public.ensure_store_vault(v_purchase.store_id);
  select * into v_vault from public.store_vaults where store_id = v_purchase.store_id for update;

  insert into public.vault_movements (
    store_id, vault_id, type, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_purchase.store_id, v_vault.id, 'deposit',
    v_payment.amount_ves, v_payment.amount_ref,
    v_marker || ' deposito mismo dia compra ' || v_purchase.purchase_number || ' para cubrir pago existente',
    v_purchase.user_id, v_purchase.created_at
  );

  update public.store_vaults
  set balance_ves = balance_ves + v_payment.amount_ves,
      balance_ref = balance_ref + v_payment.amount_ref,
      updated_at = now()
  where id = v_vault.id
  returning * into v_vault;

  insert into public.vault_movements (
    store_id, vault_id, type, amount_ves, amount_ref, payment_id, notes, created_by, created_at
  ) values (
    v_purchase.store_id, v_vault.id, 'purchase_out',
    v_payment.amount_ves, v_payment.amount_ref, v_payment.id,
    v_marker || ' egreso ligado a pago existente ' || v_payment.method::text || ' ' || v_payment.id::text,
    v_payment.created_by, v_payment.created_at
  );

  update public.store_vaults
  set balance_ves = balance_ves - v_payment.amount_ves,
      balance_ref = balance_ref - v_payment.amount_ref,
      updated_at = now()
  where id = v_vault.id;

  raise notice 'Backfill OK pago existente % REF / % VES', v_payment.amount_ref, v_payment.amount_ves;
end;
$$;
