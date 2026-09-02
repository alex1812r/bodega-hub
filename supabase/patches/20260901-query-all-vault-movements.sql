-- Todos los movimientos del vault (orden cronológico)
select
  vm.type,
  vm.bucket,
  vm.amount_ves,
  vm.amount_ref,
  vm.payment_id,
  vm.from_session_id,
  vm.notes,
  vm.created_at,
  vm.created_by
from public.vault_movements vm
where vm.store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
order by vm.created_at asc;
