-- Monto actual por caja: efectivo VES, efectivo USD, pago móvil/transferencia
select
  cr.name as caja,
  cs.status,
  -- Efectivo VES (ventas en efectivo bolívares)
  coalesce(efectivo_ves.total, 0) as efectivo_ves,
  -- Efectivo USD (ventas en efectivo dólares)
  coalesce(efectivo_usd.total, 0) as efectivo_usd,
  -- Pago móvil / transferencia / punto (cuenta)
  coalesce(cuenta.total, 0) as pago_movil_transf,
  -- Fondo inicial
  cs.opening_ves,
  cs.opening_ref
from public.cash_registers cr
join public.cash_sessions cs on cs.register_id = cr.id and cs.status = 'open'
left join lateral (
  select sum(cm.amount_ves) as total
  from public.cash_movements cm
  where cm.session_id = cs.id
    and cm.type = 'sale_in'
    and cm.amount_ves > 0
) efectivo_ves on true
left join lateral (
  select sum(cm.amount_ref) as total
  from public.cash_movements cm
  where cm.session_id = cs.id
    and cm.type = 'sale_in'
    and cm.amount_ref > 0
) efectivo_usd on true
left join lateral (
  select sum(cm.amount_ves) as total
  from public.cash_movements cm
  where cm.session_id = cs.id
    and cm.type = 'account_in'
) cuenta on true
where cr.store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
order by cr.name;
