-- =============================================================================
-- 20260717 — metodos de pago habilitados por tienda (app_settings)
-- Idempotente
-- =============================================================================

alter table public.app_settings
  add column if not exists enabled_payment_methods public.payment_method[] not null
  default array[
    'efectivo_ves'::public.payment_method,
    'efectivo_usd'::public.payment_method,
    'pago_movil'::public.payment_method,
    'punto_venta'::public.payment_method,
    'transferencia'::public.payment_method
  ];

alter table public.app_settings
  drop constraint if exists app_settings_enabled_payment_methods_len;

alter table public.app_settings
  add constraint app_settings_enabled_payment_methods_len
  check (cardinality(enabled_payment_methods) >= 1);

notify pgrst, 'reload schema';
