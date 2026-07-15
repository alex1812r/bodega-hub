-- Reset operativo de Control Ventas ERP (dev/staging).
-- Borra productos, contactos, ventas, compras, pagos, inventario, etc.
-- Conserva: auth.users, auth.identities, public.profiles, public.categories.
--
-- Ejecutar en Supabase SQL Editor. NO usar en producción sin backup.
-- Opcional después: supabase/seed.sql (app_settings + tasa BCV; usuarios on conflict do nothing).

begin;

truncate table
  public.payments,
  public.stock_movements,
  public.sale_items,
  public.sales,
  public.purchase_items,
  public.purchases,
  public.supplier_product_pack_units,
  public.supplier_product_price_history,
  public.supplier_products,
  public.product_price_history,
  public.products,
  public.contacts,
  public.exchange_rates
restart identity cascade;

-- Singleton de configuración (no es dato de negocio, pero la app lo requiere).
insert into public.app_settings (id, business_name, default_tax_rate, invoice_prefix, low_stock_threshold)
values (1, 'Control Ventas ERP', 16, 'FAC', 5)
on conflict (id) do update set
  business_name = excluded.business_name,
  default_tax_rate = excluded.default_tax_rate,
  invoice_prefix = excluded.invoice_prefix,
  low_stock_threshold = excluded.low_stock_threshold,
  updated_at = now(),
  updated_by = null;

commit;
