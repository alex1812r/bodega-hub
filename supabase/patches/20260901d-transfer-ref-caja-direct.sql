-- =============================================================================
-- 20260901d — One-shot: depositar 15 REF (USD) de caja al baúl
-- Idempotente: BACKFILL_VAULT_REF_CAJA_20260901D
-- =============================================================================

do $$
declare
  v_store_id uuid := '7c11edd5-a569-435e-9c4f-6f0e9e84cace';
  v_marker text := 'BACKFILL_VAULT_REF_CAJA_20260901D';
  v_vault public.store_vaults%rowtype;
  v_amount_ref numeric(14,2) := 15.00;
  v_user_id uuid := 'bf491e2d-d32f-4c99-9238-cb66da708409';
begin
  if exists (
    select 1 from public.vault_movements
    where store_id = v_store_id and notes like v_marker || '%'
  ) then
    raise notice 'Ya aplicado.';
    return;
  end if;

  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_store_id, v_vault.id, 'deposit', 'efectivo', 0, v_amount_ref,
    v_marker || ' 15 REF (USD) de caja al baul',
    v_user_id, now()
  );

  update public.store_vaults
  set balance_ref = balance_ref + v_amount_ref, updated_at = now()
  where id = v_vault.id;

  raise notice 'OK: +15 REF al baul';
end;
$$;
