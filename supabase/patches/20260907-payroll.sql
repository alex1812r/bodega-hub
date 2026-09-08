-- =============================================================================
-- 20260907 — Nómina de cajeros por comisión sobre ventas
-- Idempotente y re-ejecutable. NO migra datos históricos: no calcula quincenas
-- pasadas ni crea empleados; todo eso lo hace el admin desde /payroll.
--
-- POR QUÉ
-- -------
-- Los cajeros (rol `vendedor`) cobran cada quincena un porcentaje de las ventas
-- que ellos mismos generaron y que ya están cobradas. No hay sueldo fijo. Hasta
-- ahora ese pago salía del baúl como un `withdrawal` genérico, indistinguible de
-- un retiro del dueño, y el cálculo se hacía a mano fuera del sistema.
--
-- QUÉ HACE
-- --------
-- 1. `payroll_settings`  — parámetros por tienda (% por defecto, umbral del
--    semáforo, roles elegibles, porcentajes informativos de reinversión/reserva).
-- 2. `payroll_employees` — el % de comisión de cada perfil elegible.
-- 3. `payroll_periods`   — la quincena (`YYYY-MM-Q1` / `YYYY-MM-Q2`) con su
--    snapshot de montos. Un periodo `pagado` es inmutable.
-- 4. `payroll_items`     — lo que le toca a cada cajero en esa quincena, con el
--    `commission_pct` congelado y el pago (método, moneda, tasa, movimiento).
-- 5. `payroll_commission_sales` — qué venta pagó qué comisión. El índice único
--    por `sale_id` garantiza que **una venta comisiona una sola vez en toda la
--    historia**. Se llena al APROBAR, no al calcular, para que recalcular un
--    borrador no deje ventas "gastadas".
-- 6. `vault_movements`: nuevo tipo `payroll_out` + columna `payroll_item_id`, y
--    `vault_balance_check` actualizada para contar el tipo nuevo como salida.
-- 7. RPC: settings, preview, compute, approve, pay, cancel.
-- 8. Índice parcial `sales (store_id, user_id, created_at)` para el cálculo.
--
-- NO HACE
-- -------
-- - No calcula sueldo mínimo, utilidades, prestaciones ni vacaciones. Un esquema
--   100 % variable debe validarlo un contador.
-- - No toca `payments` (esa tabla exige `contact_id` y un `sale_id`/`purchase_id`).
-- - No arrastra saldos negativos entre quincenas: si los reversos superan lo
--   devengado, el ítem queda en 0 y la diferencia no se persigue.
--
-- CONVENCIÓN DE SQLSTATE (heredada de 20260904-payment-guards.sql)
-- ---------------------------------------------------------------
--   PT400  validación de negocio            → 400 BAD_REQUEST
--   PT402  saldo insuficiente en el baúl    → 400 INSUFFICIENT_VAULT_BALANCE
--   PT403  falta de permisos                → 403 FORBIDDEN
--   PT404  recurso inexistente              → 404 NOT_FOUND
--   PT409  conflicto de estado              → 409 CONFLICT
--
-- ATENCIÓN
-- --------
-- El punto 6 reescribe `vault_balance_check`. Sin eso, todo pago de nómina
-- aparecería como un descuadre del baúl, porque la vista clasifica el signo de
-- cada movimiento por su `type` y no conocía `payroll_out`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. payroll_settings — parámetros de la tienda
-- -----------------------------------------------------------------------------

create table if not exists public.payroll_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  default_commission_pct numeric(5,2) not null default 3
    check (default_commission_pct between 0 and 100),
  warn_share_of_gross_profit_pct numeric(5,2) not null default 40
    check (warn_share_of_gross_profit_pct between 0 and 100),
  reinvest_pct numeric(5,2) not null default 45 check (reinvest_pct between 0 and 100),
  reserve_pct numeric(5,2) not null default 20 check (reserve_pct between 0 and 100),
  eligible_roles public.user_role[] not null default array['vendedor']::public.user_role[],
  updated_at timestamptz not null default now()
);

comment on table public.payroll_settings is
  'Parámetros de nómina por tienda. Los porcentajes de reinversión y reserva son informativos: solo alimentan el desglose del dueño.';

-- -----------------------------------------------------------------------------
-- 2. payroll_employees — el % de comisión de cada cajero
-- -----------------------------------------------------------------------------

create table if not exists public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  commission_pct numeric(5,2) not null check (commission_pct between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, profile_id)
);

create index if not exists payroll_employees_store_active_idx
  on public.payroll_employees (store_id, is_active);

-- -----------------------------------------------------------------------------
-- 3. payroll_periods — la quincena
-- -----------------------------------------------------------------------------

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_key text not null,
  from_date date not null,
  to_date date not null,
  status text not null default 'borrador'
    check (status in ('borrador', 'aprobado', 'pagado')),
  sales_ref numeric(14,2) not null default 0,
  commission_ref numeric(14,2) not null default 0,
  reversal_ref numeric(14,2) not null default 0,
  total_ref numeric(14,2) not null default 0,
  gross_profit_ref numeric(14,2),
  share_of_gross_profit_pct numeric(6,2),
  sales_without_cashier int not null default 0,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  paid_at timestamptz,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, period_key)
);

create index if not exists payroll_periods_store_from_date_idx
  on public.payroll_periods (store_id, from_date desc);

comment on column public.payroll_periods.gross_profit_ref is
  'Ganancia bruta de la quincena. Solo informa (semáforo); la comisión no depende de ella. Null si el reporte de margen no estuvo disponible.';
comment on column public.payroll_periods.sales_without_cashier is
  'Ventas cobradas de la quincena sin user_id (o del admin): no comisionan a nadie.';

-- -----------------------------------------------------------------------------
-- 4. payroll_items — lo que cobra cada cajero
-- -----------------------------------------------------------------------------

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.payroll_employees(id) on delete restrict,
  profile_id uuid not null references public.profiles(id),
  commission_pct numeric(5,2) not null,
  sales_count int not null default 0,
  sales_ref numeric(14,2) not null default 0,
  commission_ref numeric(14,2) not null default 0,
  reversal_ref numeric(14,2) not null default 0,
  total_ref numeric(14,2) not null default 0 check (total_ref >= 0),
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado')),
  paid_method public.payment_method,
  paid_currency public.payment_currency,
  paid_amount numeric(14,2),
  paid_ves numeric(14,2),
  paid_ref numeric(14,2),
  paid_rate_ves numeric(14,4),
  paid_reference text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  vault_movement_id uuid references public.vault_movements(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);

create index if not exists payroll_items_profile_period_idx
  on public.payroll_items (profile_id, period_id);
create index if not exists payroll_items_store_status_idx
  on public.payroll_items (store_id, status);

comment on column public.payroll_items.commission_pct is
  'Snapshot: cambiar el % del empleado no altera quincenas ya calculadas.';

-- -----------------------------------------------------------------------------
-- 5. payroll_commission_sales — una venta comisiona una sola vez
-- -----------------------------------------------------------------------------

create table if not exists public.payroll_commission_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  item_id uuid not null references public.payroll_items(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  kind text not null check (kind in ('normal', 'late', 'reversal')),
  sale_total_ref numeric(14,2) not null,
  commission_ref numeric(14,2) not null,
  created_at timestamptz not null default now()
);

-- Una venta se comisiona una vez (normal o cobrada tarde) y se revierte una vez.
drop index if exists public.payroll_commission_sales_once_idx;
create unique index payroll_commission_sales_once_idx
  on public.payroll_commission_sales (sale_id) where kind in ('normal', 'late');

drop index if exists public.payroll_commission_sales_reversal_once_idx;
create unique index payroll_commission_sales_reversal_once_idx
  on public.payroll_commission_sales (sale_id) where kind = 'reversal';

create index if not exists payroll_commission_sales_item_idx
  on public.payroll_commission_sales (item_id);

comment on table public.payroll_commission_sales is
  'Ventas que ya pagaron comisión. Se escribe al APROBAR el periodo, no al calcularlo: así recalcular un borrador no consume ventas.';

-- -----------------------------------------------------------------------------
-- 6. Triggers de updated_at
-- -----------------------------------------------------------------------------

drop trigger if exists trg_payroll_settings_updated_at on public.payroll_settings;
create trigger trg_payroll_settings_updated_at
before update on public.payroll_settings
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_employees_updated_at on public.payroll_employees;
create trigger trg_payroll_employees_updated_at
before update on public.payroll_employees
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_periods_updated_at on public.payroll_periods;
create trigger trg_payroll_periods_updated_at
before update on public.payroll_periods
for each row execute function public.set_updated_at();

drop trigger if exists trg_payroll_items_updated_at on public.payroll_items;
create trigger trg_payroll_items_updated_at
before update on public.payroll_items
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Baúl: tipo de movimiento propio para la nómina
-- -----------------------------------------------------------------------------

alter table public.vault_movements
  add column if not exists payroll_item_id uuid references public.payroll_items(id);

create index if not exists vault_movements_payroll_item_id_idx
  on public.vault_movements (payroll_item_id) where payroll_item_id is not null;

alter table public.vault_movements drop constraint if exists vault_movements_type_check;
alter table public.vault_movements
  add constraint vault_movements_type_check
  check (type in (
    'transfer_in', 'purchase_out', 'deposit', 'withdrawal', 'adjustment', 'sale_in',
    'payroll_out'
  ));

-- La vista de cuadre clasifica el signo por `type`: sin esta reescritura todo
-- pago de nómina se vería como un descuadre del baúl.
drop view if exists public.vault_balance_check;
create view public.vault_balance_check
with (security_invoker = true)
as
with expected as (
  select
    store_id,
    sum(case when bucket = 'efectivo' then case
      when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ves
      when type in ('purchase_out', 'withdrawal', 'payroll_out') then -amount_ves else 0 end else 0 end) as efectivo_ves,
    sum(case when bucket = 'efectivo' then case
      when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ref
      when type in ('purchase_out', 'withdrawal', 'payroll_out') then -amount_ref else 0 end else 0 end) as efectivo_ref,
    sum(case when bucket = 'cuenta' then case
      when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ves
      when type in ('purchase_out', 'withdrawal', 'payroll_out') then -amount_ves else 0 end else 0 end) as cuenta_ves
  from public.vault_movements
  group by store_id
)
select
  v.store_id,
  s.name as store_name,
  x.concepto,
  round(x.esperado, 2) as esperado,
  round(x.actual, 2) as actual,
  round(x.esperado - x.actual, 2) as diferencia
from public.store_vaults v
join public.stores s on s.id = v.store_id
left join expected e on e.store_id = v.store_id
cross join lateral (values
  ('EFECTIVO VES', coalesce(e.efectivo_ves, 0), v.balance_efectivo_ves),
  ('EFECTIVO REF', coalesce(e.efectivo_ref, 0), v.balance_ref),
  ('CUENTA VES', coalesce(e.cuenta_ves, 0), v.balance_ves)
) as x(concepto, esperado, actual);

comment on view public.vault_balance_check is
  'Saldo esperado por cubeta (calculado desde vault_movements) contra store_vaults. docs/cuadre-baul.md §4 item 5.';

-- -----------------------------------------------------------------------------
-- 8. Índice para el cálculo de comisiones
-- -----------------------------------------------------------------------------

create index if not exists idx_sales_store_user_created_at
  on public.sales (store_id, user_id, created_at desc)
  where status not in ('cancelada', 'devuelta');

-- -----------------------------------------------------------------------------
-- 9. RLS
-- -----------------------------------------------------------------------------

alter table public.payroll_settings enable row level security;
alter table public.payroll_employees enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_items enable row level security;
alter table public.payroll_commission_sales enable row level security;

drop policy if exists "Admins manage payroll settings" on public.payroll_settings;
create policy "Admins manage payroll settings" on public.payroll_settings for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

drop policy if exists "Admins manage payroll employees" on public.payroll_employees;
create policy "Admins manage payroll employees" on public.payroll_employees for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

-- El cajero ve la quincena solo si tiene un ítem en ella.
drop policy if exists "Users read own payroll periods" on public.payroll_periods;
create policy "Users read own payroll periods" on public.payroll_periods for select to authenticated
using (store_id = public.current_user_store_id() and (
  public.current_user_role() = 'admin'
  or exists (
    select 1 from public.payroll_items i
    where i.period_id = payroll_periods.id and i.profile_id = auth.uid()
  )
));

drop policy if exists "Admins manage payroll periods" on public.payroll_periods;
create policy "Admins manage payroll periods" on public.payroll_periods for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

drop policy if exists "Users read own payroll items" on public.payroll_items;
create policy "Users read own payroll items" on public.payroll_items for select to authenticated
using (store_id = public.current_user_store_id() and (
  public.current_user_role() = 'admin' or profile_id = auth.uid()
));

drop policy if exists "Admins manage payroll items" on public.payroll_items;
create policy "Admins manage payroll items" on public.payroll_items for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

drop policy if exists "Users read own payroll commission sales" on public.payroll_commission_sales;
create policy "Users read own payroll commission sales" on public.payroll_commission_sales for select to authenticated
using (store_id = public.current_user_store_id() and (
  public.current_user_role() = 'admin'
  or exists (
    select 1 from public.payroll_items i
    where i.id = payroll_commission_sales.item_id and i.profile_id = auth.uid()
  )
));

drop policy if exists "Admins manage payroll commission sales" on public.payroll_commission_sales;
create policy "Admins manage payroll commission sales" on public.payroll_commission_sales for all to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

-- -----------------------------------------------------------------------------
-- 10. Helpers internos
-- -----------------------------------------------------------------------------

-- Rango [inicio, fin) en UTC del día operativo Caracas de una fecha calendario.
create or replace function public.payroll_caracas_bounds(p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
immutable
set search_path = public
as $$
  select
    (p_from::text || ' 04:00:00+00')::timestamptz,
    ((p_to + 1)::text || ' 04:00:00+00')::timestamptz;
$$;

create or replace function public.payroll_assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un administrador puede gestionar la nómina'
      using errcode = 'PT403';
  end if;

  return v_store_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. upsert_payroll_settings
-- -----------------------------------------------------------------------------

create or replace function public.upsert_payroll_settings(
  p_default_commission_pct numeric default null,
  p_warn_share_of_gross_profit_pct numeric default null,
  p_reinvest_pct numeric default null,
  p_reserve_pct numeric default null,
  p_eligible_roles text[] default null
)
returns public.payroll_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_settings public.payroll_settings;
  v_roles public.user_role[];
begin
  v_store_id := public.payroll_assert_admin();

  if p_eligible_roles is not null then
    if array_length(p_eligible_roles, 1) is null then
      raise exception 'Debe haber al menos un rol elegible para la nómina'
        using errcode = 'PT400';
    end if;

    if exists (select 1 from unnest(p_eligible_roles) r where r in ('admin', 'superadmin')) then
      raise exception 'El administrador no cobra nómina: sus retiros salen del baúl'
        using errcode = 'PT400';
    end if;

    v_roles := p_eligible_roles::public.user_role[];
  end if;

  insert into public.payroll_settings as s (store_id)
  values (v_store_id)
  on conflict (store_id) do nothing;

  update public.payroll_settings s
  set default_commission_pct = coalesce(p_default_commission_pct, s.default_commission_pct),
      warn_share_of_gross_profit_pct =
        coalesce(p_warn_share_of_gross_profit_pct, s.warn_share_of_gross_profit_pct),
      reinvest_pct = coalesce(p_reinvest_pct, s.reinvest_pct),
      reserve_pct = coalesce(p_reserve_pct, s.reserve_pct),
      eligible_roles = coalesce(v_roles, s.eligible_roles),
      updated_at = now()
  where s.store_id = v_store_id
  returning * into v_settings;

  return v_settings;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. upsert_payroll_employee
-- -----------------------------------------------------------------------------

create or replace function public.upsert_payroll_employee(
  p_profile_id uuid,
  p_commission_pct numeric,
  p_is_active boolean default true
)
returns public.payroll_employees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_employee public.payroll_employees;
  v_role public.user_role;
begin
  v_store_id := public.payroll_assert_admin();

  if p_commission_pct is null or p_commission_pct < 0 or p_commission_pct > 100 then
    raise exception 'El porcentaje de comisión debe estar entre 0 y 100'
      using errcode = 'PT400';
  end if;

  select role into v_role
  from public.profiles
  where id = p_profile_id and store_id = v_store_id;

  if v_role is null then
    raise exception 'El empleado no pertenece a esta tienda'
      using errcode = 'PT404';
  end if;

  if v_role in ('admin', 'superadmin') then
    raise exception 'El administrador no cobra nómina: sus retiros salen del baúl'
      using errcode = 'PT400';
  end if;

  insert into public.payroll_employees (store_id, profile_id, commission_pct, is_active)
  values (v_store_id, p_profile_id, round(p_commission_pct, 2), coalesce(p_is_active, true))
  on conflict (store_id, profile_id) do update
    set commission_pct = excluded.commission_pct,
        is_active = excluded.is_active,
        updated_at = now()
  returning * into v_employee;

  return v_employee;
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. preview_payroll_commissions — el cálculo, sin escribir nada
--
-- Devuelve una fila por venta candidata. Tres clases:
--   normal   — venta pagada dentro de la quincena, sin comisionar todavía
--   late     — venta anterior a la quincena, cobrada después; entra ahora
--   reversal — venta ya comisionada que quedó cancelada o devuelta; resta
-- -----------------------------------------------------------------------------

create or replace function public.preview_payroll_commissions(
  p_from date,
  p_to date
)
returns table (
  profile_id uuid,
  employee_id uuid,
  full_name text,
  commission_pct numeric,
  sale_id uuid,
  invoice_number text,
  sale_created_at timestamptz,
  kind text,
  sale_total_ref numeric,
  commission_ref numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  v_store_id := public.payroll_assert_admin();

  select b.starts_at, b.ends_at into v_starts_at, v_ends_at
  from public.payroll_caracas_bounds(p_from, p_to) b;

  return query
  with eligible as (
    select e.id as employee_id, e.profile_id, e.commission_pct, p.full_name
    from public.payroll_employees e
    join public.profiles p on p.id = e.profile_id
    where e.store_id = v_store_id
      and e.is_active = true
      and p.is_active = true
  ),
  commissionable as (
    -- Ventas cobradas que aún no comisionaron. `late` = venta anterior al rango
    -- que se cobró después; entra en la quincena que se calcule tras cobrarla.
    select
      el.profile_id,
      el.employee_id,
      el.full_name,
      el.commission_pct,
      s.id as sale_id,
      s.invoice_number,
      s.created_at as sale_created_at,
      case when s.created_at >= v_starts_at then 'normal' else 'late' end as kind,
      s.total_ref as sale_total_ref,
      round(s.total_ref * el.commission_pct / 100, 2) as commission_ref
    from public.sales s
    join eligible el on el.profile_id = s.user_id
    where s.store_id = v_store_id
      and s.status = 'pagada'
      and s.created_at < v_ends_at
      and not exists (
        select 1 from public.payroll_commission_sales cs
        where cs.sale_id = s.id and cs.kind in ('normal', 'late')
      )
  ),
  reversals as (
    -- Ventas ya comisionadas que quedaron canceladas o devueltas: se descuenta
    -- lo que se pagó por ellas, una sola vez.
    select
      el.profile_id,
      el.employee_id,
      el.full_name,
      el.commission_pct,
      s.id as sale_id,
      s.invoice_number,
      s.created_at as sale_created_at,
      'reversal' as kind,
      s.total_ref as sale_total_ref,
      -abs(cs.commission_ref) as commission_ref
    from public.payroll_commission_sales cs
    join public.sales s on s.id = cs.sale_id
    join public.payroll_items it on it.id = cs.item_id
    join eligible el on el.profile_id = it.profile_id
    where cs.store_id = v_store_id
      and cs.kind in ('normal', 'late')
      and s.status in ('cancelada', 'devuelta')
      and not exists (
        select 1 from public.payroll_commission_sales r
        where r.sale_id = cs.sale_id and r.kind = 'reversal'
      )
  )
  select * from commissionable
  union all
  select * from reversals;
end;
$$;

-- Cuántas ventas cobradas de la quincena no comisionan a nadie.
create or replace function public.payroll_sales_without_cashier(
  p_from date,
  p_to date
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_count integer;
begin
  v_store_id := public.payroll_assert_admin();

  select b.starts_at, b.ends_at into v_starts_at, v_ends_at
  from public.payroll_caracas_bounds(p_from, p_to) b;

  select count(*) into v_count
  from public.sales s
  left join public.payroll_employees e
    on e.profile_id = s.user_id and e.store_id = v_store_id and e.is_active = true
  where s.store_id = v_store_id
    and s.status = 'pagada'
    and s.created_at >= v_starts_at
    and s.created_at < v_ends_at
    and e.id is null;

  return coalesce(v_count, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. compute_payroll_period — crea o recalcula el borrador
-- -----------------------------------------------------------------------------

create or replace function public.compute_payroll_period(
  p_period_key text,
  p_from date,
  p_to date,
  p_gross_profit_ref numeric default null
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_period public.payroll_periods;
  v_today date;
begin
  v_store_id := public.payroll_assert_admin();

  if p_period_key is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'Rango de quincena inválido' using errcode = 'PT400';
  end if;

  -- Día operativo Caracas de hoy.
  v_today := (now() at time zone 'America/Caracas')::date;

  if p_to >= v_today then
    raise exception 'La quincena no ha terminado: solo se puede estimar hasta que cierre el %',
      to_char(p_to, 'DD/MM/YYYY') using errcode = 'PT400';
  end if;

  select * into v_period
  from public.payroll_periods
  where store_id = v_store_id and period_key = p_period_key
  for update;

  if found and v_period.status <> 'borrador' then
    raise exception 'La quincena ya está % y no se puede recalcular', v_period.status
      using errcode = 'PT409';
  end if;

  if not found then
    insert into public.payroll_periods (
      store_id, period_key, from_date, to_date, created_by
    ) values (
      v_store_id, p_period_key, p_from, p_to, auth.uid()
    )
    returning * into v_period;
  end if;

  -- Recalcular desde cero: los ítems de un borrador son desechables.
  delete from public.payroll_items where period_id = v_period.id;

  insert into public.payroll_items (
    store_id, period_id, employee_id, profile_id, commission_pct,
    sales_count, sales_ref, commission_ref, reversal_ref, total_ref
  )
  select
    v_store_id,
    v_period.id,
    c.employee_id,
    c.profile_id,
    c.commission_pct,
    count(*) filter (where c.kind <> 'reversal'),
    coalesce(sum(c.sale_total_ref) filter (where c.kind <> 'reversal'), 0),
    coalesce(sum(c.commission_ref) filter (where c.kind <> 'reversal'), 0),
    coalesce(sum(c.commission_ref) filter (where c.kind = 'reversal'), 0),
    greatest(0, coalesce(sum(c.commission_ref), 0))
  from public.preview_payroll_commissions(p_from, p_to) c
  group by c.employee_id, c.profile_id, c.commission_pct;

  -- Los cajeros activos sin ventas también reciben su ítem, en cero: así el
  -- dueño ve que no se le olvidó nadie y la quincena se cierra completa.
  insert into public.payroll_items (
    store_id, period_id, employee_id, profile_id, commission_pct
  )
  select v_store_id, v_period.id, e.id, e.profile_id, e.commission_pct
  from public.payroll_employees e
  join public.profiles p on p.id = e.profile_id
  where e.store_id = v_store_id and e.is_active = true and p.is_active = true
  on conflict (period_id, employee_id) do nothing;

  update public.payroll_periods p
  set from_date = p_from,
      to_date = p_to,
      gross_profit_ref = p_gross_profit_ref,
      sales_without_cashier = public.payroll_sales_without_cashier(p_from, p_to),
      sales_ref = coalesce(agg.sales_ref, 0),
      commission_ref = coalesce(agg.commission_ref, 0),
      reversal_ref = coalesce(agg.reversal_ref, 0),
      total_ref = coalesce(agg.total_ref, 0),
      share_of_gross_profit_pct = case
        when p_gross_profit_ref is null or p_gross_profit_ref <= 0 then null
        else round(coalesce(agg.commission_ref, 0) / p_gross_profit_ref * 100, 2)
      end,
      updated_at = now()
  from (
    select
      sum(sales_ref) as sales_ref,
      sum(commission_ref) as commission_ref,
      sum(reversal_ref) as reversal_ref,
      sum(total_ref) as total_ref
    from public.payroll_items
    where period_id = v_period.id
  ) agg
  where p.id = v_period.id
  returning p.* into v_period;

  return v_period;
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. approve_payroll_period — congela el cálculo y consume las ventas
-- -----------------------------------------------------------------------------

create or replace function public.approve_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_period public.payroll_periods;
  v_items integer;
begin
  v_store_id := public.payroll_assert_admin();

  select * into v_period
  from public.payroll_periods
  where id = p_period_id and store_id = v_store_id
  for update;

  if not found then
    raise exception 'La quincena no existe' using errcode = 'PT404';
  end if;

  if v_period.status <> 'borrador' then
    raise exception 'La quincena ya está %', v_period.status using errcode = 'PT409';
  end if;

  -- Recalcular una última vez dentro de la transacción: entre calcular y
  -- aprobar pudieron cancelarse ventas.
  v_period := public.compute_payroll_period(
    v_period.period_key, v_period.from_date, v_period.to_date, v_period.gross_profit_ref
  );

  select count(*) into v_items from public.payroll_items where period_id = v_period.id;

  if v_items = 0 then
    raise exception 'No hay empleados con comisión configurada para esta quincena'
      using errcode = 'PT400';
  end if;

  -- Consumir las ventas. El índice único falla si otra quincena ya se llevó
  -- alguna (carrera entre dos aprobaciones con una venta cobrada tarde).
  begin
    insert into public.payroll_commission_sales (
      store_id, item_id, sale_id, kind, sale_total_ref, commission_ref
    )
    select v_store_id, it.id, c.sale_id, c.kind, c.sale_total_ref, c.commission_ref
    from public.preview_payroll_commissions(v_period.from_date, v_period.to_date) c
    join public.payroll_items it
      on it.period_id = v_period.id and it.employee_id = c.employee_id;
  exception when unique_violation then
    raise exception 'Otra quincena ya comisionó alguna de estas ventas. Recalcula antes de aprobar.'
      using errcode = 'PT409';
  end;

  update public.payroll_periods
  set status = 'aprobado', approved_at = now(), approved_by = auth.uid(), updated_at = now()
  where id = v_period.id
  returning * into v_period;

  return v_period;
end;
$$;

-- -----------------------------------------------------------------------------
-- 16. pay_payroll_item — saca el dinero del baúl
-- -----------------------------------------------------------------------------

create or replace function public.pay_payroll_item(
  p_item_id uuid,
  p_method public.payment_method,
  p_amount numeric,
  p_bank_name text default null,
  p_reference text default null
)
returns public.payroll_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_item public.payroll_items;
  v_period public.payroll_periods;
  v_vault public.store_vaults;
  v_rate numeric(14,4);
  v_bucket text;
  v_currency public.payment_currency;
  v_amount_ves numeric(14,2) := 0;
  v_amount_ref numeric(14,2) := 0;
  v_movement_id uuid;
  v_pending integer;
begin
  v_store_id := public.payroll_assert_admin();

  select * into v_item
  from public.payroll_items
  where id = p_item_id and store_id = v_store_id
  for update;

  if not found then
    raise exception 'El recibo de nómina no existe' using errcode = 'PT404';
  end if;

  if v_item.status = 'pagado' then
    raise exception 'Este recibo ya fue pagado' using errcode = 'PT409';
  end if;

  select * into v_period from public.payroll_periods where id = v_item.period_id for update;

  if v_period.status = 'borrador' then
    raise exception 'Aprueba la quincena antes de pagar' using errcode = 'PT400';
  end if;

  -- Un cajero sin ventas no mueve dinero: se marca pagado y ya.
  if v_item.total_ref <= 0 then
    update public.payroll_items
    set status = 'pagado', paid_at = now(), paid_by = auth.uid(),
        paid_amount = 0, paid_ves = 0, paid_ref = 0, updated_at = now()
    where id = v_item.id
    returning * into v_item;
  else
    if p_amount is null or p_amount <= 0 then
      raise exception 'El monto a pagar debe ser mayor a cero' using errcode = 'PT400';
    end if;

    select rate_ves into v_rate
    from public.exchange_rates
    where store_id = v_store_id
    order by created_at desc
    limit 1;

    if v_rate is null or v_rate <= 0 then
      raise exception 'No hay una tasa de cambio vigente para pagar la nómina'
        using errcode = 'PT400';
    end if;

    if p_method = 'efectivo_usd' then
      v_bucket := 'efectivo';
      v_currency := 'USD';
      v_amount_ref := round(p_amount, 2);
      v_amount_ves := 0;
    elsif p_method = 'efectivo_ves' then
      v_bucket := 'efectivo';
      v_currency := 'VES';
      v_amount_ves := round(p_amount, 2);
      v_amount_ref := 0;
    elsif p_method in ('pago_movil', 'transferencia') then
      v_bucket := 'cuenta';
      v_currency := 'VES';
      v_amount_ves := round(p_amount, 2);
      v_amount_ref := 0;
    else
      raise exception 'La nómina no se puede pagar por punto de venta'
        using errcode = 'PT400';
    end if;

    if p_method in ('pago_movil', 'transferencia')
       and coalesce(trim(p_reference), '') = '' then
      raise exception 'Indica la referencia del pago' using errcode = 'PT400';
    end if;

    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;

    if v_bucket = 'efectivo' and v_currency = 'VES'
       and v_amount_ves > v_vault.balance_efectivo_ves then
      raise exception 'Saldo insuficiente en el baul (efectivo). Faltante VES: %',
        round(v_amount_ves - v_vault.balance_efectivo_ves, 2) using errcode = 'PT402';
    end if;

    if v_bucket = 'efectivo' and v_currency = 'USD'
       and v_amount_ref > v_vault.balance_ref then
      raise exception 'Saldo insuficiente en el baul. Faltante REF: %',
        round(v_amount_ref - v_vault.balance_ref, 2) using errcode = 'PT402';
    end if;

    if v_bucket = 'cuenta' and v_amount_ves > v_vault.balance_ves then
      raise exception 'Saldo insuficiente en el baul (cuenta). Faltante VES: %',
        round(v_amount_ves - v_vault.balance_ves, 2) using errcode = 'PT402';
    end if;

    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by,
      payroll_item_id
    ) values (
      v_store_id, v_vault.id, 'payroll_out', v_bucket, v_amount_ves, v_amount_ref,
      concat_ws(' · ',
        'Nómina ' || v_period.period_key,
        nullif(trim(p_bank_name), ''),
        nullif(trim(p_reference), '')
      ),
      auth.uid(), v_item.id
    )
    returning id into v_movement_id;

    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves
          - case when v_bucket = 'efectivo' then v_amount_ves else 0 end,
        balance_ref = balance_ref
          - case when v_bucket = 'efectivo' then v_amount_ref else 0 end,
        balance_ves = balance_ves
          - case when v_bucket = 'cuenta' then v_amount_ves else 0 end
    where id = v_vault.id;

    update public.payroll_items
    set status = 'pagado',
        paid_method = p_method,
        paid_currency = v_currency,
        paid_amount = round(p_amount, 2),
        paid_ves = v_amount_ves,
        paid_ref = case
          when v_currency = 'USD' then v_amount_ref
          else round(v_amount_ves / v_rate, 2)
        end,
        paid_rate_ves = v_rate,
        paid_reference = nullif(trim(p_reference), ''),
        paid_at = now(),
        paid_by = auth.uid(),
        vault_movement_id = v_movement_id,
        updated_at = now()
    where id = v_item.id
    returning * into v_item;
  end if;

  select count(*) into v_pending
  from public.payroll_items
  where period_id = v_item.period_id and status = 'pendiente';

  if v_pending = 0 then
    update public.payroll_periods
    set status = 'pagado', paid_at = now(), updated_at = now()
    where id = v_item.period_id;
  end if;

  return v_item;
end;
$$;

-- -----------------------------------------------------------------------------
-- 17. cancel_payroll_payment — devuelve el dinero al baúl
-- -----------------------------------------------------------------------------

create or replace function public.cancel_payroll_payment(
  p_item_id uuid,
  p_notes text default null
)
returns public.payroll_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_item public.payroll_items;
  v_movement public.vault_movements;
  v_vault public.store_vaults;
begin
  v_store_id := public.payroll_assert_admin();

  select * into v_item
  from public.payroll_items
  where id = p_item_id and store_id = v_store_id
  for update;

  if not found then
    raise exception 'El recibo de nómina no existe' using errcode = 'PT404';
  end if;

  if v_item.status <> 'pagado' then
    raise exception 'Este recibo no está pagado' using errcode = 'PT409';
  end if;

  if coalesce(trim(p_notes), '') = '' then
    raise exception 'Explica por qué se anula el pago' using errcode = 'PT400';
  end if;

  if v_item.vault_movement_id is not null then
    select * into v_movement from public.vault_movements where id = v_item.vault_movement_id;

    select * into v_vault from public.store_vaults where store_id = v_store_id for update;

    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves
          + case when v_movement.bucket = 'efectivo' then v_movement.amount_ves else 0 end,
        balance_ref = balance_ref
          + case when v_movement.bucket = 'efectivo' then v_movement.amount_ref else 0 end,
        balance_ves = balance_ves
          + case when v_movement.bucket = 'cuenta' then v_movement.amount_ves else 0 end
    where id = v_vault.id;

    delete from public.vault_movements where id = v_item.vault_movement_id;
  end if;

  update public.payroll_items
  set status = 'pendiente',
      paid_method = null, paid_currency = null, paid_amount = null,
      paid_ves = null, paid_ref = null, paid_rate_ves = null, paid_reference = null,
      paid_at = null, paid_by = null, vault_movement_id = null,
      updated_at = now()
  where id = v_item.id
  returning * into v_item;

  -- El periodo vuelve a estar abierto para pagos. Las ventas comisionadas no se
  -- tocan: siguen consumidas, porque el cálculo no se deshace.
  update public.payroll_periods
  set status = 'aprobado',
      paid_at = null,
      notes = concat_ws(E'\n', notes, 'Pago anulado: ' || trim(p_notes)),
      updated_at = now()
  where id = v_item.period_id and status = 'pagado';

  return v_item;
end;
$$;

-- -----------------------------------------------------------------------------
-- 18. Permisos
-- -----------------------------------------------------------------------------

revoke all on function public.payroll_caracas_bounds(date, date) from public;
revoke all on function public.payroll_assert_admin() from public;
revoke all on function public.payroll_sales_without_cashier(date, date) from public;
revoke all on function public.upsert_payroll_settings(numeric, numeric, numeric, numeric, text[]) from public;
revoke all on function public.upsert_payroll_employee(uuid, numeric, boolean) from public;
revoke all on function public.preview_payroll_commissions(date, date) from public;
revoke all on function public.compute_payroll_period(text, date, date, numeric) from public;
revoke all on function public.approve_payroll_period(uuid) from public;
revoke all on function public.pay_payroll_item(uuid, public.payment_method, numeric, text, text) from public;
revoke all on function public.cancel_payroll_payment(uuid, text) from public;

grant execute on function public.upsert_payroll_settings(numeric, numeric, numeric, numeric, text[]) to authenticated;
grant execute on function public.upsert_payroll_employee(uuid, numeric, boolean) to authenticated;
grant execute on function public.preview_payroll_commissions(date, date) to authenticated;
grant execute on function public.compute_payroll_period(text, date, date, numeric) to authenticated;
grant execute on function public.approve_payroll_period(uuid) to authenticated;
grant execute on function public.pay_payroll_item(uuid, public.payment_method, numeric, text, text) to authenticated;
grant execute on function public.cancel_payroll_payment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
