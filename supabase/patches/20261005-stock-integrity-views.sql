-- =============================================================================
-- 20261005 — Invariantes de inventario (oraculo del plan stock-integrity)
-- Proyecto: BodegaHub
--
-- Nueve vistas de solo lectura, todas con columna store_id para filtrar, que
-- devuelven UNA FILA POR DESCUADRE (vacias = inventario cuadra), y la funcion
-- public.stock_integrity_report(p_store_id) que devuelve el conteo de filas de
-- cada vista en un jsonb con las 9 claves siempre presentes.
--
-- Uso:
--   select public.stock_integrity_report();                 -- todas las tiendas (superadmin / service_role)
--   select public.stock_integrity_report('<store uuid>');   -- una tienda
--   select * from public.stock_reconciliation where store_id = '<store uuid>';
--
-- Las vistas usan security_invoker: las RLS de las tablas base aplican al que
-- consulta. La funcion es security definer (bypasea RLS) y por eso, si quien
-- la llama es un usuario autenticado no superadmin, fuerza su propia tienda.
--
-- Formato: cada vista va precedida del marcador "-- view: <nombre>" y cierra
-- con ";" en su propia linea; scripts/stock-lab/reconcile.ts parsea ese bloque
-- para ejecutar el SELECT inline. Por eso ningun SELECT referencia otra vista
-- de este parche (la logica compartida se duplica con CTEs).
--
-- Idempotente (create or replace). Ejecutar en SQL Editor o via db-up.
-- =============================================================================

-- Convenciones de las RPC (ver .notes/stock-integrity-gtm/rpc-versions.md):
--   * venta descuenta (quantity_delta < 0) con sale_id; cancel_sale revierte con
--     ajuste_entrada + sale_id, return_sale con devolucion_cliente + sale_id.
--   * compra suma con purchase_id SOLO si la compra llega a 'recibido';
--     cancel_purchase revierte con ajuste_salida + purchase_id, return_purchase
--     con devolucion_proveedor + purchase_id.
--   * modo empaque: purchase_items.quantity ya esta en unidades
--     (pack_count * units_per_pack).
--   * convert_pack_to_units: conversion_salida (empaque) y conversion_entrada
--     (unidad) comparten conversion_id.
--   * createProduct (TS) inserta current_stock inicial SIN movimiento
--     inventario_inicial: el primer movimiento de un producto puede partir de
--     un stock previo implicito (stock_after - quantity_delta).

-- Por producto: current_stock vs suma del libro (ledger). Solo descuadres.
-- view: stock_reconciliation
create or replace view public.stock_reconciliation
with (security_invoker = true) as
select
  p.id as product_id,
  p.store_id,
  p.sku,
  p.name,
  p.current_stock,
  coalesce(m.ledger_stock, 0)::integer as ledger_stock,
  (p.current_stock - coalesce(m.ledger_stock, 0))::integer as diff,
  coalesce(m.movements_count, 0)::bigint as movements_count,
  m.last_movement_at
from public.products p
left join (
  select
    sm.product_id,
    sum(sm.quantity_delta) as ledger_stock,
    count(*) as movements_count,
    max(sm.created_at) as last_movement_at
  from public.stock_movements sm
  group by sm.product_id
) m on m.product_id = p.id
where p.current_stock - coalesce(m.ledger_stock, 0) <> 0
;

-- Cadena stock_after: cada movimiento debe partir del stock_after del anterior
-- (orden created_at, id por producto). El primer movimiento no se evalua
-- (puede partir de un stock inicial sin movimiento).
-- view: stock_chain_breaks
create or replace view public.stock_chain_breaks
with (security_invoker = true) as
with ordered as (
  select
    m.id,
    m.product_id,
    coalesce(p.store_id, m.store_id) as store_id,
    m.type,
    m.created_at,
    m.quantity_delta,
    m.stock_after,
    lag(m.id) over w as prev_movement_id,
    lag(m.stock_after) over w as prev_stock_after
  from public.stock_movements m
  left join public.products p on p.id = m.product_id
  window w as (partition by m.product_id order by m.created_at, m.id)
)
select
  o.id as movement_id,
  o.product_id,
  o.store_id,
  o.type,
  o.created_at,
  o.quantity_delta,
  (o.prev_stock_after + o.quantity_delta)::integer as expected_stock_after,
  o.stock_after,
  o.prev_movement_id
from ordered o
where o.prev_movement_id is not null
  and o.stock_after <> o.prev_stock_after + o.quantity_delta
;

-- sale_items de ventas vivas (ni cancelada ni borrador) sin movimiento venta o
-- cuya suma de movimientos venta no es -quantity. La comparacion se hace por
-- (sale_id, product_id) sumando los items del mismo producto para no dar
-- falsos positivos si una venta repite producto en dos lineas.
-- view: sales_without_movements
create or replace view public.sales_without_movements
with (security_invoker = true) as
with items as (
  select
    si.id as sale_item_id,
    si.sale_id,
    s.store_id,
    si.product_id,
    si.quantity,
    sum(si.quantity) over (partition by si.sale_id, si.product_id) as product_quantity
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status not in ('cancelada', 'borrador')
),
moves as (
  select
    sm.sale_id,
    sm.product_id,
    sum(sm.quantity_delta) as movement_delta
  from public.stock_movements sm
  where sm.type = 'venta'
    and sm.sale_id is not null
  group by sm.sale_id, sm.product_id
)
select
  i.sale_id,
  i.sale_item_id,
  i.store_id,
  i.product_id,
  i.quantity,
  mv.movement_delta::integer as movement_delta,
  case when mv.movement_delta is null then 'missing' else 'delta_mismatch' end::text as issue
from items i
left join moves mv on mv.sale_id = i.sale_id and mv.product_id = i.product_id
where mv.movement_delta is null
   or mv.movement_delta <> -i.product_quantity
;

-- purchase_items de compras 'recibido' sin movimiento compra o cuya suma de
-- movimientos compra no es la cantidad normalizada (empaque x unidades).
-- Las reversiones de 'cancelado'/'devuelto' las cubre reversal_mismatches.
-- view: purchases_without_movements
create or replace view public.purchases_without_movements
with (security_invoker = true) as
with items as (
  select
    pi.id as purchase_item_id,
    pi.purchase_id,
    pu.store_id,
    pi.product_id,
    pi.quantity,
    case
      when pi.entry_mode = 'pack' then pi.pack_count * pi.units_per_pack
      else pi.quantity
    end as normalized_quantity
  from public.purchase_items pi
  join public.purchases pu on pu.id = pi.purchase_id
  where pu.status = 'recibido'
),
items_sum as (
  select
    i.*,
    sum(i.normalized_quantity) over (partition by i.purchase_id, i.product_id) as product_quantity
  from items i
),
moves as (
  select
    sm.purchase_id,
    sm.product_id,
    sum(sm.quantity_delta) as movement_delta
  from public.stock_movements sm
  where sm.type = 'compra'
    and sm.purchase_id is not null
  group by sm.purchase_id, sm.product_id
)
select
  i.purchase_id,
  i.purchase_item_id,
  i.store_id,
  i.product_id,
  i.quantity,
  i.normalized_quantity::integer as normalized_quantity,
  mv.movement_delta::integer as movement_delta,
  case when mv.movement_delta is null then 'missing' else 'delta_mismatch' end::text as issue
from items_sum i
left join moves mv on mv.purchase_id = i.purchase_id and mv.product_id = i.product_id
where mv.movement_delta is null
   or mv.movement_delta is distinct from i.product_quantity
;

-- Movimientos venta/compra sin documento (id nulo o inexistente) o cuyo
-- documento esta cancelado/devuelto sin un movimiento inverso (mismo
-- documento y producto, signo opuesto).
-- view: movements_without_document
create or replace view public.movements_without_document
with (security_invoker = true) as
select
  m.id as movement_id,
  coalesce(p.store_id, m.store_id) as store_id,
  m.product_id,
  m.type,
  m.sale_id,
  m.purchase_id,
  case
    when (m.type = 'venta' and m.sale_id is null)
      or (m.type = 'compra' and m.purchase_id is null) then 'null_document'
    when (m.type = 'venta' and s.id is null)
      or (m.type = 'compra' and pu.id is null) then 'missing_document'
    else 'cancelled_without_reversal'
  end::text as issue
from public.stock_movements m
left join public.products p on p.id = m.product_id
left join public.sales s on s.id = m.sale_id
left join public.purchases pu on pu.id = m.purchase_id
where (
    m.type = 'venta'
    and (
      m.sale_id is null
      or s.id is null
      or (
        s.status in ('cancelada', 'devuelta')
        and not exists (
          select 1
          from public.stock_movements r
          where r.sale_id = m.sale_id
            and r.product_id = m.product_id
            and r.id <> m.id
            and sign(r.quantity_delta) = -sign(m.quantity_delta)
        )
      )
    )
  )
  or (
    m.type = 'compra'
    and (
      m.purchase_id is null
      or pu.id is null
      or (
        pu.status in ('cancelado', 'devuelto')
        and not exists (
          select 1
          from public.stock_movements r
          where r.purchase_id = m.purchase_id
            and r.product_id = m.product_id
            and r.id <> m.id
            and sign(r.quantity_delta) = -sign(m.quantity_delta)
        )
      )
    )
  )
;

-- Ventas cancelada/devuelta y compras cancelado/devuelto: por producto, los
-- movimientos inversos (venta: ajuste_entrada/devolucion_cliente con sale_id;
-- compra: ajuste_salida/devolucion_proveedor con purchase_id) deben sumar
-- exactamente el opuesto de los originales. Una compra cancelada que nunca
-- fue recibida no tiene movimientos y no aparece.
-- view: reversal_mismatches
create or replace view public.reversal_mismatches
with (security_invoker = true) as
with sale_docs as (
  select
    s.id as document_id,
    s.store_id,
    m.product_id,
    sum(case when m.type = 'venta' then m.quantity_delta else 0 end) as original_delta,
    sum(case when m.type in ('ajuste_entrada', 'devolucion_cliente') then m.quantity_delta else 0 end) as reversal_delta
  from public.sales s
  join public.stock_movements m on m.sale_id = s.id
  where s.status in ('cancelada', 'devuelta')
  group by s.id, s.store_id, m.product_id
),
purchase_docs as (
  select
    pu.id as document_id,
    pu.store_id,
    m.product_id,
    sum(case when m.type = 'compra' then m.quantity_delta else 0 end) as original_delta,
    sum(case when m.type in ('ajuste_salida', 'devolucion_proveedor') then m.quantity_delta else 0 end) as reversal_delta
  from public.purchases pu
  join public.stock_movements m on m.purchase_id = pu.id
  where pu.status in ('cancelado', 'devuelto')
  group by pu.id, pu.store_id, m.product_id
)
select
  'sale'::text as document_type,
  d.document_id,
  d.store_id,
  d.product_id,
  d.original_delta::integer as original_delta,
  d.reversal_delta::integer as reversal_delta
from sale_docs d
where d.reversal_delta <> -d.original_delta
union all
select
  'purchase'::text as document_type,
  d.document_id,
  d.store_id,
  d.product_id,
  d.original_delta::integer as original_delta,
  d.reversal_delta::integer as reversal_delta
from purchase_docs d
where d.reversal_delta <> -d.original_delta
;

-- Pares conversion_salida (empaque) / conversion_entrada (unidad) por
-- conversion_id: falta alguno, no hay enlace en product_pack_conversions, o
-- entrada <> -salida * units_per_pack (fila activa, o la mas reciente).
-- view: conversion_mismatches
create or replace view public.conversion_mismatches
with (security_invoker = true) as
with pairs as (
  select
    m.conversion_id,
    max(m.store_id::text)::uuid as movement_store_id,
    max(case when m.type = 'conversion_salida' then m.product_id::text end)::uuid as pack_product_id,
    max(case when m.type = 'conversion_entrada' then m.product_id::text end)::uuid as unit_product_id,
    sum(case when m.type = 'conversion_salida' then m.quantity_delta end) as pack_delta,
    sum(case when m.type = 'conversion_entrada' then m.quantity_delta end) as unit_delta
  from public.stock_movements m
  where m.conversion_id is not null
    and m.type in ('conversion_salida', 'conversion_entrada')
  group by m.conversion_id
),
linked as (
  select
    pr.*,
    coalesce(pp.store_id, up.store_id, pr.movement_store_id) as store_id,
    (
      select c.units_per_pack
      from public.product_pack_conversions c
      where c.pack_product_id = pr.pack_product_id
        and c.unit_product_id = pr.unit_product_id
      order by c.is_active desc, c.updated_at desc nulls last, c.created_at desc
      limit 1
    ) as units_per_pack
  from pairs pr
  left join public.products pp on pp.id = pr.pack_product_id
  left join public.products up on up.id = pr.unit_product_id
)
select
  l.conversion_id,
  l.store_id,
  l.pack_product_id,
  l.unit_product_id,
  l.pack_delta::integer as pack_delta,
  l.unit_delta::integer as unit_delta,
  l.units_per_pack,
  case
    when l.pack_product_id is null then 'missing_salida'
    when l.unit_product_id is null then 'missing_entrada'
    when l.units_per_pack is null then 'missing_link'
    else 'ratio_mismatch'
  end::text as issue
from linked l
where l.pack_product_id is null
   or l.unit_product_id is null
   or l.units_per_pack is null
   or l.unit_delta <> -l.pack_delta * l.units_per_pack
;

-- Stock negativo en products.current_stock o en stock_movements.stock_after.
-- view: negative_stock
create or replace view public.negative_stock
with (security_invoker = true) as
select
  'product'::text as source,
  p.id as product_id,
  p.store_id,
  null::uuid as movement_id,
  p.current_stock as value
from public.products p
where p.current_stock < 0
union all
select
  'movement'::text as source,
  m.product_id,
  coalesce(p.store_id, m.store_id) as store_id,
  m.id as movement_id,
  m.stock_after as value
from public.stock_movements m
left join public.products p on p.id = m.product_id
where m.stock_after < 0
;

-- Movimientos cuya tienda no coincide con la del producto o la del documento
-- (o producto y documento de tiendas distintas).
-- view: cross_store_movements
create or replace view public.cross_store_movements
with (security_invoker = true) as
select
  m.id as movement_id,
  m.store_id,
  p.store_id as product_store_id,
  coalesce(s.store_id, pu.store_id) as document_store_id,
  m.product_id,
  m.sale_id,
  m.purchase_id
from public.stock_movements m
left join public.products p on p.id = m.product_id
left join public.sales s on s.id = m.sale_id
left join public.purchases pu on pu.id = m.purchase_id
where m.store_id is distinct from p.store_id
   or (s.id is not null and (m.store_id is distinct from s.store_id or p.store_id is distinct from s.store_id))
   or (pu.id is not null and (m.store_id is distinct from pu.store_id or p.store_id is distinct from pu.store_id))
;

grant select on public.stock_reconciliation to authenticated;
grant select on public.stock_chain_breaks to authenticated;
grant select on public.sales_without_movements to authenticated;
grant select on public.purchases_without_movements to authenticated;
grant select on public.movements_without_document to authenticated;
grant select on public.reversal_mismatches to authenticated;
grant select on public.conversion_mismatches to authenticated;
grant select on public.negative_stock to authenticated;
grant select on public.cross_store_movements to authenticated;

-- Oraculo: conteo de filas de cada vista. Como es security definer (bypasea
-- RLS), un usuario autenticado que no sea superadmin solo puede ver su tienda.
create or replace function public.stock_integrity_report(p_store_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid := p_store_id;
begin
  if auth.uid() is not null and not public.current_user_is_superadmin() then
    v_store_id := public.current_user_store_id();
    if v_store_id is null then
      raise exception 'Usuario sin tienda asignada'
        using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object(
    'stock_reconciliation',
      (select count(*) from public.stock_reconciliation v where v_store_id is null or v.store_id = v_store_id),
    'stock_chain_breaks',
      (select count(*) from public.stock_chain_breaks v where v_store_id is null or v.store_id = v_store_id),
    'sales_without_movements',
      (select count(*) from public.sales_without_movements v where v_store_id is null or v.store_id = v_store_id),
    'purchases_without_movements',
      (select count(*) from public.purchases_without_movements v where v_store_id is null or v.store_id = v_store_id),
    'movements_without_document',
      (select count(*) from public.movements_without_document v where v_store_id is null or v.store_id = v_store_id),
    'reversal_mismatches',
      (select count(*) from public.reversal_mismatches v where v_store_id is null or v.store_id = v_store_id),
    'conversion_mismatches',
      (select count(*) from public.conversion_mismatches v where v_store_id is null or v.store_id = v_store_id),
    'negative_stock',
      (select count(*) from public.negative_stock v where v_store_id is null or v.store_id = v_store_id),
    'cross_store_movements',
      (select count(*) from public.cross_store_movements v where v_store_id is null or v.store_id = v_store_id)
  );
end;
$$;

-- Security definer: PostgreSQL da EXECUTE a public por defecto, y anon (PostgREST solo con apikey) veria los conteos globales.
revoke all on function public.stock_integrity_report(uuid) from public;
revoke all on function public.stock_integrity_report(uuid) from anon;
grant execute on function public.stock_integrity_report(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
