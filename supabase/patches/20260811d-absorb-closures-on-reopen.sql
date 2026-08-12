-- Absorbe cierres pendientes al reabrir la misma caja (evita doble conteo al baúl).
-- Aplica después de 20260811c-transfer-closures-to-vault.sql

alter table public.cash_sessions
  add column if not exists absorbed_by_session_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cash_sessions_absorbed_by_session_id_fkey'
  ) then
    alter table public.cash_sessions
      add constraint cash_sessions_absorbed_by_session_id_fkey
      foreign key (absorbed_by_session_id) references public.cash_sessions(id) on delete restrict;
  end if;
end;
$$;

drop index if exists public.cash_sessions_pending_vault_transfer_idx;
create index if not exists cash_sessions_pending_vault_transfer_idx
  on public.cash_sessions (store_id, closed_at desc)
  where status = 'closed'
    and vault_transferred_at is null
    and absorbed_by_session_id is null;

create or replace function public.open_cash_session(
  p_register_id uuid, p_opening_ves numeric default 0, p_opening_ref numeric default 0
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_role public.user_role; v_register public.cash_registers; v_session public.cash_sessions;
begin
  v_store_id := public.assert_store_context(); v_role := public.current_user_role();
  if v_role not in ('admin', 'vendedor') then raise exception 'No autorizado para abrir una caja'; end if;
  if coalesce(p_opening_ves, 0) < 0 or coalesce(p_opening_ref, 0) < 0 then
    raise exception 'Los montos de apertura no pueden ser negativos';
  end if;
  select * into v_register from public.cash_registers
  where id = p_register_id and store_id = v_store_id for update;
  if not found then raise exception 'Caja registradora no encontrada'; end if;
  if not v_register.is_active then raise exception 'La caja registradora está inactiva'; end if;
  if v_role = 'vendedor' and v_register.assigned_user_id is distinct from auth.uid() then
    raise exception 'La caja no está asignada al vendedor actual';
  end if;
  if exists (select 1 from public.cash_sessions where register_id = v_register.id and status = 'open') then
    raise exception 'La caja ya tiene una sesión abierta';
  end if;
  insert into public.cash_sessions (store_id, register_id, opened_by, opening_ves, opening_ref)
  values (v_store_id, v_register.id, auth.uid(), round(coalesce(p_opening_ves, 0), 2), round(coalesce(p_opening_ref, 0), 2))
  returning * into v_session;
  -- Cierres pendientes de esta caja quedan absorbidos por la nueva sesión:
  -- el efectivo sigue en circulación y solo el próximo cierre será transferible.
  update public.cash_sessions
  set absorbed_by_session_id = v_session.id
  where register_id = v_register.id
    and store_id = v_store_id
    and status = 'closed'
    and vault_transferred_at is null
    and absorbed_by_session_id is null
    and id <> v_session.id;
  if v_session.opening_ves > 0 or v_session.opening_ref > 0 then
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, notes, created_by)
    values (v_store_id, v_session.id, 'opening', v_session.opening_ves, v_session.opening_ref,
            'Monto de apertura de caja', auth.uid());
  end if;
  return v_session;
end;
$$;

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
    if v_session.absorbed_by_session_id is not null then
      raise exception 'El cierre ya fue absorbido por una apertura posterior y no se puede transferir por separado';
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

notify pgrst, 'reload schema';
