-- Diagnóstico: verificar si los pagos de transferencia descontaron del vault

-- 1. Balance actual del baúl
select
  balance_ves as cuenta_bs,
  balance_efectivo_ves as efectivo_bs,
  balance_ref as efectivo_ref
from public.store_vaults
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace';

-- 2. Los dos pagos de transferencia que deberían haber descontado
select
  p.id as payment_id,
  p.method,
  p.amount as amount_original,
  p.amount_ves,
  p.status,
  p.created_at,
  p.notes
from public.payments p
where p.store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  and p.method in ('punto_venta', 'transferencia')
  and p.amount_ves in (55320.47, 21310.00)
  and p.created_at >= '2026-09-01T00:00:00+00'
order by p.created_at desc;

-- 3. Movimientos en el vault para esos pagos
select
  vm.type,
  vm.bucket,
  vm.amount_ves,
  vm.amount_ref,
  vm.payment_id,
  vm.notes,
  vm.created_at
from public.vault_movements vm
where vm.store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  and vm.type = 'purchase_out'
  and vm.bucket = 'cuenta'
  and vm.amount_ves in (55320.47, 21310.00)
order by vm.created_at desc;

-- 4. Historial de balance_ves (verificar si hubo descuentos)
select
  type,
  bucket,
  amount_ves,
  created_at,
  notes
from public.vault_movements
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  and bucket = 'cuenta'
  and type = 'purchase_out'
order by created_at desc
limit 10;
