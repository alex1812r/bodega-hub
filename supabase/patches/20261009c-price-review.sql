-- =============================================================================
-- 20261009c — cola "Por revisar" de precios (PRO-11; plan ux-mejoras, Ola 1;
--             reglas 9, 10 y 10b)
-- Proyecto: BodegaHub
-- Requiere: 20261006a (public.stock_movements_seq y stock_movements.seq),
--           20261006h (update_product_price vigente, assert_finite_numeric y
--           RLS por tienda de product_price_history), 20261006i (funcion
--           public.reject_non_finite_numeric), 20261009a (products.margin_pct)
--           y 20261009b (umbrales del semaforo en app_settings).
--
-- Regla 10b: al fijar un precio se guarda el costo y la banda de ganancia del
-- momento. Si despues el costo SUBE y la banda actual es PEOR que la guardada
-- (verde -> amarillo, amarillo -> rojo, verde -> rojo), el producto entra en
-- "Por revisar" hasta que se cambie el precio o se elija "Mantener precio",
-- que vuelve a guardar costo y banda. Nada aqui cambia un precio por su cuenta
-- ni bloquea una venta.
--
--   1. product_price_history gana tres columnas (las tres o ninguna):
--        * cost_ref_snapshot    numeric  costo vigente al guardar la fila.
--        * margin_band_snapshot text     'red' | 'yellow' | 'green' | 'none'
--                                        ('none' = producto sin costo).
--        * snapshot_seq         bigint   posicion de la fila en el libro de la
--                                        tienda: sale de la MISMA secuencia que
--                                        stock_movements.seq. Las fechas no
--                                        sirven para ordenar (now() es el inicio
--                                        de la transaccion): con la secuencia,
--                                        "la ultima instantanea del producto" y
--                                        "las compras recibidas despues de ella"
--                                        son comparaciones exactas. Solo consume
--                                        numeros de la secuencia: no escribe ni
--                                        lee stock.
--      Las filas anteriores al parche quedan con las tres en NULL: no se
--      inventa un costo historico.
--   2. margin_band_from_thresholds(pct, amarillo_desde, verde_desde): la regla
--      de bordes de @bodega/core (packages/core/src/pricing.ts, marginBand):
--      rojo < amarillo_desde; amarillo < verde_desde; verde >= verde_desde;
--      NULL (sin costo) -> 'none'. margin_band_rank: rojo 0 < amarillo 1 < verde 2.
--      product_margin_band(store_id, pct): la misma regla con los umbrales de
--      app_settings de la tienda (15 / 25 si la tienda no tiene fila).
--   3. update_product_price: copia literal de 20261006h. Misma firma, mismas
--      validaciones, permisos, bloqueos, errores y efecto sobre products. Lo
--      unico nuevo: la fila de historial que ya insertaba lleva la instantanea
--      (costo vigente y banda que resulta con el precio nuevo).
--   4. keep_product_price(p_product_id, p_reason): "Mantener precio". Mismo rol
--      que update_product_price (admin / almacen; PT403), bloquea el producto
--      (PT404 si no es de la tienda) e inserta una fila de historial con precio
--      anterior = nuevo = actual y la instantanea actual. No toca products ni
--      stock. Igual que update_product_price, no distingue producto inactivo.
--   5. Linea base, para que un producto que nunca paso por update_product_price
--      tambien pueda entrar en la cola:
--        a. Backfill: una fila 'Línea base de ganancia' (precio anterior = nuevo
--           = actual, costo y banda actuales) por cada producto SIN ninguna fila
--           con instantanea. Reaplicar el parche no inserta nada mas (un producto
--           con instantanea nunca recibe otra linea base: eso lo sacaria de la
--           cola sin que nadie lo decidiera).
--        b. Altas: trigger trg_products_price_baseline (after insert, security
--           definer, tienda del propio producto) que inserta esa misma fila. Un
--           insert por producto; no escribe products (no cruza con
--           products_stock_guard) y vale igual para el formulario, la
--           importacion masiva y las RPC que crean productos.
--   6. Vista products_price_review (security_invoker): una fila por producto
--      ACTIVO cuyo costo actual es mayor que el de su ultima instantanea y cuya
--      banda actual es peor que la de esa instantanea ('none' en cualquiera de
--      los dos lados no entra). Trae el % anterior (precio vigente sobre el
--      costo de la instantanea), el % actual y la compra recibida mas reciente
--      posterior a la instantanea que incluye el producto (NULL si el costo
--      cambio por otra via: edicion, importacion), con su proveedor.
--      price_review(products): relacion calculada de PostgREST (una fila como
--      mucho) para que el listado de productos filtre "solo en la cola" con
--      products?select=...,price_review!inner(...) sin pasar listas de ids.
--   7. Triggers de 20261006i regenerados para product_price_history (la columna
--      numeric nueva no entra sola). Mismo generador, acotado a esa tabla.
--
-- No toca stock, dinero, precios, politicas ni las RPC de compras
-- (create_purchase / receive_purchase siguen escribiendo current_cost_ref como
-- hasta ahora; la cola se entera sola porque compara contra products).
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up ANTES
-- de desplegar el BFF que lee la vista y llama a keep_product_price.
-- OJO: reaplicar 20261006g o 20261006h reinstala update_product_price sin la
-- instantanea: volver a aplicar este parche despues. Tras reaplicar 20261006i
-- no hace falta reaplicar este (su barrido ya incluye la columna nueva).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Columnas de la instantanea.
-- -----------------------------------------------------------------------------

alter table public.product_price_history
  add column if not exists cost_ref_snapshot numeric,
  add column if not exists margin_band_snapshot text,
  add column if not exists snapshot_seq bigint;

comment on column public.product_price_history.cost_ref_snapshot is
  'Costo del producto (REF, ya con IVA) al guardar la fila. NULL en filas anteriores a 20261009c.';
comment on column public.product_price_history.margin_band_snapshot is
  'Banda de ganancia al guardar la fila: red | yellow | green | none (sin costo). NULL en filas anteriores a 20261009c.';
comment on column public.product_price_history.snapshot_seq is
  'Posicion de la instantanea en el libro (misma secuencia que stock_movements.seq). NULL si la fila no tiene instantanea.';

alter table public.product_price_history drop constraint if exists product_price_history_margin_band_snapshot_check;
alter table public.product_price_history
  add constraint product_price_history_margin_band_snapshot_check
  check (margin_band_snapshot is null or margin_band_snapshot in ('red', 'yellow', 'green', 'none'));

alter table public.product_price_history drop constraint if exists product_price_history_snapshot_complete_check;
alter table public.product_price_history
  add constraint product_price_history_snapshot_complete_check
  check (num_nulls(cost_ref_snapshot, margin_band_snapshot, snapshot_seq) in (0, 3));

create index if not exists idx_product_price_history_product_created
  on public.product_price_history (product_id, created_at desc);

create index if not exists idx_product_price_history_product_snapshot
  on public.product_price_history (product_id, snapshot_seq desc)
  where snapshot_seq is not null;

-- -----------------------------------------------------------------------------
-- 2. Bandas del semaforo. Misma regla de bordes que marginBand de @bodega/core.
-- -----------------------------------------------------------------------------

create or replace function public.margin_band_from_thresholds(
  p_margin_pct numeric,
  p_yellow_from_pct numeric,
  p_green_from_pct numeric
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_margin_pct is null then 'none'
    when p_margin_pct < p_yellow_from_pct then 'red'
    when p_margin_pct < p_green_from_pct then 'yellow'
    else 'green'
  end;
$$;

comment on function public.margin_band_from_thresholds(numeric, numeric, numeric) is
  'Banda del semaforo de ganancia: red < amarillo_desde; yellow < verde_desde; green >= verde_desde; none sin % (sin costo).';

create or replace function public.margin_band_rank(p_band text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_band
    when 'red' then 0
    when 'yellow' then 1
    when 'green' then 2
  end;
$$;

comment on function public.margin_band_rank(text) is
  'Orden de las bandas: red 0 < yellow 1 < green 2. NULL para none: no se compara.';

create or replace function public.product_margin_band(p_store_id uuid, p_margin_pct numeric)
returns text
language sql
stable
set search_path = public
as $$
  select public.margin_band_from_thresholds(
    p_margin_pct,
    coalesce((select a.margin_yellow_from_pct from public.app_settings a where a.store_id = p_store_id), 15),
    coalesce((select a.margin_green_from_pct from public.app_settings a where a.store_id = p_store_id), 25)
  );
$$;

comment on function public.product_margin_band(uuid, numeric) is
  'Banda de ganancia de un % con los umbrales de la tienda (app_settings; 15 / 25 si no hay fila).';

revoke all on function public.margin_band_from_thresholds(numeric, numeric, numeric) from public, anon;
grant execute on function public.margin_band_from_thresholds(numeric, numeric, numeric) to authenticated, service_role;
revoke all on function public.margin_band_rank(text) from public, anon;
grant execute on function public.margin_band_rank(text) to authenticated, service_role;
revoke all on function public.product_margin_band(uuid, numeric) from public, anon;
grant execute on function public.product_margin_band(uuid, numeric) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. update_product_price — copia de 20261006h + instantanea en el historial.
-- -----------------------------------------------------------------------------

create or replace function public.update_product_price(
  p_product_id uuid,
  p_new_sale_price_ref numeric,
  p_reason text default null
)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_old_price numeric(12,2);
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_new_sale_price_ref, 'el precio de venta');

  -- N6 — rol nulo = no autorizado, y PT403 en vez de P0001.
  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para cambiar precios';
  end if;

  if p_new_sale_price_ref < 0 then
    raise exception 'El precio no puede ser negativo';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  v_old_price := v_product.sale_price_ref;

  update public.products
  set sale_price_ref = p_new_sale_price_ref
  where id = p_product_id
    and store_id = v_store_id
  returning * into v_product;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  -- PRO-11 — la fila guarda el costo vigente y la banda que deja el precio nuevo
  -- (v_product ya trae el margin_pct recalculado por el update de arriba).
  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    p_product_id,
    v_old_price,
    p_new_sale_price_ref,
    p_reason,
    auth.uid(),
    v_product.current_cost_ref,
    public.product_margin_band(v_store_id, v_product.margin_pct),
    nextval('public.stock_movements_seq')
  );

  return v_product;
end;
$$;

revoke all on function public.update_product_price(uuid, numeric, text) from public, anon;
grant execute on function public.update_product_price(uuid, numeric, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. keep_product_price — "Mantener precio": nueva instantanea, mismo precio.
-- -----------------------------------------------------------------------------

create or replace function public.keep_product_price(
  p_product_id uuid,
  p_reason text default null
)
returns public.product_price_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_product public.products;
  v_history public.product_price_history;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para mantener precios';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    p_product_id,
    v_product.sale_price_ref,
    v_product.sale_price_ref,
    coalesce(nullif(btrim(p_reason), ''), 'Precio mantenido'),
    auth.uid(),
    v_product.current_cost_ref,
    public.product_margin_band(v_store_id, v_product.margin_pct),
    nextval('public.stock_movements_seq')
  )
  returning * into v_history;

  return v_history;
end;
$$;

comment on function public.keep_product_price(uuid, text) is
  'Mantener precio: fila de historial sin cambio de precio con el costo y la banda actuales. No toca products ni stock.';

revoke all on function public.keep_product_price(uuid, text) from public, anon;
grant execute on function public.keep_product_price(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Linea base: trigger para las altas y backfill para los productos que ya
--    existen. new.margin_pct ya viene calculado en un trigger AFTER.
-- -----------------------------------------------------------------------------

create or replace function public.products_price_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.product_price_history (
    product_id,
    old_sale_price_ref,
    new_sale_price_ref,
    reason,
    changed_by,
    cost_ref_snapshot,
    margin_band_snapshot,
    snapshot_seq
  )
  values (
    new.id,
    new.sale_price_ref,
    new.sale_price_ref,
    'Línea base de ganancia',
    auth.uid(),
    new.current_cost_ref,
    public.product_margin_band(new.store_id, new.margin_pct),
    nextval('public.stock_movements_seq')
  );

  return null;
end;
$$;

comment on function public.products_price_baseline() is
  'Linea base de ganancia de un producto nuevo: fila de historial con su costo y banda iniciales.';

revoke all on function public.products_price_baseline() from public, anon, authenticated;

drop trigger if exists trg_products_price_baseline on public.products;
create trigger trg_products_price_baseline
after insert on public.products
for each row
execute function public.products_price_baseline();

-- Un valor no finito en precio o costo (dato corrupto anterior a 20261006i) haria
-- fallar el insert y con el todo el parche: ese producto se queda sin linea base.
insert into public.product_price_history (
  product_id,
  old_sale_price_ref,
  new_sale_price_ref,
  reason,
  changed_by,
  cost_ref_snapshot,
  margin_band_snapshot,
  snapshot_seq
)
select
  p.id,
  p.sale_price_ref,
  p.sale_price_ref,
  'Línea base de ganancia',
  null,
  p.current_cost_ref,
  public.margin_band_from_thresholds(
    p.margin_pct,
    coalesce(a.margin_yellow_from_pct, 15),
    coalesce(a.margin_green_from_pct, 25)
  ),
  nextval('public.stock_movements_seq')
from public.products p
left join public.app_settings a on a.store_id = p.store_id
where (p.sale_price_ref - p.sale_price_ref) = 0
  and (p.current_cost_ref - p.current_cost_ref) = 0
  and not exists (
    select 1
    from public.product_price_history h
    where h.product_id = p.id
      and h.snapshot_seq is not null
  );

-- -----------------------------------------------------------------------------
-- 6. Vista de la cola y relacion calculada para PostgREST.
-- -----------------------------------------------------------------------------

create or replace view public.products_price_review
with (security_invoker = true) as
select
  p.id as product_id,
  p.store_id,
  p.name,
  p.sku,
  p.sale_price_ref,
  s.cost_ref_snapshot as previous_cost_ref,
  p.current_cost_ref,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) as previous_margin_pct,
  p.margin_pct as current_margin_pct,
  s.margin_band_snapshot as previous_band,
  b.current_band,
  public.margin_band_rank(b.current_band) as current_band_rank,
  round((p.sale_price_ref - s.cost_ref_snapshot) / nullif(s.cost_ref_snapshot, 0) * 100, 6) - p.margin_pct as margin_drop_pct,
  s.created_at as snapshot_at,
  pu.id as purchase_id,
  pu.purchase_number,
  m.created_at as purchase_received_at,
  pu.supplier_id,
  c.name as supplier_name
from public.products p
join lateral (
  select h.cost_ref_snapshot, h.margin_band_snapshot, h.snapshot_seq, h.created_at
  from public.product_price_history h
  where h.product_id = p.id
    and h.snapshot_seq is not null
  order by h.snapshot_seq desc
  limit 1
) s on true
left join public.app_settings a on a.store_id = p.store_id
cross join lateral (
  select public.margin_band_from_thresholds(
    p.margin_pct,
    coalesce(a.margin_yellow_from_pct, 15),
    coalesce(a.margin_green_from_pct, 25)
  ) as current_band
) b
left join lateral (
  select sm.purchase_id, sm.created_at
  from public.stock_movements sm
  where sm.product_id = p.id
    and sm.type = 'compra'
    and sm.purchase_id is not null
    and sm.seq > s.snapshot_seq
  order by sm.seq desc
  limit 1
) m on true
left join public.purchases pu on pu.id = m.purchase_id
left join public.contacts c on c.id = pu.supplier_id
where p.is_active
  and s.cost_ref_snapshot > 0
  and p.current_cost_ref > s.cost_ref_snapshot
  and public.margin_band_rank(b.current_band) < public.margin_band_rank(s.margin_band_snapshot);

comment on view public.products_price_review is
  'Cola "Por revisar": productos activos cuyo costo subio y cuya banda de ganancia es peor que la de su ultima instantanea de precio.';

-- Supabase concede ALL por defecto a los roles de PostgREST sobre lo que se crea en public.
revoke all on public.products_price_review from public, anon, authenticated;
grant select on public.products_price_review to authenticated, service_role;

create or replace function public.price_review(public.products)
returns setof public.products_price_review
rows 1
language sql
stable
set search_path = public
as $$
  select r.*
  from public.products_price_review r
  where r.product_id = $1.id;
$$;

comment on function public.price_review(public.products) is
  'Relacion calculada de PostgREST: la fila de products_price_review del producto, si esta en la cola.';

revoke all on function public.price_review(public.products) from public, anon;
grant execute on function public.price_review(public.products) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Triggers de 20261006i (NaN / Infinity -> PT400) regenerados para
--    product_price_history. Mismo generador, acotado a esa tabla.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select
      c.oid::regclass as tbl,
      string_agg(format('(new.%1$I - new.%1$I) <> 0', a.attname), ' or ' order by a.attnum) as insert_when,
      string_agg(
        format('((new.%1$I - new.%1$I) <> 0 and new.%1$I is distinct from old.%1$I)', a.attname),
        ' or ' order by a.attnum
      ) as update_when,
      string_agg(quote_literal(a.attname), ', ' order by a.attnum) as args
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid
    where c.oid = 'public.product_price_history'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.atttypid = 'numeric'::regtype
    group by c.oid
  loop
    execute format('drop trigger if exists trg_zz_reject_non_finite_numeric_ins on %s', r.tbl);
    execute format('drop trigger if exists trg_zz_reject_non_finite_numeric_upd on %s', r.tbl);

    execute format(
      'create trigger trg_zz_reject_non_finite_numeric_ins before insert on %s for each row when (%s) '
      || 'execute function public.reject_non_finite_numeric(%s)',
      r.tbl, r.insert_when, r.args
    );
    execute format(
      'create trigger trg_zz_reject_non_finite_numeric_upd before update on %s for each row when (%s) '
      || 'execute function public.reject_non_finite_numeric(%s)',
      r.tbl, r.update_when, r.args
    );
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
