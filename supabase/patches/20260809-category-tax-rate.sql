-- =============================================================================
-- 20260809 — impuesto (%) por categoria de producto
-- Idempotente
-- =============================================================================

alter table public.categories
  add column if not exists tax_rate numeric(5,2) not null default 16
  check (tax_rate >= 0 and tax_rate <= 100);

notify pgrst, 'reload schema';
