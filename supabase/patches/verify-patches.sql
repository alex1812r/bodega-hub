-- =============================================================================
-- Verificar patches aplicados
-- Ejecutar despues de apply-all-pending.sql Y 20260716-multi-store.sql
-- Cada fila debe mostrar ok = true
-- =============================================================================

select
  'products.barcode' as check_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'barcode'
  ) as ok
union all
select
  'index products_store_barcode_unique',
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'products_store_barcode_unique'
  )
union all
select
  'supplier_products.last_pack_cost_ref',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supplier_products'
      and column_name = 'last_pack_cost_ref'
  )
union all
select
  'rpc register_supplier_product_price (7 args)',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'register_supplier_product_price'
      and pg_get_function_identity_arguments(p.oid)
        = 'p_supplier_product_id uuid, p_new_cost_ref numeric, p_new_cost_ves numeric, p_origin text, p_notes text, p_new_pack_cost_ref numeric, p_price_input_mode text'
  )
union all
select
  'bucket product-images',
  exists (
    select 1
    from storage.buckets
    where id = 'product-images'
  )
union all
select
  'policy Public read product images',
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read product images'
  )
union all
select
  'table stores',
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'stores'
  )
union all
select
  'products.store_id',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'store_id'
  )
union all
select
  'profiles.store_id',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'store_id'
  )
union all
select
  'fn current_user_store_id',
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_store_id'
  )
union all
select
  'view daily_sales_summary.store_id',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'daily_sales_summary'
      and column_name = 'store_id'
  )
union all
select
  'view low_stock_products.store_id',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'low_stock_products'
      and column_name = 'store_id'
  )
union all
select
  'app_settings.enabled_payment_methods',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'enabled_payment_methods'
  )
order by 1;
