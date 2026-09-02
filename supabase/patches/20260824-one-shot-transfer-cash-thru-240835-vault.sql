-- =============================================================================
-- 20260824 — One-shot: transferir efectivo VES caja hasta 24-ago 00:35 Caracas
-- Corte: 2026-08-24T04:35:00+00 (24-ago 00:35 Caracas)
-- Meta (movimientos caja sale_in/opening/adjustment - transfer_out/refund_out
--   con created_at < corte): Bs 35693.97
-- Ya transferido (BACKFILL thru 20-ago): Bs 11288.78
-- Resta depositar: Bs 24405.19
-- Idempotente: BACKFILL_VAULT_CASH_THRU_20260824T0435
-- =============================================================================

do $$
declare
  v_store_id uuid := '7c11edd5-a569-435e-9c4f-6f0e9e84cace';
  v_marker text := 'BACKFILL_VAULT_CASH_THRU_20260824T0435';
  v_cutoff timestamptz := '2026-08-24T04:35:00+00'::timestamptz;
  v_vault public.store_vaults%rowtype;
  v_amount_ves numeric(14,2) := 24405.19;
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
  where store_id = v_store_id
    and closed_by is not null
  order by closed_at desc nulls last
  limit 1;

  if v_user_id is null then
    raise exception 'No hay usuario closed_by para created_by';
  end if;

  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_store_id,
    v_vault.id,
    'deposit',
    'efectivo',
    v_amount_ves,
    0,
    v_marker || ' efectivo VES caja hasta 24-ago-2026 00:35 Caracas'
      || ' (caja 35693.97 - ya transferido 11288.78)',
    v_user_id,
    v_cutoff
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves,
      updated_at = now()
  where id = v_vault.id;

  raise notice 'OK: depositados Bs % efectivo caja hasta 24-ago 00:35 Caracas', v_amount_ves;
end;
$$;
