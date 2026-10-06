-- =============================================================================
-- 20261006d — Vistas de integridad v2 (C16)
-- Proyecto: BodegaHub (plan stock-integrity, fase 5, STK-504)
--
-- Reemplaza 4 de las 9 vistas del parche 20261005. Siguen siendo 9 vistas con
-- los mismos nombres y las mismas columnas iniciales (solo se AGREGAN columnas
-- al final), asi que public.stock_integrity_report(uuid) no cambia.
--
--   a. stock_chain_breaks ordena la cadena por stock_movements.seq (20261006a:
--      se asigna con el producto bloqueado), no por created_at (= inicio de la
--      transaccion). Sin falsos positivos con commits invertidos, con el mismo
--      producto en dos lineas de un documento ni con un created_at corregido a
--      mano. seq deja huecos: se ordena por el, no se asume contiguidad.
--   b. documentos mutados fuera de las RPC:
--        movements_without_document
--          missing_document_line     movimiento venta/compra cuyo documento ya
--                                    no tiene linea de ese producto
--          document_status_mismatch  venta en 'borrador' o compra en 'pedido'
--                                    con stock movido
--        reversal_mismatches
--          reversal_on_live_document documento vivo con movimientos de
--                                    cancelacion (ajuste_entrada con sale_id /
--                                    ajuste_salida con purchase_id) o con mas
--                                    devuelto que lo movido: venta cancelada
--                                    resucitada a 'pagada', compra cancelada
--                                    devuelta a 'recibido'
--   c. conversion_mismatches compara cada conversion contra lo que ella misma
--      registro (sus dos movimientos), no contra el units_per_pack VIGENTE del
--      par: editar el par despues no marca las conversiones anteriores.
--   d. las 9 vistas: security_invoker y select solo para authenticated y
--      service_role (el ACL por defecto de Supabase se lo daba tambien a anon).
--
-- Formato: cada vista va precedida de "-- view: <nombre>" y cierra con ";" en
-- su propia linea (contrato de scripts/stock-lab/integrity-views.ts). Ningun
-- SELECT referencia otra vista.
--
-- Requiere 20261005 y 20261006a (columna seq). Idempotente, una transaccion.
-- =============================================================================

begin;

-- Cadena stock_after: cada movimiento debe partir del stock_after del anterior
-- en el orden real del libro (seq por producto). El primer movimiento no se
-- evalua (puede partir de un stock inicial sin movimiento).
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
    m.seq,
    lag(m.id) over w as prev_movement_id,
    lag(m.stock_after) over w as prev_stock_after
  from public.stock_movements m
  left join public.products p on p.id = m.product_id
  window w as (partition by m.product_id order by m.seq)
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
  o.prev_movement_id,
  o.seq
from ordered o
where o.prev_movement_id is not null
  and o.stock_after <> o.prev_stock_after + o.quantity_delta
;

-- Movimientos venta/compra:
--   null_document / missing_document   sin documento (id nulo o inexistente)
--   missing_document_line              el documento ya no tiene linea de ese producto
--   document_status_mismatch           venta en 'borrador' o compra en 'pedido' (nunca mueven stock)
--   cancelled_without_reversal         documento cancelado/devuelto sin movimiento inverso
--                                      (mismo documento y producto, signo opuesto)
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
    when (m.type = 'venta' and not exists (
            select 1 from public.sale_items si
            where si.sale_id = m.sale_id and si.product_id = m.product_id))
      or (m.type = 'compra' and not exists (
            select 1 from public.purchase_items pi
            where pi.purchase_id = m.purchase_id and pi.product_id = m.product_id)) then 'missing_document_line'
    when (m.type = 'venta' and s.status = 'borrador')
      or (m.type = 'compra' and pu.status = 'pedido') then 'document_status_mismatch'
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
      or not exists (
        select 1 from public.sale_items si
        where si.sale_id = m.sale_id and si.product_id = m.product_id
      )
      or s.status = 'borrador'
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
      or not exists (
        select 1 from public.purchase_items pi
        where pi.purchase_id = m.purchase_id and pi.product_id = m.product_id
      )
      or pu.status = 'pedido'
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

-- Por documento y producto, movimientos originales (venta / compra) frente a
-- los inversos ligados al documento (venta: ajuste_entrada de cancel_sale y
-- devolucion_cliente; compra: ajuste_salida de cancel_purchase y
-- devolucion_proveedor).
--   reversal_mismatch          documento cancelado/devuelto: los inversos deben
--                              sumar exactamente el opuesto de los originales
--                              (devolucion parcial ligada + devolucion del resto
--                              cuadra). Una compra cancelada que nunca fue
--                              recibida no tiene movimientos y no aparece.
--   reversal_on_live_document  documento vivo: no puede tener movimientos de
--                              cancelacion ni mas devuelto que lo movido (las
--                              devoluciones parciales ligadas si son legitimas).
-- view: reversal_mismatches
create or replace view public.reversal_mismatches
with (security_invoker = true) as
with sale_docs as (
  select
    s.id as document_id,
    s.store_id,
    s.status in ('cancelada', 'devuelta') as is_reverted,
    m.product_id,
    sum(case when m.type = 'venta' then m.quantity_delta else 0 end) as original_delta,
    sum(case when m.type in ('ajuste_entrada', 'devolucion_cliente') then m.quantity_delta else 0 end) as reversal_delta,
    sum(case when m.type = 'ajuste_entrada' then m.quantity_delta else 0 end) as cancel_delta
  from public.sales s
  join public.stock_movements m on m.sale_id = s.id
  group by s.id, s.store_id, s.status, m.product_id
),
purchase_docs as (
  select
    pu.id as document_id,
    pu.store_id,
    pu.status in ('cancelado', 'devuelto') as is_reverted,
    m.product_id,
    sum(case when m.type = 'compra' then m.quantity_delta else 0 end) as original_delta,
    sum(case when m.type in ('ajuste_salida', 'devolucion_proveedor') then m.quantity_delta else 0 end) as reversal_delta,
    sum(case when m.type = 'ajuste_salida' then m.quantity_delta else 0 end) as cancel_delta
  from public.purchases pu
  join public.stock_movements m on m.purchase_id = pu.id
  group by pu.id, pu.store_id, pu.status, m.product_id
)
select
  'sale'::text as document_type,
  d.document_id,
  d.store_id,
  d.product_id,
  d.original_delta::integer as original_delta,
  d.reversal_delta::integer as reversal_delta,
  case when d.is_reverted then 'reversal_mismatch' else 'reversal_on_live_document' end::text as issue
from sale_docs d
where (d.is_reverted and d.reversal_delta <> -d.original_delta)
   or (not d.is_reverted and (d.cancel_delta <> 0 or d.reversal_delta > -d.original_delta))
union all
select
  'purchase'::text as document_type,
  d.document_id,
  d.store_id,
  d.product_id,
  d.original_delta::integer as original_delta,
  d.reversal_delta::integer as reversal_delta,
  case when d.is_reverted then 'reversal_mismatch' else 'reversal_on_live_document' end::text as issue
from purchase_docs d
where (d.is_reverted and d.reversal_delta <> -d.original_delta)
   or (not d.is_reverted and (d.cancel_delta <> 0 or -d.reversal_delta > d.original_delta))
;

-- Pares conversion_salida (empaque) / conversion_entrada (unidad) por
-- conversion_id. La conversion se compara contra lo que ella misma registro:
-- units_per_pack = unidades que entraron / empaques que salieron.
--   missing_salida / missing_entrada  falta uno de los dos movimientos
--   missing_link                      los dos productos nunca fueron un par
--   ratio_mismatch                    la salida no es negativa, la entrada no es
--                                     positiva, o no entran un numero entero de
--                                     unidades (> 1, como exige el par) por empaque
-- El units_per_pack VIGENTE del par va solo como dato (current_units_per_pack):
-- puede haberse editado despues de la conversion.
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
    case
      when pr.pack_delta < 0 and pr.unit_delta > 0 and pr.unit_delta % (-pr.pack_delta) = 0
        then (pr.unit_delta / (-pr.pack_delta))::integer
    end as recorded_units_per_pack,
    (
      select c.units_per_pack
      from public.product_pack_conversions c
      where c.pack_product_id = pr.pack_product_id
        and c.unit_product_id = pr.unit_product_id
      order by c.is_active desc, c.updated_at desc nulls last, c.created_at desc
      limit 1
    ) as current_units_per_pack
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
  l.recorded_units_per_pack as units_per_pack,
  case
    when l.pack_product_id is null then 'missing_salida'
    when l.unit_product_id is null then 'missing_entrada'
    when l.current_units_per_pack is null then 'missing_link'
    else 'ratio_mismatch'
  end::text as issue,
  l.current_units_per_pack
from linked l
where l.pack_product_id is null
   or l.unit_product_id is null
   or l.current_units_per_pack is null
   or l.recorded_units_per_pack is null
   or l.recorded_units_per_pack < 2
;

-- Las 9 vistas del informe: RLS del que consulta y lectura solo para
-- authenticated y service_role.
do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'stock_reconciliation',
    'stock_chain_breaks',
    'sales_without_movements',
    'purchases_without_movements',
    'movements_without_document',
    'reversal_mismatches',
    'conversion_mismatches',
    'negative_stock',
    'cross_store_movements'
  ]
  loop
    execute format('alter view public.%I set (security_invoker = true)', v_view);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_view);
    execute format('grant select on public.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
