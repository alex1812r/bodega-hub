-- =============================================================================
-- 20260906 — Vista store_capital_summary (asistente IA)
--
-- El asistente responde "cual es el capital actual" con una definicion unica y
-- documentada (docs/modules-catalog.md, seccion Asistente):
--
--   capital_ref = baul.balance_ref
--               + (baul.balance_efectivo_ves + baul.balance_ves) / tasa_del_dia
--               + inventario_a_costo_ref
--               + cuentas_por_cobrar_ref
--               - cuentas_por_pagar_ref
--
-- La vista devuelve los COMPONENTES por tienda; la conversion de Bs a REF y la
-- suma final las hace el servicio (`capital.server.ts`) con la tasa vigente,
-- porque la tasa se resuelve por HTTP y no vive en la base.
--
-- Idempotente. Requiere 20260716-multi-store y 20260812c-vault-efectivo-vs-cuenta.
-- =============================================================================

begin;

drop view if exists public.store_capital_summary;

create view public.store_capital_summary
with (security_invoker = true)
as
select
  s.id as store_id,
  coalesce(v.balance_ref, 0)::numeric(14,2) as vault_balance_ref,
  coalesce(v.balance_ves, 0)::numeric(14,2) as vault_balance_ves,
  coalesce(v.balance_efectivo_ves, 0)::numeric(14,2) as vault_balance_efectivo_ves,
  coalesce(inv.inventario_costo_ref, 0)::numeric(14,2) as inventario_costo_ref,
  coalesce(cxc.cuentas_por_cobrar_ref, 0)::numeric(14,2) as cuentas_por_cobrar_ref,
  coalesce(cxp.cuentas_por_pagar_ref, 0)::numeric(14,2) as cuentas_por_pagar_ref
from public.stores s
left join public.store_vaults v
  on v.store_id = s.id
left join lateral (
  -- Inventario valorado al costo actual, solo productos activos.
  select sum(p.current_stock * p.current_cost_ref) as inventario_costo_ref
  from public.products p
  where p.store_id = s.id
    and p.is_active = true
) inv on true
left join lateral (
  -- Ventas por cobrar: lo facturado menos lo pagado, llevado a REF con la
  -- tasa de la propia venta (que es la que se uso para cobrar).
  select sum(
    greatest(sale.total_ref - (sale.paid_ves / nullif(sale.ref_rate_ves, 0)), 0)
  ) as cuentas_por_cobrar_ref
  from public.sales sale
  where sale.store_id = s.id
    and sale.status = 'pendiente_pago'::public.sale_status
) cxc on true
left join lateral (
  -- Compras vigentes (pedidas o recibidas) que aun deben pagarse.
  select sum(greatest(pur.total_ref - pur.paid_ref, 0)) as cuentas_por_pagar_ref
  from public.purchases pur
  where pur.store_id = s.id
    and pur.status in ('pedido'::public.purchase_status, 'recibido'::public.purchase_status)
) cxp on true;

comment on view public.store_capital_summary is
  'Componentes del capital por tienda para el asistente IA. security_invoker: hereda las RLS de stores, store_vaults, products, sales y purchases.';

grant select on public.store_capital_summary to authenticated;

commit;

notify pgrst, 'reload schema';
