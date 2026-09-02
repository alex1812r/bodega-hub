-- =============================================================================
-- 20260821b — One-shot: transferir cierre efectivo dia 20-ago (Caracas) al baul
-- Sesion: 0e06be09-06df-4acb-8cbe-f7e73efb8eae
-- Cierre manual 20→21 ago: Bs 2238.95 / REF 0.00 (= sale_in efectivo del dia)
-- Quedo absorbido al reabrir hoy con apertura 0; no aparece en Transferir cierres.
-- Pago movil del dia ya entro a cubeta cuenta; solo falta efectivo.
-- Idempotente: notes marker BACKFILL_VAULT_TRANSFER:0e06be09
-- =============================================================================

do $$
declare
  v_session_id uuid := '0e06be09-06df-4acb-8cbe-f7e73efb8eae';
  v_marker text := 'BACKFILL_VAULT_TRANSFER:0e06be09';
  v_session public.cash_sessions%rowtype;
  v_vault public.store_vaults%rowtype;
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
begin
  select * into v_session
  from public.cash_sessions
  where id = v_session_id
  for update;

  if not found then
    raise exception 'Sesion % no encontrada', v_session_id;
  end if;

  if v_session.vault_transferred_at is not null then
    raise notice 'Sesion ya transferida al baul; nada que hacer.';
    return;
  end if;

  if exists (
    select 1 from public.vault_movements
    where from_session_id = v_session_id
       or notes like v_marker || '%'
  ) then
    update public.cash_sessions
    set vault_transferred_at = coalesce(vault_transferred_at, now()),
        absorbed_by_session_id = null
    where id = v_session_id;
    raise notice 'Movimiento baul ya existe; se marco vault_transferred_at.';
    return;
  end if;

  if v_session.status <> 'closed' then
    raise exception 'La sesion no esta cerrada';
  end if;

  v_amount_ves := round(coalesce(v_session.closing_ves, 0), 2);
  v_amount_ref := round(coalesce(v_session.closing_ref, 0), 2);

  if v_amount_ves <= 0 and v_amount_ref <= 0 then
    raise exception 'El cierre no tiene monto para transferir';
  end if;

  -- Desbloquear: fue absorbida por apertura posterior con fondo 0
  update public.cash_sessions
  set absorbed_by_session_id = null
  where id = v_session_id;

  perform public.ensure_store_vault(v_session.store_id);
  select * into v_vault
  from public.store_vaults
  where store_id = v_session.store_id
  for update;

  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref,
    from_session_id, notes, created_by, created_at
  ) values (
    v_session.store_id,
    v_vault.id,
    'transfer_in',
    'efectivo',
    v_amount_ves,
    v_amount_ref,
    v_session.id,
    v_marker || ' efectivo ventas 20-ago-2026 Caracas desde cierre absorbido',
    v_session.closed_by,
    coalesce(v_session.closed_at, now())
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves,
      balance_ref = balance_ref + v_amount_ref,
      updated_at = now()
  where id = v_vault.id;

  update public.cash_sessions
  set vault_transferred_at = now(),
      absorbed_by_session_id = null
  where id = v_session_id;

  raise notice 'OK: transferidos Bs % / REF % de sesion % al baul efectivo',
    v_amount_ves, v_amount_ref, v_session_id;
end;
$$;
