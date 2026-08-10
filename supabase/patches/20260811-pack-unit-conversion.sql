-- =============================================================================
-- 20260811 — conversión empaque → unidad (dual SKU)
-- Requiere:
--   20260716-multi-store.sql (stores, assert_store_context)
--   20260811a-stock-movement-conversion-enum.sql (enum values en Run previo)
-- =============================================================================

alter table public.stock_movements
  add column if not exists conversion_id uuid;

create index if not exists idx_stock_movements_conversion_id
  on public.stock_movements(conversion_id)
  where conversion_id is not null;

create table if not exists public.product_pack_conversions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  pack_product_id uuid not null references public.products(id) on delete cascade,
  unit_product_id uuid not null references public.products(id) on delete cascade,
  units_per_pack integer not null check (units_per_pack > 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pack_product_id <> unit_product_id)
);

create unique index if not exists uq_product_pack_conversions_pack_active
  on public.product_pack_conversions(pack_product_id)
  where is_active = true;

create unique index if not exists uq_product_pack_conversions_unit_active
  on public.product_pack_conversions(unit_product_id)
  where is_active = true;

create index if not exists idx_product_pack_conversions_store_id
  on public.product_pack_conversions(store_id);

drop trigger if exists trg_product_pack_conversions_updated_at on public.product_pack_conversions;
create trigger trg_product_pack_conversions_updated_at
before update on public.product_pack_conversions
for each row execute function public.set_updated_at();

create or replace function public.validate_product_pack_conversion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_pack_store uuid;
  v_unit_store uuid;
begin
  select store_id into v_pack_store from public.products where id = new.pack_product_id;
  select store_id into v_unit_store from public.products where id = new.unit_product_id;

  if v_pack_store is null or v_unit_store is null then
    raise exception 'Producto de empaque o unidad no encontrado';
  end if;

  if v_pack_store <> v_unit_store then
    raise exception 'Empaque y unidad deben pertenecer a la misma tienda';
  end if;

  if new.store_id <> v_pack_store then
    raise exception 'store_id del vinculo no coincide con los productos';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_product_pack_conversion on public.product_pack_conversions;
create trigger trg_validate_product_pack_conversion
before insert or update on public.product_pack_conversions
for each row execute function public.validate_product_pack_conversion();

alter table public.product_pack_conversions enable row level security;

drop policy if exists "Authenticated users read product pack conversions"
  on public.product_pack_conversions;
create policy "Authenticated users read product pack conversions"
on public.product_pack_conversions for select
to authenticated
using (store_id = public.current_user_store_id());

drop policy if exists "Admins and warehouse manage product pack conversions"
  on public.product_pack_conversions;
create policy "Admins and warehouse manage product pack conversions"
on public.product_pack_conversions for all
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
);

-- CREATE OR REPLACE no puede insertar columnas en medio (cambia "reason" → "conversion_id").
drop view if exists public.stock_card;
create view public.stock_card as
select
  sm.id,
  sm.store_id,
  sm.product_id,
  p.sku,
  p.name as product_name,
  sm.type,
  sm.quantity_delta,
  sm.stock_after,
  sm.sale_id,
  sm.purchase_id,
  sm.reason,
  sm.created_by,
  sm.created_at,
  sm.conversion_id
from public.stock_movements sm
join public.products p on p.id = sm.product_id;

grant select on public.stock_card to authenticated;

create or replace function public.convert_pack_to_units(
  p_pack_product_id uuid,
  p_pack_quantity integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_link public.product_pack_conversions;
  v_pack public.products;
  v_unit public.products;
  v_conversion_id uuid := gen_random_uuid();
  v_units_out integer;
  v_pack_stock integer;
  v_unit_stock integer;
  v_transferred_value numeric(14,4);
  v_unit_cost numeric(12,2);
  v_new_unit_cost numeric(12,2);
  v_pack_movement public.stock_movements;
  v_unit_movement public.stock_movements;
begin
  v_store_id := public.assert_store_context();

  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para convertir empaque a unidad';
  end if;

  if p_pack_quantity is null or p_pack_quantity <= 0 then
    raise exception 'La cantidad de empaques debe ser mayor a cero';
  end if;

  select * into v_link
  from public.product_pack_conversions
  where pack_product_id = p_pack_product_id
    and store_id = v_store_id
    and is_active = true
  for update;

  if not found then
    raise exception 'El producto no tiene conversion de empaque a unidad activa';
  end if;

  select * into v_pack
  from public.products
  where id = v_link.pack_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Producto de empaque no encontrado';
  end if;

  select * into v_unit
  from public.products
  where id = v_link.unit_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception 'Producto unidad no encontrado';
  end if;

  if v_pack.current_stock < p_pack_quantity then
    raise exception 'Stock insuficiente de empaque';
  end if;

  v_units_out := p_pack_quantity * v_link.units_per_pack;
  v_pack_stock := v_pack.current_stock - p_pack_quantity;
  v_unit_stock := v_unit.current_stock + v_units_out;

  v_transferred_value := p_pack_quantity::numeric * coalesce(v_pack.current_cost_ref, 0);
  v_unit_cost := round(v_transferred_value / v_units_out::numeric, 2);

  if v_unit.current_stock <= 0 then
    v_new_unit_cost := v_unit_cost;
  else
    v_new_unit_cost := round(
      (
        (v_unit.current_stock::numeric * coalesce(v_unit.current_cost_ref, 0))
        + v_transferred_value
      ) / v_unit_stock::numeric,
      2
    );
  end if;

  update public.products
  set current_stock = v_pack_stock,
      updated_at = now()
  where id = v_pack.id;

  update public.products
  set current_stock = v_unit_stock,
      current_cost_ref = v_new_unit_cost,
      updated_at = now()
  where id = v_unit.id;

  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    stock_after,
    conversion_id,
    reason,
    store_id,
    created_by
  )
  values (
    v_pack.id,
    'conversion_salida'::public.stock_movement_type,
    -p_pack_quantity,
    v_pack_stock,
    v_conversion_id,
    p_reason,
    v_store_id,
    auth.uid()
  )
  returning * into v_pack_movement;

  insert into public.stock_movements (
    product_id,
    type,
    quantity_delta,
    stock_after,
    conversion_id,
    reason,
    store_id,
    created_by
  )
  values (
    v_unit.id,
    'conversion_entrada'::public.stock_movement_type,
    v_units_out,
    v_unit_stock,
    v_conversion_id,
    p_reason,
    v_store_id,
    auth.uid()
  )
  returning * into v_unit_movement;

  return jsonb_build_object(
    'conversionId', v_conversion_id,
    'unitsPerPack', v_link.units_per_pack,
    'packQuantity', p_pack_quantity,
    'unitQuantity', v_units_out,
    'unitCostRef', v_unit_cost,
    'packMovement', jsonb_build_object(
      'id', v_pack_movement.id,
      'product_id', v_pack_movement.product_id,
      'type', v_pack_movement.type,
      'quantity_delta', v_pack_movement.quantity_delta,
      'stock_after', v_pack_movement.stock_after,
      'conversion_id', v_pack_movement.conversion_id,
      'reason', v_pack_movement.reason,
      'created_at', v_pack_movement.created_at
    ),
    'unitMovement', jsonb_build_object(
      'id', v_unit_movement.id,
      'product_id', v_unit_movement.product_id,
      'type', v_unit_movement.type,
      'quantity_delta', v_unit_movement.quantity_delta,
      'stock_after', v_unit_movement.stock_after,
      'conversion_id', v_unit_movement.conversion_id,
      'reason', v_unit_movement.reason,
      'created_at', v_unit_movement.created_at
    )
  );
end;
$$;

grant execute on function public.convert_pack_to_units(uuid, integer, text) to authenticated;

notify pgrst, 'reload schema';
