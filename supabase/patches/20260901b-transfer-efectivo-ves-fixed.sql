-- =============================================================================
-- 20260901b — One-shot CORREGIDO: transferir efectivo VES acumulado hasta
--   01-sep-2026 13:00 Caracas (17:00 UTC) al baúl
-- FIX: usa usuario hardcoded (auth.uid() es NULL en SQL Editor)
-- Idempotente: BACKFILL_VAULT_EFECTIVO_VES_THRU_20260901T1300
-- =============================================================================

do $$
declare
  v_store_id uuid := '7c11edd5-a569-435e-9c4f-6f0e9e84cace';
  v_marker text := 'BACKFILL_VAULT_EFECTIVO_VES_THRU_20260901T1300';
  v_cutoff timestamptz := '2026-09-01T17:00:00+00'::timestamptz;
  v_vault public.store_vaults%rowtype;
  v_total_caja numeric(14,2);
  v_ya_en_baul numeric(14,2);
  v_delta numeric(14,2);
  v_user_id uuid := 'bf491e2d-d32f-4c99-9238-cb66da708409';  -- admin conocido
begin
  -- 1. Idempotencia
  if exists (
    select 1 from public.vault_movements
    where store_id = v_store_id
      and notes like v_marker || '%'
  ) then
    raise notice 'Backfill % ya aplicado; no se repite.', v_marker;
    return;
  end if;

  -- 2. Total efectivo VES en caja hasta el corte
  --    Incluye: sale_in (ventas efectivo), opening (fondo), adjustment
  --    Resta: transfer_out (a otro registro), refund_out (reembolsos)
  select coalesce(sum(
    case
      when type in ('sale_in', 'opening', 'adjustment') then amount_ves
      when type in ('transfer_out', 'refund_out') then -amount_ves
      else 0
    end
  ), 0)
  into v_total_caja
  from public.cash_movements
  where store_id = v_store_id
    and created_at < v_cutoff;

  raise notice 'Total efectivo VES en caja hasta corte: Bs %', v_total_caja;

  -- 3. Lo que ya está en el baúl como efectivo
  select coalesce(sum(amount_ves), 0)
  into v_ya_en_baul
  from public.vault_movements
  where store_id = v_store_id
    and bucket = 'efectivo'
    and type in ('deposit', 'transfer_in');

  raise notice 'Ya en baúl efectivo (total histórico): Bs %', v_ya_en_baul;

  -- 4. Calcular delta
  v_delta := round(v_total_caja - v_ya_en_baul, 2);

  raise notice 'Delta a depositar: Bs %', v_delta;

  if v_delta <= 0 then
    raise notice 'No hay efectivo VES pendiente por transferir al baúl. (caja: %, baul: %)',
      v_total_caja, v_ya_en_baul;
    return;
  end if;

  -- 5. Asegurar que existe el baúl
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  -- 6. Insertar movimiento en el baúl
  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by, created_at
  ) values (
    v_store_id,
    v_vault.id,
    'deposit',
    'efectivo',
    v_delta,
    0,
    v_marker || ' efectivo VES acumulado hasta 01-sep-2026 13:00 Caracas'
      || ' (total caja: ' || v_total_caja || 'Bs, ya en baul: ' || v_ya_en_baul || 'Bs)',
    v_user_id,
    v_cutoff
  );

  -- 7. Actualizar saldo del baúl
  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_delta,
      updated_at = now()
  where id = v_vault.id;

  raise notice 'OK: depositados Bs % efectivo VES al baúl', v_delta;
  raise notice 'Nuevo balance efectivo VES: Bs %',
    (select balance_efectivo_ves from public.store_vaults where id = v_vault.id);
end;
$$;
