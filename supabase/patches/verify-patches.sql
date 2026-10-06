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
union all
select
  'categories.tax_rate',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'categories'
      and column_name = 'tax_rate'
  )
union all
select
  'rpc create_purchase uses assert_store_context',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_purchase'
      and pg_get_functiondef(p.oid) ilike '%assert_store_context%'
  )
union all
select
  'rpc create_sale uses assert_store_context',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_sale'
      and pg_get_functiondef(p.oid) ilike '%assert_store_context%'
  )
union all
select
  'rpc create_sale_with_payments (20260909)',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_sale_with_payments'
      and pg_get_function_identity_arguments(p.oid) like 'p_customer_id uuid, p_items jsonb, p_payments jsonb%'
  )
union all
select
  'sales.client_request_id + index (20260909)',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'client_request_id'
  ) and exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'sales_store_client_request_unique'
  )
union all
select
  'purchases.subtotal_ves',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'subtotal_ves'
  )
union all
select
  'purchases.discount_ves',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'discount_ves'
  )
union all
select
  'purchases.tax_ves',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'tax_ves'
  )
union all
select
  'purchase_items.pack_cost_ves',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_items' and column_name = 'pack_cost_ves'
  )
union all
select
  'purchase_items.tax_rate',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_items' and column_name = 'tax_rate'
  )
union all
select
  'rpc create_purchase accepts p_tax_ves',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_purchase'
      and pg_get_function_identity_arguments(p.oid) ilike '%p_tax_ves%'
  )
union all
select
  'rpc create_purchase accepts p_subtotal_ref',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_purchase'
      and pg_get_function_identity_arguments(p.oid) ilike '%p_subtotal_ref%'
  )
union all
select
  'purchase_items.subtotal_ref no es columna generada',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_items'
      and column_name = 'subtotal_ref'
      and is_generated = 'NEVER'
  )
union all
select
  'purchases.paid_ref',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'paid_ref'
  )
union all
select
  'table product_pack_conversions',
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'product_pack_conversions'
  )
union all
select
  'stock_movements.conversion_id',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'conversion_id'
  )
union all
select
  'rpc convert_pack_to_units',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'convert_pack_to_units'
      and pg_get_function_identity_arguments(p.oid)
        = 'p_pack_product_id uuid, p_pack_quantity integer, p_reason text'
  )
union all
select
  'contacts.is_pos_default',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contacts'
      and column_name = 'is_pos_default'
  )
union all
select
  'index contacts_store_pos_default_unique',
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'contacts_store_pos_default_unique'
  )
union all
select
  'rpc add_product_barcode',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'add_product_barcode'
      and pg_get_function_identity_arguments(p.oid) = 'p_product_id uuid, p_barcode text'
  )
union all
select
  'rpc stock_integrity_report',
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'stock_integrity_report'
      and pg_get_function_identity_arguments(p.oid) = 'p_store_id uuid'
  )
union all
select
  'view stock_reconciliation',
  exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name = 'stock_reconciliation'
  )
union all
select
  'stock_movements.seq not null',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'stock_movements'
      and column_name = 'seq' and is_nullable = 'NO'
  )
union all
select
  'trigger trg_stock_movements_apply',
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.stock_movements'::regclass
      and tgname = 'trg_stock_movements_apply' and not tgisinternal
  )
union all
select
  'triggers products stock guard (insert + update)',
  (
    select count(*) = 2 from pg_trigger
    where tgrelid = 'public.products'::regclass and not tgisinternal
      and tgname in ('trg_products_stock_guard_update', 'trg_products_stock_guard_insert')
  )
union all
select
  'stock_movements append-only (authenticated sin insert/update/delete)',
  not has_table_privilege('authenticated', 'public.stock_movements', 'insert')
    and not has_table_privilege('authenticated', 'public.stock_movements', 'update')
    and not has_table_privilege('authenticated', 'public.stock_movements', 'delete')
union all
select
  'assert_store_context rechaza perfiles inactivos',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'assert_store_context' and p.prosrc ilike '%is_active = true%'
  )
union all
select
  'sales/purchases/payments sin update de tabla para authenticated',
  not has_table_privilege('authenticated', 'public.sales', 'update')
    and not has_table_privilege('authenticated', 'public.purchases', 'update')
    and not has_table_privilege('authenticated', 'public.payments', 'update')
    and not has_any_column_privilege('authenticated', 'public.purchases', 'update')
    and not has_column_privilege('authenticated', 'public.sales', 'status', 'update')
    and not has_column_privilege('authenticated', 'public.payments', 'amount_ves', 'update')
union all
select
  '7 vistas de reportes con security_invoker',
  (
    select count(*) = 7 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and c.relname in ('stock_card', 'daily_sales_summary', 'gross_profit_summary', 'product_profitability',
        'customer_purchase_summary', 'supplier_purchase_summary', 'low_stock_products')
      and c.reloptions @> array['security_invoker=true']
  )
union all
select
  'anon sin select en las 7 vistas de reportes',
  not exists (
    select 1 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and c.relname in ('stock_card', 'daily_sales_summary', 'gross_profit_summary', 'product_profitability',
        'customer_purchase_summary', 'supplier_purchase_summary', 'low_stock_products')
      and has_table_privilege('anon', c.oid, 'select')
  )
union all
select
  'anon sin execute en funciones de public',
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'sales.client_request_hash + secuencia sales_invoice_seq (20261006b)',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'client_request_hash'
  ) and to_regclass('public.sales_invoice_seq') is not null
union all
select
  'rpc create_sale: una sola firma, con p_client_request_id (20261006b)',
  (
    select count(*) = 1
      and bool_and(pg_get_function_identity_arguments(p.oid) like '%p_invoice_number text, p_client_request_id uuid')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_sale'
  )
union all
select
  'rpc de ventas en modo estricto (sin set current_stock, stock por movimiento)',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_sale', 'cancel_sale', 'return_sale')
      and p.prosrc not ilike '%set current_stock%'
      and p.prosrc ilike '%insert into public.stock_movements%'
      and p.prosrc ilike '%order by id%for update%'
  )
union all
select
  'create_sale y create_sale_with_payments validan la clave con sale_idempotent_replay (C4)',
  (
    select count(*) = 2 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_sale', 'create_sale_with_payments')
      and p.prosrc ilike '%sale_idempotent_replay%'
  )
union all
select
  'return_sale anula pagos con cancel_payment_apply (C7)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'return_sale' and p.prosrc ilike '%cancel_payment_apply%'
  )
union all
select
  'register_payment rechaza ventas cancelada/devuelta (C8)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'register_payment'
      and p.prosrc ilike '%No se puede registrar un pago en una venta cancelada o devuelta%'
  )
union all
select
  'funciones internas de ventas sin execute para authenticated',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('cancel_payment_apply', 'sale_idempotent_replay', 'sale_request_hash')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
order by 1;
