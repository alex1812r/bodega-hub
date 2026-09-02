-- =============================================================================
-- Diagnóstico: estado del baúl y movimientos de caja
-- Ejecutar en SQL Editor para verificar datos
-- =============================================================================

-- 1. Estado actual del baúl
select * from public.store_vaults
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace';

-- 2. Total efectivo VES en caja (sale_in + opening + adjustment - transfer_out - refund_out)
--    hasta 01-sep-2026 13:00 Caracas (17:00 UTC)
select coalesce(sum(
  case
    when type in ('sale_in', 'opening', 'adjustment') then amount_ves
    when type in ('transfer_out', 'refund_out') then -amount_ves
    else 0
  end
), 0) as total_caja_efectivo_ves
from public.cash_movements
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  and created_at < '2026-09-01T17:00:00+00'::timestamptz;

-- 3. Lo que ya está en el baúl como efectivo
select coalesce(sum(amount_ves), 0) as ya_en_baul_efectivo
from public.vault_movements
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  and bucket = 'efectivo'
  and type in ('deposit', 'transfer_in')
  and created_at < '2026-09-01T17:00:00+00'::timestamptz;

-- 4. Últimos 10 movimientos del baúl (para ver si se insertó algo)
select type, bucket, amount_ves, amount_ref, notes, created_at, created_by
from public.vault_movements
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
order by created_at desc
limit 10;

-- 5. Buscar el marker del backfill (¿ya se ejecutó?)
select id, type, bucket, amount_ves, notes, created_at
from public.vault_movements
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
  and notes like '%BACKFILL_VAULT_EFECTIVO_VES_THRU_20260901T1300%';

-- 6. Último usuario closed_by (para debugging)
select id, closed_by, closed_at, status, vault_transferred_at
from public.cash_sessions
where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
order by closed_at desc nulls last
limit 5;
