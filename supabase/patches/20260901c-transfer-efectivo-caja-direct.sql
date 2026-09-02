-- =============================================================================
-- 20260901c — One-shot: depositar efectivo VES de caja (55785.41 Bs) al baúl
-- Monto calculado: neto de cash_movements hasta 01-sep-2026 13:00 Caracas
-- Idempotente: BACKFILL_VAULT_EFECTIVO_CAJA_20260901C
-- =============================================================================

do $$
declare
  v_store_id uuid := '7c11edd5-a569-435e-9c4f-6f0e9e84cace';
  v_marker text := 'BACKFILL_VAULT_EFECTIVO_CAJA_20260901C';
  v_cutoff timestamptz := '2026-09-01T17:00:00+00'::timestamptz;
  v_vault public.store_vaults%rowtype;
  v_amount_ves numeric(14,2) := 55785.41;
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
    v_store_id, v_vault.id, 'deposit', 'efectivo', v_amount_ves, 0,
    v_marker || ' efectivo VES neto caja hasta 01-sep-2026 13:00 Caracas',
    v_user_id, v_cutoff
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves, updated_at = now()
  where id = v_vault.id;

  raise notice 'OK: +% Bs efectivo al baul', v_amount_ves;
end;
$$;
