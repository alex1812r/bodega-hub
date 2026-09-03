-- =============================================================================
-- 20260906c — store_capital_summary: arreglo de visibilidad para el admin
--
-- Problema: la version de 20260906 arrancaba con `from public.stores s`. La
-- tabla `stores` solo tiene politicas RLS para superadmin, y la vista es
-- `security_invoker`, asi que un admin de tienda recibia **cero filas**. El
-- servicio `capital.server.ts` rellena con ceros cuando no encuentra la fila,
-- de modo que el asistente respondia "capital US$ 0,00" en vez de fallar.
-- Con service role (superadmin / runner de patches) si devolvia datos, por eso
-- el bug no se veia al verificar la vista desde psql.
--
-- Arreglo: anclar en `store_vaults`, cuya politica "Users read store vault"
-- permite `store_id = current_user_store_id()`. La relacion es 1:1 con
-- `stores` (`store_id` es `not null unique references stores`), asi que el
-- conjunto de filas es el mismo para el service role.
--
-- Idempotente. Reemplaza la vista de 20260906. Requiere 20260811b y 20260812c.
-- =============================================================================

begin;

drop view if exists public.store_capital_summary;

create view public.store_capital_summary
with (security_invoker = true)
as
select
  v.store_id,
  v.balance_ref::numeric(14,2) as vault_balance_ref,
  v.balance_ves::numeric(14,2) as vault_balance_ves,
  v.balance_efectivo_ves::numeric(14,2) as vault_balance_efectivo_ves,
  coalesce(inv.inventario_costo_ref, 0)::numeric(14,2) as inventario_costo_ref,
  coalesce(cxc.cuentas_por_cobrar_ref, 0)::numeric(14,2) as cuentas_por_cobrar_ref,
  coalesce(cxp.cuentas_por_pagar_ref, 0)::numeric(14,2) as cuentas_por_pagar_ref
from public.store_vaults v
left join lateral (
  -- Inventario valorado al costo actual, solo productos activos.
  select sum(p.current_stock * p.current_cost_ref) as inventario_costo_ref
  from public.products p
  where p.store_id = v.store_id
    and p.is_active = true
) inv on true
left join lateral (
  -- Ventas por cobrar: lo facturado menos lo pagado, llevado a REF con la
  -- tasa de la propia venta (que es la que se uso para cobrar).
  select sum(
    greatest(sale.total_ref - (sale.paid_ves / nullif(sale.ref_rate_ves, 0)), 0)
  ) as cuentas_por_cobrar_ref
  from public.sales sale
  where sale.store_id = v.store_id
    and sale.status = 'pendiente_pago'::public.sale_status
) cxc on true
left join lateral (
  -- Compras vigentes (pedidas o recibidas) que aun deben pagarse.
  select sum(greatest(pur.total_ref - pur.paid_ref, 0)) as cuentas_por_pagar_ref
  from public.purchases pur
  where pur.store_id = v.store_id
    and pur.status in ('pedido'::public.purchase_status, 'recibido'::public.purchase_status)
) cxp on true;

comment on view public.store_capital_summary is
  'Componentes del capital por tienda para el asistente IA. Anclada en store_vaults (1:1 con stores) para que el admin vea su propia fila bajo RLS. security_invoker: hereda las RLS de store_vaults, products, sales y purchases.';

grant select on public.store_capital_summary to authenticated;

commit;

notify pgrst, 'reload schema';
