-- =============================================================================
-- 20260819 — Tope de apertura de caja: medianoche Caracas + 24 h
-- Idempotente.
-- Cierra sesiones vencidas con el monto teórico (sin transferir al baúl).
-- Rechaza nuevos movimientos de caja en una sesión ya vencida.
-- =============================================================================

alter table public.cash_sessions
  add column if not exists closed_reason text;

alter table public.cash_sessions
  drop constraint if exists cash_sessions_closed_reason_check;

alter table public.cash_sessions
  add constraint cash_sessions_closed_reason_check
  check (closed_reason is null or closed_reason in ('manual', 'end_of_day', 'max_24h'));

update public.cash_sessions
set closed_reason = 'manual'
where status = 'closed' and closed_reason is null;

create or replace function public.cash_session_deadline(p_opened_at timestamptz)
returns timestamptz
language sql
immutable
as $$
  select least(
    ((date_trunc('day', p_opened_at at time zone 'America/Caracas') + interval '1 day')
      at time zone 'America/Caracas'),
    p_opened_at + interval '24 hours'
  );
$$;

create or replace function public.cash_session_auto_close_reason(p_opened_at timestamptz)
returns text
language sql
immutable
as $$
  select case
    when ((date_trunc('day', p_opened_at at time zone 'America/Caracas') + interval '1 day')
      at time zone 'America/Caracas')
      <= p_opened_at + interval '24 hours'
    then 'end_of_day'
    else 'max_24h'
  end;
$$;

create or replace function public.close_cash_session(
  p_session_id uuid, p_closing_ves numeric, p_closing_ref numeric
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_session public.cash_sessions; v_ves numeric(14,2); v_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_closing_ves is null or p_closing_ref is null or p_closing_ves < 0 or p_closing_ref < 0 then
    raise exception 'Los montos de cierre deben ser válidos y no negativos';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id and store_id = v_store_id for update;
  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if v_session.status <> 'open' then raise exception 'La sesión de caja ya está cerrada'; end if;
  if public.current_user_role() <> 'admin' and v_session.opened_by is distinct from auth.uid() then
    raise exception 'Solo quien abrió la caja o un administrador puede cerrarla';
  end if;
  select round(v_session.opening_ves + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ves
           when type in ('transfer_out', 'refund_out') then -amount_ves else 0 end), 0), 2),
         round(v_session.opening_ref + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ref
           when type in ('transfer_out', 'refund_out') then -amount_ref else 0 end), 0), 2)
  into v_ves, v_ref
  from public.cash_movements where session_id = v_session.id;
  update public.cash_sessions set status = 'closed', closing_ves = round(p_closing_ves, 2),
    closing_ref = round(p_closing_ref, 2), theoretical_closing_ves = v_ves,
    theoretical_closing_ref = v_ref, closed_by = auth.uid(), closed_at = now(),
    closed_reason = 'manual'
  where id = v_session.id returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.auto_close_stale_cash_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
  v_ves numeric(14,2);
  v_ref numeric(14,2);
  v_ids uuid[] := '{}';
  v_now timestamptz := now();
begin
  for v_session in
    select * from public.cash_sessions
    where status = 'open'
      and public.cash_session_deadline(opened_at) <= v_now
    for update
  loop
    select round(v_session.opening_ves + coalesce(sum(case
             when type in ('sale_in', 'adjustment') then amount_ves
             when type in ('transfer_out', 'refund_out') then -amount_ves else 0 end), 0), 2),
           round(v_session.opening_ref + coalesce(sum(case
             when type in ('sale_in', 'adjustment') then amount_ref
             when type in ('transfer_out', 'refund_out') then -amount_ref else 0 end), 0), 2)
    into v_ves, v_ref
    from public.cash_movements where session_id = v_session.id;

    update public.cash_sessions
    set status = 'closed',
        closing_ves = v_ves,
        closing_ref = v_ref,
        theoretical_closing_ves = v_ves,
        theoretical_closing_ref = v_ref,
        closed_by = v_session.opened_by,
        closed_at = v_now,
        closed_reason = public.cash_session_auto_close_reason(v_session.opened_at)
    where id = v_session.id;

    v_ids := array_append(v_ids, v_session.id);
  end loop;

  return jsonb_build_object(
    'closedCount', coalesce(cardinality(v_ids), 0),
    'sessionIds', to_jsonb(coalesce(v_ids, '{}'::uuid[]))
  );
end;
$$;

create or replace function public.prevent_movements_on_expired_cash_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
begin
  select * into v_session from public.cash_sessions where id = new.session_id;
  if not found then
    raise exception 'Sesión de caja no encontrada';
  end if;
  if v_session.status <> 'open' then
    raise exception 'La sesión de caja ya está cerrada';
  end if;
  if public.cash_session_deadline(v_session.opened_at) <= now() then
    raise exception 'La jornada de caja venció. Cierra y abre de nuevo para registrar cobros.';
  end if;
  return new;
end;
$$;

drop trigger if exists cash_movements_prevent_expired_session on public.cash_movements;
create trigger cash_movements_prevent_expired_session
before insert on public.cash_movements
for each row
execute procedure public.prevent_movements_on_expired_cash_session();

revoke all on function public.cash_session_deadline(timestamptz) from public;
revoke all on function public.cash_session_auto_close_reason(timestamptz) from public;
revoke all on function public.auto_close_stale_cash_sessions() from public;
revoke all on function public.prevent_movements_on_expired_cash_session() from public;

grant execute on function public.cash_session_deadline(timestamptz) to authenticated, service_role;
grant execute on function public.cash_session_auto_close_reason(timestamptz) to authenticated, service_role;
grant execute on function public.auto_close_stale_cash_sessions() to service_role;
grant execute on function public.close_cash_session(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
