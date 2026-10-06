-- =============================================================================
-- 20261006a — Libro mayor de stock como fuente de verdad unica + guardas
-- Proyecto: BodegaHub (plan stock-integrity, fase 5, STK-501)
--
-- products.current_stock solo cambia como efecto de insertar en
-- stock_movements. Este parche NO reescribe las RPC de stock: las versiones
-- vigentes siguen funcionando en "modo legado" (insertan el movimiento con
-- stock_after ya calculado y actualizan products a mano). Los parches b y c las
-- pasan a "modo estricto" (stock_after NULL: lo fija el trigger) y el parche e
-- elimina el modo legado y los pases marcados como TRANSITORIO.
--
-- Contenido:
--   1. stock_movements.seq + secuencia + trigger stock_movements_apply()
--   2. C2  guardas sobre products.current_stock (update e insert)
--   3. stock_movements solo-append para los roles de PostgREST
--   4. C9  assert_store_context() rechaza perfiles inactivos o inexistentes
--   5. C17 sales / purchases / payments (y sus lineas) solo se escriben por RPC
--   6. C18 las 7 vistas de reportes con security_invoker y sin acceso anon
--   7. Red de seguridad: ninguna funcion de public es ejecutable por anon/public
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Secuencia monotonica del libro y trigger que aplica el movimiento
-- -----------------------------------------------------------------------------

-- Nadie inserta movimientos entre el backfill y la creacion del trigger.
lock table public.stock_movements in share row exclusive mode;

create sequence if not exists public.stock_movements_seq as bigint;

alter table public.stock_movements add column if not exists seq bigint;

do $$
declare
  v_max bigint;
begin
  select coalesce(max(seq), 0) into v_max from public.stock_movements;

  update public.stock_movements m
  set seq = v_max + o.rn
  from (
    select id, row_number() over (order by created_at, id) as rn
    from public.stock_movements
    where seq is null
  ) o
  where m.id = o.id;

  select coalesce(max(seq), 0) into v_max from public.stock_movements;
  if v_max > 0 and v_max >= (select last_value from public.stock_movements_seq) then
    perform setval('public.stock_movements_seq', v_max, true);
  end if;
end;
$$;

alter table public.stock_movements alter column seq set not null;
alter sequence public.stock_movements_seq owned by public.stock_movements.seq;
create unique index if not exists stock_movements_seq_key on public.stock_movements (seq);

comment on column public.stock_movements.seq is
  'Orden real de la cadena por producto: lo asigna stock_movements_apply() con el producto bloqueado.';

-- El update de products va en el BEFORE (no en un AFTER) a proposito: los AFTER
-- ROW se disparan al final de la sentencia y un "insert ... select" con dos
-- filas del mismo producto romperia la cadena.
create or replace function public.stock_movements_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_stock integer;
  v_store_id uuid;
  v_rows integer;
begin
  select p.current_stock, p.store_id
  into v_current_stock, v_store_id
  from public.products p
  where p.id = new.product_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  if new.store_id is null then
    new.store_id := v_store_id;
  elsif new.store_id <> v_store_id then
    raise exception using
      errcode = 'PT409',
      message = 'El movimiento de stock no corresponde a la tienda del producto';
  end if;

  -- Despues del lock: el orden por seq es el orden real de la cadena del producto.
  new.seq := nextval('public.stock_movements_seq');

  if new.stock_after is null then
    -- Modo estricto: el trigger calcula el saldo y es el unico que escribe products.
    new.stock_after := v_current_stock + new.quantity_delta;

    if new.stock_after < 0 then
      raise exception using errcode = 'PT409', message = 'Stock insuficiente';
    end if;

    perform set_config('app.stock_writer', '1', true);

    update public.products
    set current_stock = new.stock_after
    where id = new.product_id;

    get diagnostics v_rows = row_count;
    perform set_config('app.stock_writer', '', true);

    if v_rows <> 1 then
      raise exception using
        errcode = 'PT409',
        message = 'No se pudo actualizar el stock del producto';
    end if;
  end if;
  -- Modo legado TRANSITORIO (stock_after no nulo): la RPC antigua ya actualizo
  -- products a mano; aqui solo se asigna seq. Lo elimina el parche e.

  return new;
end;
$$;

drop trigger if exists trg_stock_movements_apply on public.stock_movements;
create trigger trg_stock_movements_apply
before insert on public.stock_movements
for each row execute function public.stock_movements_apply();

-- -----------------------------------------------------------------------------
-- 2. C2 — products.current_stock no se escribe fuera del libro
-- -----------------------------------------------------------------------------

create or replace function public.products_stock_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Migraciones, one-shots y preparacion de tests: conexion directa a la base.
  -- Por PostgREST session_user es "authenticator" (admin, almacen y service_role quedan fuera).
  if session_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception using
      errcode = 'PT400',
      message = 'El stock inicial se registra con un movimiento inventario_inicial';
  end if;

  -- Escritura hecha por stock_movements_apply().
  if coalesce(current_setting('app.stock_writer', true), '') = '1' then
    return new;
  end if;

  -- TRANSITORIO hasta el parche e: RPC security definer legadas que todavia
  -- hacen "update products set current_stock" a mano.
  if current_user = 'postgres' then
    return new;
  end if;

  raise exception using
    errcode = 'PT409',
    message = 'El stock solo se modifica registrando un movimiento de inventario';
end;
$$;

drop trigger if exists trg_products_stock_guard_update on public.products;
create trigger trg_products_stock_guard_update
before update on public.products
for each row
when (new.current_stock is distinct from old.current_stock)
execute function public.products_stock_guard();

drop trigger if exists trg_products_stock_guard_insert on public.products;
create trigger trg_products_stock_guard_insert
before insert on public.products
for each row
when (new.current_stock <> 0)
execute function public.products_stock_guard();

-- -----------------------------------------------------------------------------
-- 3. stock_movements es solo-append: solo insertan las RPC security definer
-- -----------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on public.stock_movements from public, anon, authenticated, service_role;
revoke all on sequence public.stock_movements_seq from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. C9 — un perfil inactivo (o inexistente) no tiene contexto de tienda
--    Todas las RPC de stock, pagos y caja llaman a assert_store_context().
-- -----------------------------------------------------------------------------

create or replace function public.assert_store_context()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  select p.store_id
  into v_store_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;

  if v_store_id is null then
    raise exception 'No tienes permisos para realizar esta operacion en este recurso'
      using errcode = '42501';
  end if;

  return v_store_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. C17 — ventas, compras, pagos y sus lineas solo se escriben por RPC
--    Excepcion deliberada: el BFF edita metadatos por PostgREST
--    (sales.server.ts updateSale: notes, updated_at; payments.server.ts
--    updatePayment: bank_name, notes, phone, reference_code). Se conservan con
--    privilegio de UPDATE por columnas; estado e importes quedan fuera.
-- -----------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on public.sales, public.sale_items, public.purchases, public.purchase_items, public.payments
  from public, anon, authenticated;

grant update (notes, updated_at) on public.sales to authenticated;
grant update (bank_name, notes, phone, reference_code) on public.payments to authenticated;

drop policy if exists "Admins update sales" on public.sales;
create policy "Admins update sales"
on public.sales for update
to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() = 'admin')
with check (store_id = public.current_user_store_id() and public.current_user_role() = 'admin');

drop policy if exists "Admins update purchases" on public.purchases;

drop policy if exists "Admins and accountants update payment metadata" on public.payments;
create policy "Admins and accountants update payment metadata"
on public.payments for update
to authenticated
using (store_id = public.current_user_store_id() and public.current_user_role() in ('admin', 'contador'))
with check (store_id = public.current_user_store_id() and public.current_user_role() in ('admin', 'contador'));

-- -----------------------------------------------------------------------------
-- 6. C18 — vistas de reportes: RLS del que consulta y sin acceso anonimo
-- -----------------------------------------------------------------------------

do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'stock_card',
    'daily_sales_summary',
    'gross_profit_summary',
    'product_profitability',
    'customer_purchase_summary',
    'supplier_purchase_summary',
    'low_stock_products'
  ]
  loop
    if to_regclass(format('public.%I', v_view)) is null then
      continue;
    end if;
    execute format('alter view public.%I set (security_invoker = true)', v_view);
    execute format('revoke all on public.%I from public, anon, authenticated', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
