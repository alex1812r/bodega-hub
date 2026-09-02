-- =============================================================================
-- 20260821c — One-shot: completar efectivo ventas hasta 20-ago-2026 al baul
-- Meta (pagos venta activo, sale_id not null, created_at < 2026-08-21 04:00 UTC):
--   efectivo_ves: Bs 11288.78
--   efectivo_usd: REF 17.32
-- Ya transferido (BACKFILL_VAULT_TRANSFER:0e06be09): Bs 2238.95 / REF 0
-- Resta depositar: Bs 9049.83 / REF 17.32
-- Idempotente: BACKFILL_VAULT_CASH_SALES_THRU_20260820
-- =============================================================================

do $$
declare
  v_store_id uuid := '7c11edd5-a569-435e-9c4f-6f0e9e84cace';
  v_marker text := 'BACKFILL_VAULT_CASH_SALES_THRU_20260820';
  v_vault public.store_vaults%rowtype;
  v_amount_ves numeric(14,2) := 9049.83;
  v_amount_ref numeric(14,2) := 17.32;
  v_user_id uuid;
begin
  if exists (
    select 1 from public.vault_movements
    where store_id = v_store_id
      and notes like v_marker || '%'
  ) then
    raise notice 'Backfill % ya aplicado; no se repite.', v_marker;
    return;
  end if;

  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  select closed_by into v_user_id
  from public.cash_sessions
  where id = '0e06be09-06df-4acb-8cbe-f7e73efb8eae';

  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_store_id,
    v_vault.id,
    'deposit',
    'efectivo',
    v_amount_ves,
    v_amount_ref,
    v_marker || ' complemento: efectivo ventas acumulado hasta 20-ago-2026 Caracas'
      || ' (meta 11288.78 Bs + 17.32 REF; ya habia 2238.95 Bs del cierre 0e06be09)',
    v_user_id,
    '2026-08-21T04:00:00+00'::timestamptz
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves,
      balance_ref = balance_ref + v_amount_ref,
      updated_at = now()
  where id = v_vault.id;

  raise notice 'OK: depositados Bs % / REF % (acumulado efectivo hasta ayer completo)',
    v_amount_ves, v_amount_ref;
end;
$$;
