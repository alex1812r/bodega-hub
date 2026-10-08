-- =============================================================================
-- 20261009e — proveedor habitual del producto (PRO-14; plan ux-mejoras, Ola 1;
--             §0b N3 y reglas 7 y 9)
-- Proyecto: BodegaHub
-- Requiere: 20260716 (store_id en supplier_products y contacts), 20261006h
--           (register_supplier_product_price vigente, assert_finite_numeric y
--           RLS por tienda de supplier_products).
--
-- Un producto tiene como mucho UN proveedor habitual entre sus vinculos
-- proveedor-producto, y el habitual es siempre un vinculo ACTIVO de un proveedor
-- ACTIVO.
--
--   1. supplier_products.is_preferred boolean not null default false.
--      * check supplier_products_preferred_active_check: un vinculo inactivo
--        nunca es habitual (vale aunque alguien apague los triggers).
--      * indice unico parcial uq_supplier_products_preferred (product_id) where
--        is_preferred: uno por producto. SIN "and is_active": con ese filtro un
--        habitual inactivo podria convivir con otro activo; el check ya impide
--        que exista.
--   2. supplier_products_next_preferred(product_id): el relevo determinista. De
--      los vinculos activos de proveedores activos (proveedor / ambos), el de
--      compra mas reciente (last_purchased_at); sin compras, el mas antiguo por
--      created_at; desempate por id.
--   3. Trigger trg_supplier_products_preferred_guard (before insert / update /
--      delete por fila):
--        * vinculo inactivo -> is_preferred = false;
--        * un vinculo que ENTRA a los activos de un producto (alta, reactivacion
--          o cambio de producto) queda habitual si el producto no tiene ninguno
--          y su proveedor esta activo: "el primer vinculo es el habitual". Vale
--          para el formulario de contactos, create_purchase / receive_purchase
--          (insert ... on conflict ... is_active = true) y cualquier camino
--          futuro, sin tocarlos;
--        * marcar habitual a un proveedor inactivo o que ya no es proveedor ->
--          PT400;
--        * bloquea el producto (for no key update) cuando decide o suelta el
--          habitual, para que dos altas simultaneas no elijan dos.
--      Trigger trg_supplier_products_preferred_handoff (after update / delete
--      por fila, solo si la fila ERA habitual): si el habitual se desactiva, se
--      borra o se mueve de producto, el habitual pasa al relevo del punto 2 o el
--      producto queda sin habitual. Quitar la marca a un vinculo que sigue
--      activo NO dispara relevo (es una decision de quien escribe).
--      Trigger trg_contacts_release_preferred_supplier (after update de
--      is_active / type en contacts): al desactivar un proveedor o dejarlo solo
--      como cliente, sus vinculos habituales se sueltan y cada producto pasa al
--      relevo. Reactivar el proveedor no le devuelve el habitual.
--   4. Backfill: cada producto con vinculos activos y sin habitual recibe UNO
--      (el relevo del punto 2). Reaplicar el parche no cambia un habitual ya
--      elegido.
--   5. RPC save_product_suppliers(p_product_id, p_suppliers jsonb): estado
--      DESEADO completo de los vinculos activos del producto, en una
--      transaccion. p_suppliers = [{supplier_id, cost_ref?, supplier_sku?,
--      is_preferred?}] (maximo 50).
--        * crea los que faltan (reactiva el que existia inactivo), cambia
--          supplier_sku si la clave viene, DESACTIVA (no borra) los activos que
--          no vienen y fija el habitual;
--        * cost_ref: si viene y el vinculo es nuevo o el costo cambia, pasa por
--          register_supplier_product_price (origen 'vinculacion' en un vinculo
--          nuevo o reactivado, 'ajuste' en uno existente; modo 'unit'): mismo
--          historial y mismas reglas que el resto de caminos. Sin cost_ref el
--          costo no se toca;
--        * el mismo proveedor dos veces se FUNDE en una fila: gana la ultima
--          aparicion (costo y sku) y es habitual si alguna lo marca;
--        * habitual: el marcado; si ninguno, se conserva el actual si sigue en
--          la lista; si no, el primero de la lista con proveedor activo; lista
--          vacia = sin vinculos activos y sin habitual;
--        * PT400: lista invalida o de mas de 50, proveedor inexistente / de otra
--          tienda / que no es proveedor ni ambos, proveedor INACTIVO en un
--          vinculo nuevo o marcado habitual, mas de un habitual, costo negativo,
--          no finito o fuera de rango. PT403: rol distinto de admin / almacen.
--          PT404: producto que no es de la tienda.
--      Devuelve {product_id, suppliers[], preferred_supplier_id,
--      previous_preferred_supplier_id, preferred_changed,
--      preferred_auto_assigned}.
--
-- No toca stock, products (ni current_cost_ref), precios de venta, compras,
-- politicas ni las RPC existentes. No anade columnas numeric: los triggers de
-- 20261006i no necesitan regenerarse.
-- OJO: el backfill y los relevos pasan por trg_supplier_products_updated_at: el
-- vinculo que queda habitual estrena updated_at.
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up ANTES de
-- desplegar el BFF que llama a save_product_suppliers.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Columna, check e indice unico parcial
-- -----------------------------------------------------------------------------

alter table public.supplier_products
  add column if not exists is_preferred boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.supplier_products'::regclass
      and conname = 'supplier_products_preferred_active_check'
  ) then
    alter table public.supplier_products
      add constraint supplier_products_preferred_active_check check (not is_preferred or is_active);
  end if;
end;
$$;

create unique index if not exists uq_supplier_products_preferred
  on public.supplier_products (product_id)
  where is_preferred;

-- -----------------------------------------------------------------------------
-- 2. Relevo determinista. Interna: no ejecutable por los roles de PostgREST.
-- -----------------------------------------------------------------------------

create or replace function public.supplier_products_next_preferred(p_product_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select sp.id
  from public.supplier_products sp
  join public.contacts c on c.id = sp.supplier_id
  where sp.product_id = p_product_id
    and sp.is_active
    and c.is_active
    and c.type::text in ('proveedor', 'ambos')
  order by sp.last_purchased_at desc nulls last, sp.created_at, sp.id
  limit 1;
$$;

revoke all on function public.supplier_products_next_preferred(uuid) from public, anon, authenticated;
grant execute on function public.supplier_products_next_preferred(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3a. Guard BEFORE: inactivo nunca habitual, primer vinculo = habitual, y
--     proveedor inactivo no puede pasar a habitual.
-- -----------------------------------------------------------------------------

create or replace function public.supplier_products_preferred_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enters boolean;
  v_becomes boolean;
  v_supplier_ok boolean;
begin
  if tg_op = 'DELETE' then
    if old.is_preferred then
      perform 1 from public.products where id = old.product_id for no key update;
    end if;
    return old;
  end if;

  -- v_enters: el vinculo entra a los activos del producto.
  -- v_becomes: el vinculo pasa a habitual en esta escritura.
  if tg_op = 'INSERT' then
    v_enters := true;
    v_becomes := new.is_preferred;
  else
    if old.is_preferred and (not new.is_active or new.product_id is distinct from old.product_id) then
      -- El habitual sale del producto: se serializa con las altas que lo buscan.
      perform 1 from public.products where id = old.product_id for no key update;
    end if;

    if new.product_id is distinct from old.product_id then
      -- El habitual no viaja con el vinculo a otro producto.
      new.is_preferred := false;
    end if;

    v_enters := not old.is_active or new.product_id is distinct from old.product_id;
    v_becomes := new.is_preferred
      and (not old.is_preferred or new.supplier_id is distinct from old.supplier_id);
  end if;

  if not new.is_active then
    new.is_preferred := false;
    return new;
  end if;

  if not v_enters and not v_becomes then
    return new;
  end if;

  select c.is_active and c.type::text in ('proveedor', 'ambos')
  into v_supplier_ok
  from public.contacts c
  where c.id = new.supplier_id;

  v_supplier_ok := coalesce(v_supplier_ok, false);

  if new.is_preferred then
    if not v_supplier_ok then
      raise exception using
        errcode = 'PT400',
        message = 'Un proveedor inactivo no puede ser el habitual del producto';
    end if;

    return new;
  end if;

  -- Entra sin marca: queda habitual si el producto no tiene ninguno.
  perform 1 from public.products where id = new.product_id for no key update;

  if v_supplier_ok and not exists (
    select 1
    from public.supplier_products sp
    where sp.product_id = new.product_id
      and sp.is_preferred
      and sp.id <> new.id
  ) then
    new.is_preferred := true;
  end if;

  return new;
end;
$$;

revoke all on function public.supplier_products_preferred_guard() from public, anon, authenticated;
grant execute on function public.supplier_products_preferred_guard() to service_role;

drop trigger if exists trg_supplier_products_preferred_guard on public.supplier_products;
create trigger trg_supplier_products_preferred_guard
before insert or update or delete on public.supplier_products
for each row execute function public.supplier_products_preferred_guard();

-- -----------------------------------------------------------------------------
-- 3b. Relevo AFTER: el habitual se desactivo, se borro o cambio de producto.
--     Se dispara al final de la sentencia: ve todas sus filas ya escritas.
-- -----------------------------------------------------------------------------

create or replace function public.supplier_products_preferred_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next uuid;
begin
  if tg_op = 'UPDATE' then
    if new.is_active and new.product_id = old.product_id then
      -- Sigue activo en el mismo producto: quien le quito la marca decide el resto.
      return null;
    end if;
  end if;

  if exists (
    select 1 from public.supplier_products sp
    where sp.product_id = old.product_id and sp.is_preferred
  ) then
    return null;
  end if;

  v_next := public.supplier_products_next_preferred(old.product_id);

  if v_next is not null then
    update public.supplier_products
    set is_preferred = true
    where id = v_next
      and not is_preferred;
  end if;

  return null;
end;
$$;

revoke all on function public.supplier_products_preferred_handoff() from public, anon, authenticated;
grant execute on function public.supplier_products_preferred_handoff() to service_role;

drop trigger if exists trg_supplier_products_preferred_handoff on public.supplier_products;
create trigger trg_supplier_products_preferred_handoff
after update or delete on public.supplier_products
for each row when (old.is_preferred)
execute function public.supplier_products_preferred_handoff();

-- -----------------------------------------------------------------------------
-- 3c. Proveedor desactivado (o que deja de ser proveedor): suelta sus
--     habituales y cada producto pasa al relevo. Productos en orden de id.
-- -----------------------------------------------------------------------------

create or replace function public.contacts_release_preferred_supplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_next uuid;
begin
  for v_link in
    select sp.id, sp.product_id
    from public.supplier_products sp
    where sp.supplier_id = new.id
      and sp.is_preferred
    order by sp.product_id
  loop
    perform 1 from public.products where id = v_link.product_id for no key update;

    update public.supplier_products
    set is_preferred = false
    where id = v_link.id;

    v_next := public.supplier_products_next_preferred(v_link.product_id);

    if v_next is not null then
      update public.supplier_products
      set is_preferred = true
      where id = v_next
        and not is_preferred;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.contacts_release_preferred_supplier() from public, anon, authenticated;
grant execute on function public.contacts_release_preferred_supplier() to service_role;

drop trigger if exists trg_contacts_release_preferred_supplier on public.contacts;
create trigger trg_contacts_release_preferred_supplier
after update of is_active, type on public.contacts
for each row
when (
  (old.is_active and not new.is_active)
  or (new.type is distinct from old.type and new.type::text not in ('proveedor', 'ambos'))
)
execute function public.contacts_release_preferred_supplier();

-- -----------------------------------------------------------------------------
-- 4. Backfill: un habitual por producto que tenga vinculos activos y ninguno
--    marcado. Mismo criterio que supplier_products_next_preferred. Un producto
--    que ya tiene habitual no entra: reaplicar no cambia nada.
-- -----------------------------------------------------------------------------

update public.supplier_products sp
set is_preferred = true
from (
  select distinct on (candidate.product_id) candidate.id
  from public.supplier_products candidate
  join public.contacts c on c.id = candidate.supplier_id
  where candidate.is_active
    and c.is_active
    and c.type::text in ('proveedor', 'ambos')
    and not exists (
      select 1
      from public.supplier_products chosen
      where chosen.product_id = candidate.product_id
        and chosen.is_preferred
    )
  order by candidate.product_id, candidate.last_purchased_at desc nulls last, candidate.created_at, candidate.id
) pick
where sp.id = pick.id;

-- -----------------------------------------------------------------------------
-- 5. save_product_suppliers
-- -----------------------------------------------------------------------------

create or replace function public.save_product_suppliers(
  p_product_id uuid,
  p_suppliers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_item jsonb;
  v_supplier_id uuid;
  v_cost numeric;
  v_sku text;
  v_sets_sku boolean;
  v_mark boolean;
  v_idx integer;
  v_pass integer;
  v_total integer;
  v_marked integer;
  v_ids uuid[] := '{}';
  v_costs numeric[] := '{}';
  v_skus text[] := '{}';
  v_sku_sets boolean[] := '{}';
  v_marks boolean[] := '{}';
  v_names text[] := '{}';
  v_actives boolean[] := '{}';
  v_contact record;
  v_sp public.supplier_products;
  v_is_new boolean;
  v_is_target boolean;
  v_explicit boolean := false;
  v_previous uuid;
  v_target uuid;
  v_final uuid;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para gestionar los proveedores del producto';
  end if;

  if p_suppliers is null or jsonb_typeof(p_suppliers) <> 'array' then
    raise exception using errcode = 'PT400', message = 'La lista de proveedores no es válida';
  end if;

  if jsonb_array_length(p_suppliers) > 50 then
    raise exception using errcode = 'PT400', message = 'Un producto admite como máximo 50 proveedores';
  end if;

  -- 5.1 Lista deseada, en orden y con los proveedores repetidos fundidos.
  for v_item in
    select t.value
    from jsonb_array_elements(p_suppliers) with ordinality as t(value, ord)
    order by t.ord
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'supplier_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'PT400', message = 'Proveedor no encontrado';
    end if;

    v_supplier_id := (v_item ->> 'supplier_id')::uuid;

    v_cost := null;
    if jsonb_typeof(v_item -> 'cost_ref') = 'number' then
      v_cost := (v_item ->> 'cost_ref')::numeric;
    elsif v_item ? 'cost_ref' and jsonb_typeof(v_item -> 'cost_ref') <> 'null' then
      raise exception using errcode = 'PT400', message = 'El costo del proveedor debe ser un número';
    end if;

    perform public.assert_finite_numeric(v_cost, 'el costo del proveedor');

    if v_cost < 0 then
      raise exception using errcode = 'PT400', message = 'El costo del proveedor no puede ser negativo';
    end if;

    if v_cost > 9999999999.99 then
      raise exception using errcode = 'PT400', message = 'El costo del proveedor está fuera de rango';
    end if;

    v_cost := round(v_cost, 2);

    v_sets_sku := v_item ? 'supplier_sku';
    if v_sets_sku and jsonb_typeof(v_item -> 'supplier_sku') not in ('string', 'null') then
      raise exception using errcode = 'PT400', message = 'El código del proveedor no es válido';
    end if;
    v_sku := nullif(btrim(v_item ->> 'supplier_sku'), '');

    v_mark := false;
    if jsonb_typeof(v_item -> 'is_preferred') = 'boolean' then
      v_mark := (v_item ->> 'is_preferred')::boolean;
    elsif v_item ? 'is_preferred' and jsonb_typeof(v_item -> 'is_preferred') <> 'null' then
      raise exception using errcode = 'PT400', message = 'La marca de proveedor habitual no es válida';
    end if;

    v_idx := array_position(v_ids, v_supplier_id);

    if v_idx is null then
      v_ids := array_append(v_ids, v_supplier_id);
      v_costs := array_append(v_costs, v_cost);
      v_skus := array_append(v_skus, v_sku);
      v_sku_sets := array_append(v_sku_sets, v_sets_sku);
      v_marks := array_append(v_marks, v_mark);
    else
      -- Repetido: gana la ultima aparicion; habitual si alguna lo marca.
      v_costs[v_idx] := v_cost;
      v_skus[v_idx] := v_sku;
      v_sku_sets[v_idx] := v_sets_sku;
      v_marks[v_idx] := v_marks[v_idx] or v_mark;
    end if;
  end loop;

  v_total := coalesce(array_length(v_ids, 1), 0);

  select count(*) into v_marked from unnest(v_marks) as m(marked) where m.marked;

  if v_marked > 1 then
    raise exception using errcode = 'PT400', message = 'Solo un proveedor puede ser el habitual del producto';
  end if;

  -- 5.2 Proveedores de la tienda. for share ANTES de bloquear el producto: una
  --     desactivacion simultanea del proveedor espera aqui y su trigger encuentra
  --     ya escrito el habitual (mismo orden contacto -> producto que ese trigger).
  for v_idx in 1 .. v_total loop
    select c.name, c.is_active, c.type::text as type
    into v_contact
    from public.contacts c
    where c.id = v_ids[v_idx]
      and c.store_id = v_store_id
    for share;

    if not found or v_contact.type not in ('proveedor', 'ambos') then
      raise exception using errcode = 'PT400', message = 'Proveedor no encontrado';
    end if;

    v_names := array_append(v_names, v_contact.name);
    v_actives := array_append(v_actives, v_contact.is_active);
  end loop;

  -- 5.3 Producto de la tienda.
  perform 1
  from public.products
  where id = p_product_id
    and store_id = v_store_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'Producto no encontrado';
  end if;

  select sp.supplier_id into v_previous
  from public.supplier_products sp
  where sp.product_id = p_product_id
    and sp.is_preferred;

  -- 5.4 Un proveedor inactivo no entra en un vinculo nuevo (ni reactivado).
  for v_idx in 1 .. v_total loop
    if not v_actives[v_idx] and not exists (
      select 1
      from public.supplier_products sp
      where sp.product_id = p_product_id
        and sp.supplier_id = v_ids[v_idx]
        and sp.is_active
    ) then
      raise exception using
        errcode = 'PT400',
        message = format('El proveedor %s está inactivo: no se puede vincular al producto', v_names[v_idx]);
    end if;
  end loop;

  -- 5.5 Habitual: el marcado; si no, el actual si sigue en la lista; si no, el
  --     primero de la lista con proveedor activo; si no hay, ninguno.
  v_idx := array_position(v_marks, true);

  if v_idx is not null then
    if not v_actives[v_idx] then
      raise exception using
        errcode = 'PT400',
        message = format('El proveedor %s está inactivo: no puede ser el habitual del producto', v_names[v_idx]);
    end if;

    v_target := v_ids[v_idx];
    v_explicit := true;
  else
    v_idx := array_position(v_ids, v_previous);

    if v_idx is not null and v_actives[v_idx] then
      v_target := v_previous;
    else
      for v_idx in 1 .. v_total loop
        if v_actives[v_idx] then
          v_target := v_ids[v_idx];
          exit;
        end if;
      end loop;
    end if;
  end if;

  -- 5.6 Se apaga el habitual anterior ANTES de encender el nuevo (indice unico)
  --     y se desactivan los vinculos activos que no vienen. Ninguno de los dos
  --     dispara relevo: tras el primero ya no queda fila habitual que soltar.
  update public.supplier_products
  set is_preferred = false
  where product_id = p_product_id
    and is_preferred
    and supplier_id is distinct from v_target;

  update public.supplier_products
  set is_active = false,
      updated_at = now()
  where product_id = p_product_id
    and is_active
    and not (supplier_id = any(v_ids));

  -- 5.7 Vinculos deseados: primero el habitual (asi ningun alta posterior ve el
  --     producto sin habitual), despues el resto en el orden de la lista.
  for v_pass in 1 .. 2 loop
    for v_idx in 1 .. v_total loop
      v_is_target := v_ids[v_idx] is not distinct from v_target;
      continue when v_is_target <> (v_pass = 1);

      select * into v_sp
      from public.supplier_products
      where product_id = p_product_id
        and supplier_id = v_ids[v_idx]
      for update;

      if not found then
        insert into public.supplier_products (
          store_id, supplier_id, product_id, supplier_sku, is_active, is_preferred
        )
        values (
          v_store_id, v_ids[v_idx], p_product_id, v_skus[v_idx], true, v_is_target
        )
        returning * into v_sp;

        v_is_new := true;
      elsif not v_sp.is_active then
        update public.supplier_products
        set is_active = true,
            is_preferred = v_is_target,
            supplier_sku = case when v_sku_sets[v_idx] then v_skus[v_idx] else supplier_sku end,
            updated_at = now()
        where id = v_sp.id
        returning * into v_sp;

        v_is_new := true;
      else
        v_is_new := false;

        if v_sp.is_preferred is distinct from v_is_target
           or (v_sku_sets[v_idx] and v_sp.supplier_sku is distinct from v_skus[v_idx]) then
          update public.supplier_products
          set is_preferred = v_is_target,
              supplier_sku = case when v_sku_sets[v_idx] then v_skus[v_idx] else supplier_sku end,
              updated_at = now()
          where id = v_sp.id
          returning * into v_sp;
        end if;
      end if;

      -- El costo pasa por register_supplier_product_price: mismo historial y
      -- mismas guardas que el resto de caminos. Sin cost_ref no se toca.
      if v_costs[v_idx] is not null
         and (v_is_new or v_costs[v_idx] is distinct from v_sp.last_cost_ref) then
        perform public.register_supplier_product_price(
          v_sp.id,
          v_costs[v_idx],
          null,
          case when v_is_new then 'vinculacion' else 'ajuste' end,
          null,
          null,
          'unit'
        );
      end if;
    end loop;
  end loop;

  select sp.supplier_id into v_final
  from public.supplier_products sp
  where sp.product_id = p_product_id
    and sp.is_preferred;

  return jsonb_build_object(
    'product_id', p_product_id,
    'preferred_supplier_id', v_final,
    'previous_preferred_supplier_id', v_previous,
    'preferred_changed', v_final is distinct from v_previous,
    'preferred_auto_assigned', (not v_explicit) and v_final is distinct from v_previous,
    'suppliers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', sp.id,
            'supplier_id', sp.supplier_id,
            'supplier_name', c.name,
            'supplier_is_active', c.is_active,
            'cost_ref', sp.last_cost_ref,
            'supplier_sku', sp.supplier_sku,
            'is_preferred', sp.is_preferred,
            'last_purchased_at', sp.last_purchased_at,
            'updated_at', sp.updated_at
          )
          order by sp.is_preferred desc, c.name, sp.id
        )
        from public.supplier_products sp
        join public.contacts c on c.id = sp.supplier_id
        where sp.product_id = p_product_id
          and sp.is_active
      ),
      '[]'::jsonb
    )
  );
end;
$$;

comment on function public.save_product_suppliers(uuid, jsonb) is
  'Estado deseado de los proveedores de un producto: crea, actualiza, desactiva vinculos y fija el habitual. No toca products ni stock.';

revoke all on function public.save_product_suppliers(uuid, jsonb) from public, anon;
grant execute on function public.save_product_suppliers(uuid, jsonb) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
