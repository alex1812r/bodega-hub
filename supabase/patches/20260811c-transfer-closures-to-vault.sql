-- Transferencias al baúl desde cierres de caja (no desde sesión abierta).
-- Aplica después de 20260811b-cash-registers-vault.sql

alter table public.cash_sessions
  add column if not exists vault_transferred_at timestamptz;

create index if not exists cash_sessions_pending_vault_transfer_idx
  on public.cash_sessions (store_id, closed_at desc)
  where status = 'closed' and vault_transferred_at is null;

create or replace function public.transfer_cash_closures_to_vault(
  p_session_ids uuid[],
  p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_session public.cash_sessions;
  v_vault public.store_vaults;
  v_session_id uuid;
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_notes text;
  v_transferred int := 0;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un administrador puede transferir efectivo al baúl';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    raise exception 'Selecciona al menos un cierre de caja para transferir';
  end if;

  v_notes := nullif(trim(p_notes), '');
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  foreach v_session_id in array p_session_ids loop
    select * into v_session
    from public.cash_sessions
    where id = v_session_id and store_id = v_store_id
    for update;

    if not found then
      raise exception 'Sesión de caja no encontrada';
    end if;
    if v_session.status <> 'closed' then
      raise exception 'Solo se pueden transferir cierres. La caja sigue en circulación hasta que registres un cierre';
    end if;
    if v_session.vault_transferred_at is not null then
      raise exception 'El cierre seleccionado ya fue transferido al baúl';
    end if;

    v_amount_ves := round(coalesce(v_session.closing_ves, 0), 2);
    v_amount_ref := round(coalesce(v_session.closing_ref, 0), 2);
    if v_amount_ves <= 0 and v_amount_ref <= 0 then
      raise exception 'El cierre no tiene monto para transferir';
    end if;

    insert into public.vault_movements (
      store_id, vault_id, type, amount_ves, amount_ref, from_session_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'transfer_in', v_amount_ves, v_amount_ref, v_session.id, v_notes, auth.uid()
    );

    update public.store_vaults
    set balance_ves = balance_ves + v_amount_ves,
        balance_ref = balance_ref + v_amount_ref
    where id = v_vault.id
    returning * into v_vault;

    update public.cash_sessions
    set vault_transferred_at = now()
    where id = v_session.id;

    v_transferred := v_transferred + 1;
  end loop;

  if v_transferred = 0 then
    raise exception 'Selecciona al menos un cierre de caja para transferir';
  end if;

  return v_vault;
end;
$$;

drop function if exists public.transfer_cash_to_vault(uuid, numeric, numeric, text);

create or replace function public.transfer_cash_to_vault(
  p_session_id uuid,
  p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
begin
  return public.transfer_cash_closures_to_vault(array[p_session_id], p_notes);
end;
$$;

revoke all on function public.transfer_cash_closures_to_vault(uuid[], text) from public;
revoke all on function public.transfer_cash_to_vault(uuid, text) from public;
grant execute on function public.transfer_cash_closures_to_vault(uuid[], text) to authenticated;
grant execute on function public.transfer_cash_to_vault(uuid, text) to authenticated;

notify pgrst, 'reload schema';
