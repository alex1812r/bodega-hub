-- Balance esperado por bucket (calculado desde movimientos)
select
  bucket,
  sum(case when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ves
           when type in ('purchase_out', 'withdrawal') then -amount_ves
           else 0 end) as expected_ves,
  sum(case when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ref
           when type in ('purchase_out', 'withdrawal') then -amount_ref
           else 0 end) as expected_ref
from public.vault_movements
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
group by bucket
order by bucket;

-- Balance actual del vault
select
  balance_ves as cuenta_ves_actual,
  balance_efectivo_ves as efectivo_ves_actual,
  balance_ref as efectivo_ref_actual
from public.store_vaults
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace';

-- Diferencia (esperado - actual)
with expected as (
  select
    bucket,
    sum(case when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ves
             when type in ('purchase_out', 'withdrawal') then -amount_ves
             else 0 end) as expected_ves,
    sum(case when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ref
             when type in ('purchase_out', 'withdrawal') then -amount_ref
             else 0 end) as expected_ref
  from public.vault_movements
  where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  group by bucket
),
actual as (
  select
    balance_ves,
    balance_efectivo_ves,
    balance_ref
  from public.store_vaults
  where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
)
select
  'CUENTA VES' as concepto,
  (select expected_ves from expected where bucket = 'cuenta') as esperado,
  (select balance_ves from actual) as actual,
  (select expected_ves from expected where bucket = 'cuenta') - (select balance_ves from actual) as diferencia
union all
select
  'EFECTIVO VES' as concepto,
  (select expected_ves from expected where bucket = 'efectivo') as esperado,
  (select balance_efectivo_ves from actual) as actual,
  (select expected_ves from expected where bucket = 'efectivo') - (select balance_efectivo_ves from actual) as diferencia
union all
select
  'EFECTIVO REF' as concepto,
  (select expected_ref from expected where bucket = 'efectivo') as esperado,
  (select balance_ref from actual) as actual,
  (select expected_ref from expected where bucket = 'efectivo') - (select balance_ref from actual) as diferencia;
