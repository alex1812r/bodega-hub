-- =============================================================================
-- 20260811b — Cajas registradoras y baúl por tienda
-- Idempotente. Requiere stores, profiles, payments, sales, purchases y
-- assert_store_context()/current_user_role() de la migración multitienda.
-- =============================================================================

create table if not exists public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_registers_store_name_key unique (store_id, name)
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  register_id uuid not null references public.cash_registers(id) on delete restrict,
  opened_by uuid not null references public.profiles(id),
  closed_by uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opening_ves numeric(14,2) not null default 0 check (opening_ves >= 0),
  opening_ref numeric(14,2) not null default 0 check (opening_ref >= 0),
  closing_ves numeric(14,2) check (closing_ves >= 0),
  closing_ref numeric(14,2) check (closing_ref >= 0),
  theoretical_closing_ves numeric(14,2),
  theoretical_closing_ref numeric(14,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cash_sessions_closed_state_check check (
    (status = 'open' and closed_at is null and closed_by is null)
    or (status = 'closed' and closed_at is not null and closed_by is not null)
  )
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  session_id uuid not null references public.cash_sessions(id) on delete restrict,
  type text not null check (type in ('sale_in', 'transfer_out', 'opening', 'adjustment', 'refund_out')),
  amount_ves numeric(14,2) not null default 0 check (amount_ves >= 0),
  amount_ref numeric(14,2) not null default 0 check (amount_ref >= 0),
  payment_id uuid references public.payments(id) on delete restrict,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint cash_movements_nonzero_amount_check check (amount_ves > 0 or amount_ref > 0)
);

create table if not exists public.store_vaults (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores(id) on delete cascade,
  balance_ves numeric(14,2) not null default 0 check (balance_ves >= 0),
  balance_ref numeric(14,2) not null default 0 check (balance_ref >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  vault_id uuid not null references public.store_vaults(id) on delete restrict,
  type text not null check (type in ('transfer_in', 'purchase_out', 'deposit', 'withdrawal', 'adjustment')),
  amount_ves numeric(14,2) not null default 0 check (amount_ves >= 0),
  amount_ref numeric(14,2) not null default 0 check (amount_ref >= 0),
  payment_id uuid references public.payments(id) on delete restrict,
  from_session_id uuid references public.cash_sessions(id) on delete restrict,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint vault_movements_nonzero_amount_check check (amount_ves > 0 or amount_ref > 0)
);

create unique index if not exists cash_registers_one_active_assignment_per_store_idx
  on public.cash_registers (store_id, assigned_user_id)
  where assigned_user_id is not null and is_active = true;
create unique index if not exists cash_sessions_one_open_per_register_idx
  on public.cash_sessions (register_id) where status = 'open';
create index if not exists cash_sessions_store_status_idx on public.cash_sessions (store_id, status);
create index if not exists cash_movements_session_created_at_idx on public.cash_movements (session_id, created_at);
create index if not exists cash_movements_payment_id_idx on public.cash_movements (payment_id) where payment_id is not null;
create index if not exists vault_movements_vault_created_at_idx on public.vault_movements (vault_id, created_at);
create index if not exists vault_movements_payment_id_idx on public.vault_movements (payment_id) where payment_id is not null;

create or replace function public.set_cash_registers_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists cash_registers_set_updated_at on public.cash_registers;
create trigger cash_registers_set_updated_at before update on public.cash_registers
for each row execute function public.set_cash_registers_updated_at();

create or replace function public.set_store_vaults_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists store_vaults_set_updated_at on public.store_vaults;
create trigger store_vaults_set_updated_at before update on public.store_vaults
for each row execute function public.set_store_vaults_updated_at();

alter table public.cash_registers enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.store_vaults enable row level security;
alter table public.vault_movements enable row level security;

drop policy if exists "Admins manage cash registers" on public.cash_registers;
create policy "Admins manage cash registers" on public.cash_registers for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');
drop policy if exists "Users read assigned cash register" on public.cash_registers;
create policy "Users read assigned cash register" on public.cash_registers for select to authenticated
using (store_id = public.current_user_store_id() and (
  public.current_user_role() in ('admin', 'contador', 'almacen') or assigned_user_id = auth.uid()
));

drop policy if exists "Admins manage cash sessions" on public.cash_sessions;
create policy "Admins manage cash sessions" on public.cash_sessions for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');
drop policy if exists "Users read own cash sessions" on public.cash_sessions;
create policy "Users read own cash sessions" on public.cash_sessions for select to authenticated
using (store_id = public.current_user_store_id() and (
  public.current_user_role() in ('admin', 'contador') or opened_by = auth.uid()
  or exists (select 1 from public.cash_registers cr where cr.id = cash_sessions.register_id
             and cr.store_id = cash_sessions.store_id and cr.assigned_user_id = auth.uid())
));

drop policy if exists "Admins manage cash movements" on public.cash_movements;
create policy "Admins manage cash movements" on public.cash_movements for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');
drop policy if exists "Users read own cash movements" on public.cash_movements;
create policy "Users read own cash movements" on public.cash_movements for select to authenticated
using (store_id = public.current_user_store_id() and (
  public.current_user_role() in ('admin', 'contador') or created_by = auth.uid()
  or exists (
    select 1 from public.cash_sessions cs join public.cash_registers cr on cr.id = cs.register_id
    where cs.id = cash_movements.session_id and cs.store_id = cash_movements.store_id
      and (cs.opened_by = auth.uid() or cr.assigned_user_id = auth.uid())
  )
));

drop policy if exists "Users read store vault" on public.store_vaults;
create policy "Users read store vault" on public.store_vaults for select to authenticated
using (store_id = public.current_user_store_id());
drop policy if exists "Admins manage store vault" on public.store_vaults;
create policy "Admins manage store vault" on public.store_vaults for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');
drop policy if exists "Users read store vault movements" on public.vault_movements;
create policy "Users read store vault movements" on public.vault_movements for select to authenticated
using (store_id = public.current_user_store_id());
drop policy if exists "Admins manage vault movements" on public.vault_movements;
create policy "Admins manage vault movements" on public.vault_movements for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

create or replace function public.ensure_store_vault(p_store_id uuid)
returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_vault public.store_vaults;
begin
  insert into public.store_vaults (store_id) values (p_store_id)
  on conflict (store_id) do update set store_id = excluded.store_id
  returning * into v_vault;
  return v_vault;
end;
$$;

create or replace function public.get_open_cash_session_for_user(p_user_id uuid, p_store_id uuid)
returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare v_session public.cash_sessions;
begin
  select cs.* into v_session
  from public.cash_sessions cs join public.cash_registers cr on cr.id = cs.register_id
  where cs.store_id = p_store_id and cs.status = 'open' and cr.store_id = p_store_id
    and cr.is_active and cr.assigned_user_id = p_user_id
  order by cs.opened_at desc limit 1;
  return v_session;
end;
$$;

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
  if v_session.opening_ves > 0 or v_session.opening_ref > 0 then
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, notes, created_by)
    values (v_store_id, v_session.id, 'opening', v_session.opening_ves, v_session.opening_ref,
            'Monto de apertura de caja', auth.uid());
  end if;
  return v_session;
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
  -- opening no se suma: ya está incorporado en opening_ves/opening_ref de la sesión.
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
    theoretical_closing_ref = v_ref, closed_by = auth.uid(), closed_at = now()
  where id = v_session.id returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.transfer_cash_to_vault(
  p_session_id uuid, p_amount_ves numeric, p_amount_ref numeric, p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_session public.cash_sessions; v_vault public.store_vaults; v_ves numeric(14,2); v_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then raise exception 'Solo un administrador puede transferir efectivo al baúl'; end if;
  if coalesce(p_amount_ves, 0) < 0 or coalesce(p_amount_ref, 0) < 0 or (coalesce(p_amount_ves, 0) = 0 and coalesce(p_amount_ref, 0) = 0) then
    raise exception 'Debe transferir al menos un monto mayor a cero';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id and store_id = v_store_id for update;
  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if v_session.status <> 'open' then raise exception 'Solo se puede transferir efectivo desde una sesión abierta'; end if;
  select round(v_session.opening_ves + coalesce(sum(case when type in ('sale_in', 'adjustment') then amount_ves when type in ('transfer_out', 'refund_out') then -amount_ves else 0 end), 0), 2),
         round(v_session.opening_ref + coalesce(sum(case when type in ('sale_in', 'adjustment') then amount_ref when type in ('transfer_out', 'refund_out') then -amount_ref else 0 end), 0), 2)
  into v_ves, v_ref from public.cash_movements where session_id = v_session.id;
  if p_amount_ves > v_ves or p_amount_ref > v_ref then
    raise exception 'El monto a transferir excede el saldo teórico de la caja. Disponible VES: %, REF: %', v_ves, v_ref;
  end if;
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;
  insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, notes, created_by)
  values (v_store_id, v_session.id, 'transfer_out', round(p_amount_ves, 2), round(p_amount_ref, 2), nullif(trim(p_notes), ''), auth.uid());
  insert into public.vault_movements (store_id, vault_id, type, amount_ves, amount_ref, from_session_id, notes, created_by)
  values (v_store_id, v_vault.id, 'transfer_in', round(p_amount_ves, 2), round(p_amount_ref, 2), v_session.id, nullif(trim(p_notes), ''), auth.uid());
  update public.store_vaults set balance_ves = balance_ves + round(p_amount_ves, 2),
    balance_ref = balance_ref + round(p_amount_ref, 2) where id = v_vault.id returning * into v_vault;
  return v_vault;
end;
$$;

create or replace function public.register_vault_deposit(
  p_amount_ves numeric, p_amount_ref numeric, p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_vault public.store_vaults;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then raise exception 'Solo un administrador puede registrar depósitos en el baúl'; end if;
  if coalesce(p_amount_ves, 0) < 0 or coalesce(p_amount_ref, 0) < 0 or (coalesce(p_amount_ves, 0) = 0 and coalesce(p_amount_ref, 0) = 0) then
    raise exception 'Debe registrar al menos un monto mayor a cero';
  end if;
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;
  insert into public.vault_movements (store_id, vault_id, type, amount_ves, amount_ref, notes, created_by)
  values (v_store_id, v_vault.id, 'deposit', round(p_amount_ves, 2), round(p_amount_ref, 2), nullif(trim(p_notes), ''), auth.uid());
  update public.store_vaults set balance_ves = balance_ves + round(p_amount_ves, 2),
    balance_ref = balance_ref + round(p_amount_ref, 2) where id = v_vault.id returning * into v_vault;
  return v_vault;
end;
$$;

create or replace function public.register_vault_withdrawal(
  p_amount_ves numeric, p_amount_ref numeric, p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_vault public.store_vaults;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then raise exception 'Solo un administrador puede registrar retiros del baúl'; end if;
  if coalesce(p_amount_ves, 0) < 0 or coalesce(p_amount_ref, 0) < 0 or (coalesce(p_amount_ves, 0) = 0 and coalesce(p_amount_ref, 0) = 0) then
    raise exception 'Debe retirar al menos un monto mayor a cero';
  end if;
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;
  if p_amount_ves > v_vault.balance_ves or p_amount_ref > v_vault.balance_ref then
    raise exception 'Saldo insuficiente en el baul. Disponible VES: %, REF: %', v_vault.balance_ves, v_vault.balance_ref;
  end if;
  insert into public.vault_movements (store_id, vault_id, type, amount_ves, amount_ref, notes, created_by)
  values (v_store_id, v_vault.id, 'withdrawal', round(p_amount_ves, 2), round(p_amount_ref, 2), nullif(trim(p_notes), ''), auth.uid());
  update public.store_vaults set balance_ves = balance_ves - round(p_amount_ves, 2),
    balance_ref = balance_ref - round(p_amount_ref, 2) where id = v_vault.id returning * into v_vault;
  return v_vault;
end;
$$;

-- Misma firma que 20260810d-purchase-paid-ref.sql.
create or replace function public.register_payment(
  p_sale_id uuid default null,
  p_purchase_id uuid default null,
  p_method public.payment_method default 'efectivo_ves',
  p_amount numeric default 0,
  p_bank_name text default null,
  p_phone text default null,
  p_reference_code text default null,
  p_notes text default null
) returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_sale public.sales; v_purchase public.purchases; v_payment public.payments;
  v_direction public.payment_direction; v_contact_id uuid; v_rate numeric(14,4);
  v_currency public.payment_currency; v_amount_ves numeric(14,2); v_amount_ref numeric(14,2);
  v_paid_ves numeric(14,2); v_paid_ref numeric(14,2); v_session public.cash_sessions;
  v_vault public.store_vaults; v_movement_ves numeric(14,2); v_movement_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_amount is null or p_amount <= 0 then raise exception 'El monto del pago debe ser mayor a cero'; end if;
  if (p_sale_id is null and p_purchase_id is null) or (p_sale_id is not null and p_purchase_id is not null) then
    raise exception 'Debe asociar el pago a una venta o a una compra';
  end if;
  if p_method = 'pago_movil' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then raise exception 'Pago Móvil requiere banco'; end if;
    if p_phone is null or length(trim(p_phone)) = 0 then raise exception 'Pago Móvil requiere teléfono'; end if;
    if p_reference_code is null or p_reference_code !~ '^[0-9]{4}$' then raise exception 'Pago Móvil requiere referencia de 4 dígitos'; end if;
  end if;
  if p_method = 'transferencia' then
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then raise exception 'Transferencia requiere banco'; end if;
    if p_reference_code is null or length(trim(p_reference_code)) = 0 then raise exception 'Transferencia requiere número de transferencia'; end if;
  end if;
  if p_sale_id is not null then
    if public.current_user_role() not in ('admin', 'contador', 'vendedor') then raise exception 'No autorizado para registrar pagos de ventas'; end if;
    select * into v_sale from public.sales where id = p_sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada'; end if;
    v_direction := 'entrada'; v_contact_id := v_sale.customer_id; v_rate := v_sale.ref_rate_ves;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;
    update public.sales set paid_ves = paid_ves + v_amount_ves,
      status = case when paid_ves + v_amount_ves >= total_ves then 'pagada'::public.sale_status else 'pendiente_pago'::public.sale_status end
    where id = p_sale_id returning paid_ves into v_paid_ves;
  else
    if public.current_user_role() not in ('admin', 'contador') then raise exception 'No autorizado para registrar pagos a proveedores'; end if;
    select * into v_purchase from public.purchases where id = p_purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada'; end if;
    v_direction := 'salida'; v_contact_id := v_purchase.supplier_id;
    select rate_ves into v_rate from public.exchange_rates where store_id = v_store_id order by created_at desc limit 1;
    if v_rate is null or v_rate <= 0 then v_rate := v_purchase.ref_rate_ves; end if;
    if p_method = 'efectivo_usd' then
      v_currency := 'USD'; v_amount_ref := round(p_amount, 2); v_amount_ves := round(p_amount * v_rate, 2);
    else
      v_currency := 'VES'; v_amount_ves := round(p_amount, 2); v_amount_ref := round(p_amount / v_rate, 2);
    end if;
    update public.purchases set paid_ves = paid_ves + v_amount_ves, paid_ref = paid_ref + v_amount_ref
    where id = p_purchase_id returning paid_ves, paid_ref into v_paid_ves, v_paid_ref;
  end if;
  insert into public.payments (direction, sale_id, purchase_id, contact_id, method, currency, amount, amount_ves, amount_ref,
    ref_rate_ves, bank_name, phone, reference_code, notes, created_by, store_id)
  values (v_direction, p_sale_id, p_purchase_id, v_contact_id, p_method, v_currency, p_amount, v_amount_ves, v_amount_ref,
    v_rate, nullif(trim(p_bank_name), ''), nullif(trim(p_phone), ''), p_reference_code, p_notes, auth.uid(), v_store_id)
  returning * into v_payment;

  if p_method in ('efectivo_ves', 'efectivo_usd') and p_sale_id is not null then
    v_session := public.get_open_cash_session_for_user(auth.uid(), v_store_id);
    if v_session.id is null and public.current_user_role() in ('admin', 'contador') then
      select * into v_session from public.cash_sessions
      where store_id = v_store_id and status = 'open' order by opened_at desc limit 1;
    end if;
    if v_session.id is null then
      raise exception 'No puede registrar un pago en efectivo: no tiene una sesión de caja abierta en su caja asignada';
    end if;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_session.id, 'sale_in', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo de venta'), auth.uid());
  elsif p_method in ('efectivo_ves', 'efectivo_usd') and p_purchase_id is not null then
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    v_movement_ves := case when p_method = 'efectivo_ves' then v_payment.amount_ves else 0 end;
    v_movement_ref := case when p_method = 'efectivo_usd' then v_payment.amount_ref else 0 end;
    if (p_method = 'efectivo_ves' and v_vault.balance_ves < v_movement_ves)
       or (p_method = 'efectivo_usd' and v_vault.balance_ref < v_movement_ref) then
      if p_method = 'efectivo_ves' then
        raise exception 'Saldo insuficiente en el baul. Faltante VES: %', greatest(v_movement_ves - v_vault.balance_ves, 0);
      else
        raise exception 'Saldo insuficiente en el baul. Faltante REF: %', greatest(v_movement_ref - v_vault.balance_ref, 0);
      end if;
    end if;
    update public.store_vaults set balance_ves = balance_ves - v_movement_ves,
      balance_ref = balance_ref - v_movement_ref where id = v_vault.id;
    insert into public.vault_movements (store_id, vault_id, type, amount_ves, amount_ref, payment_id, notes, created_by)
    values (v_store_id, v_vault.id, 'purchase_out', v_movement_ves, v_movement_ref, v_payment.id,
      coalesce(nullif(trim(p_notes), ''), 'Pago en efectivo a proveedor'), auth.uid());
  end if;
  return v_payment;
end;
$$;

create or replace function public.cancel_payment(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_payment public.payments; v_sale public.sales; v_purchase public.purchases;
  v_vault public.store_vaults; v_vault_movement public.vault_movements;
  v_new_paid_ves numeric(14,2); v_new_paid_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() not in ('admin', 'contador') then raise exception 'No autorizado para anular pagos'; end if;
  select * into v_payment from public.payments where id = p_payment_id and store_id = v_store_id for update;
  if not found then raise exception 'Pago no encontrado'; end if;
  if v_payment.status = 'anulado' then raise exception 'El pago ya fue anulado'; end if;
  if v_payment.sale_id is not null then
    select * into v_sale from public.sales where id = v_payment.sale_id and store_id = v_store_id for update;
    if not found then raise exception 'Venta no encontrada'; end if;
    if v_sale.status in ('cancelada', 'devuelta') then raise exception 'No se puede anular un pago de una venta cancelada o devuelta'; end if;
    if v_sale.paid_ves < v_payment.amount_ves then raise exception 'El monto del pago excede lo registrado en la venta'; end if;
    v_new_paid_ves := v_sale.paid_ves - v_payment.amount_ves;
    update public.sales set paid_ves = v_new_paid_ves, status = case
      when v_sale.status = 'borrador' then v_sale.status
      when v_new_paid_ves >= v_sale.total_ves then 'pagada'::public.sale_status
      else 'pendiente_pago'::public.sale_status end where id = v_payment.sale_id;
    if v_payment.method in ('efectivo_ves', 'efectivo_usd') then
      delete from public.cash_movements where payment_id = v_payment.id and store_id = v_store_id;
    end if;
  else
    select * into v_purchase from public.purchases where id = v_payment.purchase_id and store_id = v_store_id for update;
    if not found then raise exception 'Compra no encontrada'; end if;
    if v_purchase.status in ('cancelado', 'devuelto') then raise exception 'No se puede anular un pago de una compra cancelada o devuelta'; end if;
    if v_purchase.paid_ves < v_payment.amount_ves then raise exception 'El monto del pago excede lo registrado en la compra'; end if;
    if coalesce(v_purchase.paid_ref, 0) < v_payment.amount_ref then raise exception 'El monto REF del pago excede lo registrado en la compra'; end if;
    v_new_paid_ves := v_purchase.paid_ves - v_payment.amount_ves;
    v_new_paid_ref := greatest(round(coalesce(v_purchase.paid_ref, 0) - v_payment.amount_ref, 2), 0);
    update public.purchases set paid_ves = v_new_paid_ves, paid_ref = v_new_paid_ref where id = v_payment.purchase_id;
    if v_payment.method in ('efectivo_ves', 'efectivo_usd') then
      select * into v_vault_movement from public.vault_movements
      where payment_id = v_payment.id and store_id = v_store_id and type = 'purchase_out' for update;
      if found then
        select * into v_vault from public.store_vaults
        where id = v_vault_movement.vault_id and store_id = v_store_id for update;
        if not found then raise exception 'Baúl no encontrado para revertir el pago en efectivo'; end if;
        update public.store_vaults set balance_ves = balance_ves + v_vault_movement.amount_ves,
          balance_ref = balance_ref + v_vault_movement.amount_ref where id = v_vault.id;
        delete from public.vault_movements where id = v_vault_movement.id;
      end if;
    end if;
  end if;
  update public.payments set status = 'anulado', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;

insert into public.store_vaults (store_id)
select id from public.stores
on conflict (store_id) do nothing;

revoke all on function public.ensure_store_vault(uuid) from public;
revoke all on function public.get_open_cash_session_for_user(uuid, uuid) from public;
revoke all on function public.open_cash_session(uuid, numeric, numeric) from public;
revoke all on function public.close_cash_session(uuid, numeric, numeric) from public;
revoke all on function public.transfer_cash_to_vault(uuid, numeric, numeric, text) from public;
revoke all on function public.register_vault_deposit(numeric, numeric, text) from public;
revoke all on function public.register_vault_withdrawal(numeric, numeric, text) from public;
grant execute on function public.open_cash_session(uuid, numeric, numeric) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, numeric) to authenticated;
grant execute on function public.transfer_cash_to_vault(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.register_vault_deposit(numeric, numeric, text) to authenticated;
grant execute on function public.register_vault_withdrawal(numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
