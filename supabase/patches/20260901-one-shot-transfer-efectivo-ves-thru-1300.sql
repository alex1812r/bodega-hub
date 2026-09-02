-- =============================================================================
-- 20260901 — One-shot: transferir TODO el efectivo VES acumulado hasta
--   01-sep-2026 13:00 Caracas (17:00 UTC) al baúl
-- Corte: 2026-09-01T17:00:00+00
-- Calcula automáticamente: total efectivo VES en caja - ya en baúl = delta
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
  v_user_id uuid;
begin
  -- Idempotencia
  if exists (
    select 1 from public.vault_movements
    where store_id = v_store_id
      and notes like v_marker || '%'
  ) then
    raise notice 'Backfill % ya aplicado; no se repite.', v_marker;
    return;
  end if;

  -- Total efectivo VES en caja: sale_in (ventas cash) + opening (fondo) + adjustment - transfer_out - refund_out
  -- hasta el corte, excluyendo lo que ya se transfirió al baúl
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

  -- Lo que ya está en el baúl como efectivo (depósitos + transferencias de cierres)
  select coalesce(sum(amount_ves), 0)
  into v_ya_en_baul
  from public.vault_movements
  where store_id = v_store_id
    and bucket = 'efectivo'
    and type in ('deposit', 'transfer_in')
    and created_at < v_cutoff;

  v_delta := round(v_total_caja - v_ya_en_baul, 2);

  raise notice 'Caja efectivo VES hasta corte: Bs %', v_total_caja;
  raise notice 'Ya en baúl efectivo: Bs %', v_ya_en_baul;
  raise notice 'Delta a depositar: Bs %', v_delta;

  if v_delta <= 0 then
    raise notice 'No hay efectivo VES pendiente por transferir al baúl.';
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
    v_user_id := auth.uid();
  end if;

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
      || ' (caja ' || v_total_caja || ' - ya en baúl ' || v_ya_en_baul || ')',
    v_user_id,
    v_cutoff
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_delta,
      updated_at = now()
  where id = v_vault.id;

  raise notice 'OK: depositados Bs % efectivo VES al baúl (hasta 01-sep-2026 13:00 Caracas)', v_delta;
end;
$$;
