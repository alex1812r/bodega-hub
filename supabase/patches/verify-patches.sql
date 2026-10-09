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
        = 'p_pack_product_id uuid, p_pack_quantity integer, p_reason text, p_client_request_id uuid, p_components jsonb'
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
union all
select
  'purchases.client_request_id + indice + secuencia purchases_number_seq (20261006c)',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'client_request_id'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'client_request_hash'
  ) and exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'purchases_store_client_request_unique'
  ) and to_regclass('public.purchases_number_seq') is not null
union all
select
  'table stock_request_keys con RLS y sin acceso para anon/authenticated (20261006c)',
  exists (
    select 1 from pg_class c
    where c.oid = to_regclass('public.stock_request_keys') and c.relrowsecurity
  )
    and not has_table_privilege('authenticated', 'public.stock_request_keys', 'select')
    and not has_table_privilege('authenticated', 'public.stock_request_keys', 'insert')
    and not has_table_privilege('anon', 'public.stock_request_keys', 'select')
union all
select
  'rpc create_purchase: una sola firma, con p_client_request_id (20261006c)',
  (
    select count(*) = 1
      and bool_and(pg_get_function_identity_arguments(p.oid) like '%p_subtotal_ref numeric, p_client_request_id uuid')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'rpc adjust_stock: una sola firma, con clave y documento (20261006c)',
  (
    select count(*) = 1
      and bool_and(pg_get_function_identity_arguments(p.oid)
        = 'p_product_id uuid, p_quantity_delta integer, p_reason text, p_type stock_movement_type, p_client_request_id uuid, p_sale_id uuid, p_purchase_id uuid')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'adjust_stock'
  )
union all
select
  'rpc convert_pack_to_units: una sola firma (20261006c)',
  (
    select count(*) = 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'convert_pack_to_units'
  )
union all
select
  'rpc de compras e inventario en modo estricto (stock por movimiento, bloqueo ordenado)',
  (
    select count(*) = 5 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_purchase', 'receive_purchase', 'cancel_purchase', 'return_purchase', 'convert_pack_to_units')
      and p.prosrc ilike '%insert into public.stock_movements%'
      and p.prosrc ilike '%order by id%for update%'
  ) and exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'adjust_stock' and p.prosrc ilike '%insert into public.stock_movements%'
  )
union all
select
  'solo stock_movements_apply escribe products.current_stock',
  -- 20261006e: ninguna otra funcion de public contiene el texto, ni siquiera en un comentario.
  (
    select coalesce(array_agg(p.proname::text order by p.proname), '{}') = array['stock_movements_apply']
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ilike '%set current_stock%'
  )
union all
select
  'create_purchase, adjust_stock y convert_pack_to_units validan la clave de idempotencia (C6)',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (
        (p.proname = 'create_purchase' and p.prosrc ilike '%purchase_idempotent_replay%')
        or (p.proname in ('adjust_stock', 'convert_pack_to_units') and p.prosrc ilike '%stock_request_replay%')
      )
  )
union all
select
  'create_purchase contrasta el modo empaque con product_pack_conversions (C13)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'create_purchase' and p.prosrc ilike '%product_pack_conversions%'
  )
union all
select
  'return_purchase exige recibido (C14)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'return_purchase' and p.prosrc ilike '%Solo se pueden devolver compras recibidas%'
  )
union all
select
  'register_payment rechaza compras cancelado/devuelto (C8 compras)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'register_payment'
      and p.prosrc ilike '%No se puede registrar un pago en una compra cancelada o devuelta%'
  )
union all
select
  'funciones internas de compras e inventario sin execute para authenticated',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('stock_request_hash', 'purchase_idempotent_replay', 'stock_request_replay')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
union all
select
  'stock_chain_breaks ordena la cadena por seq, no por created_at (20261006d, C16)',
  pg_get_viewdef('public.stock_chain_breaks'::regclass) ilike '%order by m.seq%'
    and pg_get_viewdef('public.stock_chain_breaks'::regclass) not ilike '%order by m.created_at%'
union all
select
  'vistas de integridad detectan documentos mutados (20261006d, C16)',
  pg_get_viewdef('public.movements_without_document'::regclass) ilike '%missing_document_line%'
    and pg_get_viewdef('public.movements_without_document'::regclass) ilike '%document_status_mismatch%'
    and pg_get_viewdef('public.reversal_mismatches'::regclass) ilike '%reversal_on_live_document%'
union all
select
  'conversion_mismatches compara contra lo registrado en la conversion (20261006d, C16)',
  pg_get_viewdef('public.conversion_mismatches'::regclass) ilike '%recorded_units_per_pack%'
union all
select
  '9 vistas de integridad con security_invoker, sin acceso anon/public y solo lectura',
  (
    select count(*) = 9 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
      and c.relname in ('stock_reconciliation', 'stock_chain_breaks', 'sales_without_movements',
        'purchases_without_movements', 'movements_without_document', 'reversal_mismatches',
        'conversion_mismatches', 'negative_stock', 'cross_store_movements')
      and c.reloptions @> array['security_invoker=true']
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert, update, delete')
      and not exists (
        select 1 from aclexplode(c.relacl) a where a.grantee = 0
      )
  )
union all
select
  'stock_movements_apply en modo estricto: sin rama legada, siempre calcula stock_after (20261006e)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'stock_movements_apply'
      and p.prosecdef
      and p.prosrc not ilike '%stock_after is null%'
      and p.prosrc not ilike '%stock_after is not null%'
      and p.prosrc ilike '%new.stock_after := v_current_stock + new.quantity_delta%'
      and p.prosrc ilike '%get diagnostics v_rows = row_count%'
  )
union all
select
  'products_stock_guard sin pase current_user: solo GUC app.stock_writer o sesion directa (20261006e)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'products_stock_guard'
      and not p.prosecdef
      and p.prosrc not ilike '%current_user%'
      and p.prosrc ilike '%app.stock_writer%'
      and p.prosrc ilike '%session_user in (''postgres'', ''supabase_admin'')%'
  )
union all
select
  'ninguna funcion de public inserta movimientos indicando stock_after (20261006e)',
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?stock_movements[[:space:]]*[(][^)]*stock_after'
  )
union all
select
  'toda funcion de public sin execute para anon ni public (20261006e)',
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
      )
  )
union all
select
  'cancel_sale repone lo vendido menos lo ya devuelto (20261006f, R1)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'cancel_sale'
      and p.prosrc ilike '%type = ''devolucion_cliente''%'
      and p.prosrc ilike '%v_line.sold - v_already_returned%'
  )
union all
select
  'funciones internas de caja y baul sin execute para authenticated (20261006f, R2)',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('record_cash_close_difference', 'auto_close_stale_cash_sessions', 'ensure_store_vault')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
  )
union all
select
  'record_cash_close_difference valida tienda, sesion abierta y quien cierra (20261006f, R2)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'record_cash_close_difference'
      and p.prosrc ilike '%assert_store_context()%'
      and p.prosrc ilike '%store_id = p_store_id%'
      and p.prosrc ilike '%v_session.opened_by is distinct from auth.uid()%'
  )
union all
select
  'cancel_purchase y return_purchase rechazan la compra con pagos activos (20261006f, R3)',
  (
    select count(*) = 2 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('cancel_purchase', 'return_purchase')
      and p.prosrc ilike '%pago(s) activo(s)%'
  )
union all
select
  'register_payment bloquea la sesion de caja antes de escribir el cobro (20261006f, R5)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'register_payment'
      and p.prosrc ilike '%status = ''open'' for share%'
      and p.prosrc not ilike '%public.current_user_role() not in%'
  )
union all
select
  'create_sale, create_sale_with_payments y create_purchase validan la entrada (20261006f, R6)',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_sale', 'create_sale_with_payments', 'create_purchase')
      and p.prosrc ilike '%numeric_value_out_of_range%'
      and p.prosrc ilike '%jsonb_typeof(v_%) is distinct from ''object''%'
  )
union all
select
  'adjust_stock exige la venta / compra en las devoluciones (20261006g, R4)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'adjust_stock'
      and p.prosrc ilike '%v_type = ''devolucion_cliente'' and p_sale_id is null%'
      and p.prosrc ilike '%v_type = ''devolucion_proveedor'' and p_purchase_id is null%'
  )
union all
select
  'update_product_price, register_supplier_product_price y deactivate_supplier_product filtran por la tienda del contexto (20261006g)',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('update_product_price', 'register_supplier_product_price', 'deactivate_supplier_product')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and p.prosrc ilike '%v_store_id := public.assert_store_context()%'
      and p.prosrc ilike '%and store_id = v_store_id%'
      and p.prosrc ilike '%errcode = ''PT404''%'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
  )
union all
select
  'funciones internas de caja y de historial de costos sin execute para authenticated (20261006g, R12)',
  (
    select count(*) = 2 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('get_open_cash_session_for_user', 'append_supplier_product_price_history')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and has_function_privilege('service_role', p.oid, 'execute')
  )
union all
select
  'cancel_payment_apply comprueba el baul antes de borrar el asiento bancario (20261006g, R7)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'cancel_payment_apply'
      and p.prosrc ilike '%no encontrado para revertir el cobro en cuenta%'
      and p.prosrc ilike '%no encontrado para revertir el pago desde cuenta%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
union all
select
  'stock_movements solo-append por trigger: update, delete y truncate (20261006g, R11)',
  (
    select count(*) = 2
      and bool_or(t.tgname = 'trg_stock_movements_append_only' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2
                  and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16)
      and bool_or(t.tgname = 'trg_stock_movements_no_truncate' and (t.tgtype & 2) = 2 and (t.tgtype & 32) = 32)
    from pg_trigger t
    where t.tgrelid = 'public.stock_movements'::regclass
      and not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgfoid = to_regprocedure('public.stock_movements_append_only()')
  ) and exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'stock_movements_append_only'
      and p.prosrc ilike '%session_user in (''postgres'', ''supabase_admin'')%'
  )
union all
select
  'ninguna funcion de public modifica ni borra stock_movements (20261006g, R11)',
  not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc ~* '(update|delete[[:space:]]+from|truncate)[[:space:]]+(table[[:space:]]+)?(only[[:space:]]+)?(public[.])?stock_movements([^_a-z0-9]|$)'
  )
union all
select
  'cancel_sale y register_payment rechazan la venta en borrador (20261006g, R17)',
  (
    select count(*) = 2 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('cancel_sale', 'register_payment')
      and p.prosrc ilike '%v_sale.status not in (''pagada'', ''pendiente_pago'')%'
  )
union all
select
  'lineas de venta / compra, historiales de precio y empaques solo se leen desde su tienda (20261006h, N1)',
  (
    select count(*) = 5 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.cmd = 'SELECT'
      and pol.tablename in ('sale_items', 'purchase_items', 'product_price_history',
                            'supplier_product_price_history', 'supplier_product_pack_units')
      and pol.qual ilike '%exists%store_id = current_user_store_id()%'
  ) and not exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename in ('sale_items', 'purchase_items', 'product_price_history',
                            'supplier_product_price_history', 'supplier_product_pack_units')
      and (pol.qual = 'true' or pol.with_check = 'true')
  )
union all
select
  'empaques e historiales de precio solo se escriben desde su tienda (20261006h, N2)',
  (
    select count(*) = 3 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.policyname in ('Admins and warehouse manage supplier product pack units',
                             'Admins and warehouse insert price history',
                             'Admins and warehouse insert supplier product price history')
      and pol.with_check ilike '%current_user_role()%exists%store_id = current_user_store_id()%'
      and (pol.cmd = 'INSERT' or pol.qual ilike '%current_user_role()%exists%store_id = current_user_store_id()%')
  ) and not exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename in ('product_price_history', 'supplier_product_price_history', 'supplier_product_pack_units')
      and pol.cmd <> 'SELECT'
      and coalesce(pol.with_check, pol.qual) not ilike '%current_user_store_id()%'
  )
union all
select
  'caja y baul sin escritura por PostgREST: ni privilegios ni politicas de escritura (20261006h, N3)',
  not exists (
    select 1
    from unnest(array['store_vaults', 'vault_movements', 'cash_movements', 'cash_sessions']) as t(name)
    cross join unnest(array['anon', 'authenticated']) as r(name)
    where has_table_privilege(r.name, 'public.' || t.name, 'INSERT')
       or has_table_privilege(r.name, 'public.' || t.name, 'UPDATE')
       or has_table_privilege(r.name, 'public.' || t.name, 'DELETE')
       or has_table_privilege(r.name, 'public.' || t.name, 'TRUNCATE')
       or has_any_column_privilege(r.name, 'public.' || t.name, 'INSERT')
       or has_any_column_privilege(r.name, 'public.' || t.name, 'UPDATE')
  ) and not exists (
    select 1 from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename in ('store_vaults', 'vault_movements', 'cash_movements', 'cash_sessions')
      and pol.cmd <> 'SELECT'
  ) and (
    select count(*) = 4 from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('store_vaults', 'vault_movements', 'cash_movements', 'cash_sessions')
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'SELECT')
  )
union all
select
  'las RPC con numeric de entrada rechazan NaN / Infinity con assert_finite_numeric (20261006h, N4)',
  (
    select count(*) = 8 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_sale', 'create_sale_with_payments', 'create_purchase', 'register_payment',
                        'update_product_price', 'register_supplier_product_price',
                        'close_cash_session', 'register_vault_deposit')
      and p.prosrc ilike '%v_store_id := public.assert_store_context();%perform public.assert_finite_numeric(%'
  ) and exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.assert_finite_numeric(numeric, text)')
      and p.prosrc ilike '%''NaN''::numeric%''Infinity''::numeric%''-Infinity''::numeric%'
      and p.prosrc ilike '%errcode = ''PT400''%'
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
union all
select
  'update_product_price, register_supplier_product_price y deactivate_supplier_product responden PT403 al rol no autorizado (20261006h, N6)',
  (
    select count(*) = 3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('update_product_price', 'register_supplier_product_price', 'deactivate_supplier_product')
      and p.prosrc ilike '%coalesce(public.current_user_role()::text, '''') not in (''admin'', ''almacen'')%errcode = ''PT403''%'
      and p.prosrc not ilike '%if public.current_user_role() not in%'
  )
union all
select
  'cancel_payment_apply bloquea la sesion de caja abierta antes de evaluar F4 (20261006h, R5c)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'cancel_payment_apply'
      and p.prosrc ilike '%from public.cash_sessions s%s.status = ''open''%for share;%s.vault_transferred_at is not null%'
      and p.prosrc ilike '%no encontrado para revertir el cobro en cuenta%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
union all
select
  'reject_non_finite_numeric responde PT400, no usa literales de Infinity y no es ejecutable por PostgREST (20261006i, M1)',
  exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.reject_non_finite_numeric()')
      and p.prorettype = 'trigger'::regtype
      and not p.prosecdef
      and p.prosrc ilike '%errcode = ''PT400''%Valor numerico invalido en %s: debe ser un numero finito%'
      and p.prosrc not ilike '%::numeric%'
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
union all
select
  'toda tabla de public con columnas numeric rechaza NaN / Infinity en insert y update, con todas sus columnas (20261006i, M1)',
  (
    select count(*) >= 16
       and count(*) filter (where c.relname in ('products', 'exchange_rates', 'supplier_products', 'sales', 'payments')) = 5
       and bool_and(
         (
           select count(*) = 2
           from pg_trigger t
           where t.tgrelid = c.oid
             and not t.tgisinternal
             and t.tgenabled = 'O'
             and t.tgqual is not null
             and t.tgfoid = to_regprocedure('public.reject_non_finite_numeric()')
             and (t.tgname, t.tgtype::int) in (
               ('trg_zz_reject_non_finite_numeric_ins', 7),   -- row + before + insert
               ('trg_zz_reject_non_finite_numeric_upd', 19)   -- row + before + update
             )
             and t.tgnargs = (
               select count(*) from pg_attribute a
               where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                 and a.attgenerated = '' and a.atttypid = 'numeric'::regtype
             )
         )
       )
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          and a.attgenerated = '' and a.atttypid = 'numeric'::regtype
      )
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
  )
union all
select
  'tax_rates: tabla con RLS, code unico por ambito (global / tienda) y sin delete por PostgREST (20261007a)',
  exists (
    select 1 from pg_class c
    where c.oid = to_regclass('public.tax_rates')
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'delete')
      and not has_table_privilege('anon', c.oid, 'select')
  )
  and (
    select count(*) = 2
    from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'tax_rates'
      and (
        (i.indexname = 'tax_rates_global_code_unique' and i.indexdef ilike '%unique%(code)%where (store_id is null)%')
        or (i.indexname = 'tax_rates_store_code_unique' and i.indexdef ilike '%unique%(store_id, code)%where (store_id is not null)%')
      )
  )
  and (
    select count(*) = 3
       and count(*) filter (where p.cmd = 'SELECT' and p.qual ilike '%store_id is null%current_user_store_id()%') = 1
       and count(*) filter (where p.cmd in ('INSERT', 'UPDATE') and p.with_check ilike '%current_user_store_id()%current_user_role()%admin%') = 2
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'tax_rates'
  )
union all
select
  'tax_rates: semilla global exento 0, reducida 8 y general 16 (20261007a)',
  (
    select count(*) = 3
    from public.tax_rates t
    where t.store_id is null
      and (t.code, t.pct) in (('exento', 0), ('reducida', 8), ('general', 16))
  )
union all
select
  'categories.tax_rate_id y app_settings.default_tax_rate_id son FK a tax_rates (20261007a)',
  (
    select count(*) = 2
    from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    where k.contype = 'f'
      and k.confrelid = to_regclass('public.tax_rates')
      and array_length(k.conkey, 1) = 1
      and (k.conrelid::regclass::text, a.attname::text) in (('categories', 'tax_rate_id'), ('app_settings', 'default_tax_rate_id'))
  )
union all
select
  'categories.tax_rate y tax_rate_id se sincronizan por trigger y un porcentaje sin alicuota responde PT400 (20261007a)',
  exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = to_regclass('public.categories')
      and t.tgname = 'trg_categories_sync_tax_rate'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgtype::int = 23   -- row + before + insert + update
      and p.oid = to_regprocedure('public.categories_sync_tax_rate()')
      and p.prosecdef
      and p.prosrc ilike '%new.tax_rate := v_rate.pct%tax_rate_for_pct(new.store_id, new.tax_rate, false)%errcode = ''PT400''%new.tax_rate_id := v_rate.id%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
  )
  and exists (
    select 1 from pg_trigger t
    where t.tgrelid = to_regclass('public.tax_rates')
      and t.tgname = 'trg_tax_rates_propagate_pct'
      and t.tgenabled = 'O'
      and t.tgfoid = to_regprocedure('public.tax_rates_propagate_pct()')
  )
union all
select
  'ninguna categoria queda sin alicuota ni con un porcentaje distinto al de su alicuota (20261007a)',
  not exists (
    select 1
    from public.categories c
    left join public.tax_rates t on t.id = c.tax_rate_id
    where t.id is null
       or t.pct is distinct from c.tax_rate
       or (t.store_id is not null and t.store_id <> c.store_id)
  )
union all
select
  'purchase_items.tax_rate_code (20261007a)',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchase_items'
      and column_name = 'tax_rate_code' and data_type = 'text' and is_nullable = 'YES'
  )
union all
select
  'rpc create_purchase: misma firma de 14 argumentos y la linea toma su IVA del catalogo tax_rates (20261007a)',
  (
    select count(*) = 1
       and bool_and(
         pg_get_function_identity_arguments(p.oid) ilike '%p_client_request_id uuid'
         and p.pronargs = 14
         and p.prosecdef
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%'
         and p.prosrc ilike '%v_item ->> ''tax_rate_code''%public.tax_rates_for_store(v_store_id)%t.is_active%errcode = ''PT400''%public.tax_rate_for_pct(v_store_id, v_tax_rate, true)%errcode = ''PT400''%'
         and p.prosrc ilike '%cost_currency,%tax_rate_code%v_cost_currency,%v_tax_rate_code%'
         and p.prosrc not ilike '%current_stock%'
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'tax_rates_for_store / tax_rate_for_pct: lectura con el RLS de quien llama; solo la primera es ejecutable por authenticated (20261007a)',
  (
    select count(*) = 2
       and bool_and(not p.prosecdef and not has_function_privilege('anon', p.oid, 'execute'))
       and bool_or(p.proname = 'tax_rates_for_store' and has_function_privilege('authenticated', p.oid, 'execute'))
       and bool_or(p.proname = 'tax_rate_for_pct' and not has_function_privilege('authenticated', p.oid, 'execute'))
    from pg_proc p
    where p.oid in (
      to_regprocedure('public.tax_rates_for_store(uuid)'),
      to_regprocedure('public.tax_rate_for_pct(uuid, numeric, boolean)')
    )
  )
union all
select
  'rpc override_tax_rate_for_store: una sola firma, security definer con search_path, devuelve tax_rates y solo la ejecutan authenticated / service_role (20261007b)',
  (
    select count(*) = 1
       and bool_and(
         p.oid = to_regprocedure('public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer)')
         and p.prosecdef
         and p.prorettype = to_regtype('public.tax_rates')
         and not p.proretset
         and p.proconfig @> array['search_path=public']
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'override_tax_rate_for_store'
  )
union all
select
  'rpc override_tax_rate_for_store: tienda de la sesion, solo admin (PT403), PT404 / PT409, bloqueo de alicuota y categorias en orden y traspaso de categorias y alicuota por defecto (20261007b)',
  exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.override_tax_rate_for_store(uuid, text, numeric, boolean, integer)')
      and p.prosrc ilike '%v_store_id := public.assert_store_context();%current_user_role()%<> ''admin''%errcode = ''PT403''%'
      and p.prosrc ilike '%errcode = ''PT404''%on conflict (store_id, code) where store_id is not null do nothing%for update%order by c.id%for update%'
      and p.prosrc ilike '%update public.categories%set tax_rate_id = v_rate.id%update public.app_settings%set default_tax_rate_id = v_rate.id%errcode = ''PT409''%update public.tax_rates%'
      and p.prosrc not ilike '%purchase_items%'
      and p.prosrc not ilike '%current_stock%'
  )
union all
select
  'payments.client_request_id / client_request_hash e indice unico por tienda (20261008a, P4-3)',
  (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and is_nullable = 'YES'
      and (column_name, data_type) in (('client_request_id', 'uuid'), ('client_request_hash', 'text'))
  )
  and exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public' and i.tablename = 'payments'
      and i.indexname = 'payments_store_client_request_unique'
      and i.indexdef ilike '%unique%(store_id, client_request_id)%where (client_request_id is not null)%'
  )
union all
select
  'rpc register_payment: una sola firma de 13 argumentos con p_client_request_id, advisory lock y replay antes de leer saldos (20261008a, P4-3)',
  (
    select count(*) = 1
       and bool_and(
         pg_get_function_identity_arguments(p.oid) ilike '%p_client_request_id uuid'
         and p.pronargs = 13
         and p.prosecdef
         and p.proconfig @> array['search_path=public']
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%pg_advisory_xact_lock(%''payment-request:''%payment_idempotent_replay(v_store_id, p_client_request_id, v_request_hash)%return v_payment;%from public.sales where id = p_sale_id and store_id = v_store_id for update%'
         and p.prosrc ilike '%client_request_id, client_request_hash%p_client_request_id, case when p_client_request_id is not null then v_request_hash end%'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'register_payment'
  )
union all
select
  'payment_idempotent_replay: interna (sin execute para authenticated / anon), PT409 con otra huella, otro usuario o pago anulado (20261008a, P4-3)',
  exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.payment_idempotent_replay(uuid, uuid, text)')
      and p.prosecdef
      and p.prosrc ilike '%client_request_hash is distinct from p_client_request_hash%created_by is distinct from auth.uid()%status = ''anulado''%errcode = ''PT409''%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'products.margin_pct: columna generada almacenada, numeric, con el calculo de markup sobre current_cost_ref y NULL sin costo (20261009a)',
  exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = to_regclass('public.products')
      and a.attname = 'margin_pct'
      and not a.attisdropped
      and a.attgenerated = 's'
      and a.atttypid = 'numeric'::regtype
      and pg_get_expr(d.adbin, d.adrelid) ilike '%current_cost_ref > %sale_price_ref - current_cost_ref%/ current_cost_ref%100%, 6)%'
  )
union all
select
  'index products_store_margin_pct_idx sobre (store_id, margin_pct) (20261009a)',
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'products'
      and indexname = 'products_store_margin_pct_idx'
      and indexdef ilike '%(store_id, margin_pct)%'
  )
union all
select
  'app_settings: semaforo y chips por tienda (margin_yellow_from_pct 15, margin_green_from_pct 25, markup_chips_pct {12,20,30}), not null (20261009b)',
  (
    select count(*) = 3
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = to_regclass('public.app_settings')
      and not a.attisdropped
      and a.attnotnull
      and (
        (a.attname = 'margin_yellow_from_pct' and a.atttypid = 'numeric'::regtype and pg_get_expr(d.adbin, d.adrelid) = '15')
        or (a.attname = 'margin_green_from_pct' and a.atttypid = 'numeric'::regtype and pg_get_expr(d.adbin, d.adrelid) = '25')
        or (a.attname = 'markup_chips_pct' and a.atttypid = 'numeric[]'::regtype and pg_get_expr(d.adbin, d.adrelid) ilike '%{12,20,30}%')
      )
  )
union all
select
  'app_settings: checks 0 <= amarillo < verde <= 1000 y chips validos (1 a 6, > 0 y <= 1000, sin duplicados) (20261009b)',
  (
    select count(*) = 2
    from pg_constraint c
    where c.conrelid = to_regclass('public.app_settings')
      and c.contype = 'c'
      and c.convalidated
      and (
        (c.conname = 'app_settings_margin_thresholds_check'
          and pg_get_constraintdef(c.oid) ilike '%margin_yellow_from_pct >= %margin_yellow_from_pct < margin_green_from_pct%margin_green_from_pct <= %1000%')
        or (c.conname = 'app_settings_markup_chips_check'
          and pg_get_constraintdef(c.oid) ilike '%is_valid_markup_chips(markup_chips_pct)%')
      )
  )
  and exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.is_valid_markup_chips(numeric[])')
      and p.provolatile = 'i'
      and not p.prosecdef
      and p.prosrc ilike '%coalesce(%array_ndims(p_chips) = 1%between 1 and 6%chip.pct > 0 and chip.pct <= 1000%count(distinct chip.pct)%false%'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'categories.default_markup_pct: numeric opcional con check NULL o (> 0 y <= 1000) (20261009b)',
  exists (
    select 1
    from pg_attribute a
    join pg_constraint c on c.conrelid = a.attrelid and c.conname = 'categories_default_markup_pct_check'
    where a.attrelid = to_regclass('public.categories')
      and a.attname = 'default_markup_pct'
      and not a.attisdropped
      and not a.attnotnull
      and a.atttypid = 'numeric'::regtype
      and c.contype = 'c'
      and c.convalidated
      and pg_get_constraintdef(c.oid) ilike '%default_markup_pct is null%default_markup_pct > %default_markup_pct <= %1000%'
  )
union all
select
  'app_settings y categories: los triggers de NaN / Infinity cubren las columnas numeric nuevas (20261009b)',
  (
    select count(*) = 4
    from pg_trigger t
    where not t.tgisinternal
      and t.tgfoid = to_regprocedure('public.reject_non_finite_numeric()')
      and t.tgname in ('trg_zz_reject_non_finite_numeric_ins', 'trg_zz_reject_non_finite_numeric_upd')
      and (
        (t.tgrelid = to_regclass('public.app_settings')
          and pg_get_triggerdef(t.oid) ilike '%margin_yellow_from_pct%margin_green_from_pct%')
        or (t.tgrelid = to_regclass('public.categories')
          and pg_get_triggerdef(t.oid) ilike '%default_markup_pct%')
      )
  )
union all
select
  'product_price_history: instantanea de precio (cost_ref_snapshot numeric, margin_band_snapshot text con check, snapshot_seq bigint; las tres o ninguna) e indices de apoyo (20261009c)',
  (
    select count(*) = 3
    from pg_attribute a
    where a.attrelid = to_regclass('public.product_price_history')
      and not a.attisdropped
      and not a.attnotnull
      and (
        (a.attname = 'cost_ref_snapshot' and a.atttypid = 'numeric'::regtype)
        or (a.attname = 'margin_band_snapshot' and a.atttypid = 'text'::regtype)
        or (a.attname = 'snapshot_seq' and a.atttypid = 'bigint'::regtype)
      )
  )
  and (
    select count(*) = 2
    from pg_constraint c
    where c.conrelid = to_regclass('public.product_price_history')
      and c.contype = 'c'
      and c.convalidated
      and (
        (c.conname = 'product_price_history_margin_band_snapshot_check'
          and pg_get_constraintdef(c.oid) ilike '%red%yellow%green%none%')
        or (c.conname = 'product_price_history_snapshot_complete_check'
          and pg_get_constraintdef(c.oid) ilike '%num_nulls(cost_ref_snapshot, margin_band_snapshot, snapshot_seq)%')
      )
  )
  and (
    select count(*) = 2
    from pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'product_price_history'
      and (
        (i.indexname = 'idx_product_price_history_product_created' and i.indexdef ilike '%(product_id, created_at desc)%')
        or (i.indexname = 'idx_product_price_history_product_snapshot'
          and i.indexdef ilike '%(product_id, snapshot_seq desc)%where%snapshot_seq is not null%')
      )
  )
union all
select
  'product_margin_band / margin_band_from_thresholds / margin_band_rank: regla de bordes de @bodega/core, umbrales de la tienda con 15 / 25 por defecto, sin security definer ni execute para anon (20261009c)',
  (
    select count(*) = 3
       and bool_and(not p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute'))
       and bool_or(p.proname = 'margin_band_from_thresholds' and p.provolatile = 'i'
         and p.prosrc ilike '%p_margin_pct is null then ''none''%p_margin_pct < p_yellow_from_pct then ''red''%p_margin_pct < p_green_from_pct then ''yellow''%else ''green''%')
       and bool_or(p.proname = 'margin_band_rank' and p.provolatile = 'i'
         and p.prosrc ilike '%''red'' then 0%''yellow'' then 1%''green'' then 2%')
       and bool_or(p.proname = 'product_margin_band' and p.provolatile = 's'
         and p.prosrc ilike '%margin_band_from_thresholds(%margin_yellow_from_pct%a.store_id = p_store_id), 15)%margin_green_from_pct%a.store_id = p_store_id), 25)%')
    from pg_proc p
    where p.oid in (
      to_regprocedure('public.margin_band_from_thresholds(numeric, numeric, numeric)'),
      to_regprocedure('public.margin_band_rank(text)'),
      to_regprocedure('public.product_margin_band(uuid, numeric)')
    )
  )
union all
select
  'rpc update_product_price: una sola firma, mismas guardas que 20261006h y la fila de historial lleva costo, banda y posicion de la instantanea (20261009c)',
  (
    select count(*) = 1
       and bool_and(
         p.oid = to_regprocedure('public.update_product_price(uuid, numeric, text)')
         and p.prosecdef
         and p.prorettype = to_regtype('public.products')
         and p.proconfig @> array['search_path=public']
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%assert_finite_numeric(p_new_sale_price_ref%errcode = ''PT403''%for update%set sale_price_ref = p_new_sale_price_ref%'
         and p.prosrc ilike '%insert into public.product_price_history%cost_ref_snapshot,%margin_band_snapshot,%snapshot_seq%v_product.current_cost_ref,%product_margin_band(v_store_id, v_product.margin_pct),%nextval(''public.stock_movements_seq'')%'
         and p.prosrc not ilike '%current_stock%'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'update_product_price'
  )
union all
select
  'rpc keep_product_price: una firma (uuid, text, numeric), security definer con search_path, tienda de la sesion, admin / almacen (PT403), bloqueo del producto (PT404), costo esperado (PT409), solo inserta historial y solo la ejecutan authenticated / service_role (20261009c; firma de 20261009f)',
  (
    select count(*) = 1
       and bool_and(
         p.oid = to_regprocedure('public.keep_product_price(uuid, text, numeric)')
         and p.prosecdef
         and p.prorettype = to_regtype('public.product_price_history')
         and not p.proretset
         and p.proconfig @> array['search_path=public']
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%current_user_role()%not in (''admin'', ''almacen'')%errcode = ''PT403''%and store_id = v_store_id%for update%errcode = ''PT404''%assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref)%insert into public.product_price_history%'
         and p.prosrc not ilike '%update public.products%'
         and p.prosrc not ilike '%current_stock%'
         and p.prosrc not ilike '%into public.stock_movements%'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'keep_product_price'
  )
union all
select
  'trigger trg_products_price_baseline: after insert por fila en products, funcion security definer que solo inserta la linea base y no es ejecutable por /rpc (20261009c)',
  exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = to_regclass('public.products')
      and t.tgname = 'trg_products_price_baseline'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgtype = 5
      and p.oid = to_regprocedure('public.products_price_baseline()')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and p.prosrc ilike '%insert into public.product_price_history%new.current_cost_ref%product_margin_band(new.store_id, new.margin_pct)%'
      and p.prosrc not ilike '%update public.%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'view products_price_review: security_invoker, solo productos activos cuyo costo subio y cuya banda empeoro, select para authenticated / service_role y no para anon (20261009c)',
  exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.products_price_review')
      and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
      and pg_get_viewdef(c.oid) ilike '%snapshot_seq is not null%order by h.snapshot_seq desc%sm.seq > s.snapshot_seq%p.is_active%p.current_cost_ref > s.cost_ref_snapshot%margin_band_rank(b.current_band) < %margin_band_rank(s.margin_band_snapshot)%'
      and has_table_privilege('authenticated', c.oid, 'select')
      and has_table_privilege('service_role', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert')
  )
union all
select
  'price_review(products): relacion calculada de PostgREST sobre products_price_review, una fila como mucho, con el RLS de quien llama (20261009c)',
  exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.price_review(public.products)')
      and not p.prosecdef
      and p.proretset
      and p.prorows = 1
      and p.provolatile = 's'
      and p.prorettype = to_regtype('public.products_price_review')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'product_price_history: los triggers de NaN / Infinity cubren cost_ref_snapshot (20261009c)',
  (
    select count(*) = 2
    from pg_trigger t
    where not t.tgisinternal
      and t.tgfoid = to_regprocedure('public.reject_non_finite_numeric()')
      and t.tgname in ('trg_zz_reject_non_finite_numeric_ins', 'trg_zz_reject_non_finite_numeric_upd')
      and t.tgrelid = to_regclass('public.product_price_history')
      and pg_get_triggerdef(t.oid) ilike '%cost_ref_snapshot%'
  )
union all
select
  'product_pack_conversions: cabecera de receta (label text opcional, total_units integer not null > 0, units_per_pack = total_units, unit_product_id opcional) (20261009d)',
  (
    select count(*) = 4
       and bool_and(case c.column_name
             when 'label' then c.data_type = 'text' and c.is_nullable = 'YES'
             when 'total_units' then c.data_type = 'integer' and c.is_nullable = 'NO'
             when 'units_per_pack' then c.data_type = 'integer' and c.is_nullable = 'NO'
             when 'unit_product_id' then c.data_type = 'uuid' and c.is_nullable = 'YES'
           end)
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'product_pack_conversions'
      and c.column_name in ('label', 'total_units', 'units_per_pack', 'unit_product_id')
  ) and (
    select count(*) = 2
    from pg_constraint k
    where k.conrelid = to_regclass('public.product_pack_conversions') and k.contype = 'c' and k.convalidated
      and k.conname in ('product_pack_conversions_total_units_check', 'product_pack_conversions_units_mirror_check')
  )
union all
select
  'product_pack_components: tabla de componentes (conversion_id en cascada, units_per_pack > 0, cost_weight > 0 y finito con default 1, unico por receta y producto) (20261009d)',
  (
    select count(*) = 5
       and bool_and(c.is_nullable = 'NO')
       and bool_and(case c.column_name
             when 'units_per_pack' then c.data_type = 'integer'
             when 'cost_weight' then c.data_type = 'numeric' and c.column_default = '1'
             else c.data_type = 'uuid'
           end)
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'product_pack_components'
      and c.column_name in ('conversion_id', 'store_id', 'unit_product_id', 'units_per_pack', 'cost_weight')
  ) and (
    select count(*) = 4
    from pg_constraint k
    where k.conrelid = to_regclass('public.product_pack_components') and k.convalidated
      and (
        (k.conname = 'product_pack_components_units_per_pack_check' and k.contype = 'c')
        or (k.conname = 'product_pack_components_cost_weight_check' and k.contype = 'c'
            and pg_get_constraintdef(k.oid) ilike '%cost_weight > %cost_weight - cost_weight%')
        or (k.conname = 'product_pack_components_conversion_unit_unique' and k.contype = 'u')
        or (k.contype = 'f' and k.confrelid = to_regclass('public.product_pack_conversions') and k.confdeltype = 'c')
      )
  )
union all
select
  'product_pack_conversions: sin indice unico del lado unidad y con el unico del lado empaque (una receta activa por empaque) (20261009d)',
  not exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = to_regclass('public.product_pack_conversions')
      and i.indisunique and a.attname = 'unit_product_id'
  ) and exists (
    select 1
    from pg_indexes x
    where x.schemaname = 'public' and x.tablename = 'product_pack_conversions'
      and x.indexname = 'uq_product_pack_conversions_pack_active'
      and x.indexdef ilike 'create unique index%(pack_product_id) where (is_active = true)'
  )
union all
select
  'recetas de empaque: la suma de componentes de la receta activa se exige con triggers de restriccion diferidos en cabecera y componentes (20261009d)',
  (
    select count(*) = 2
    from pg_trigger t
    where not t.tgisinternal and t.tgenabled = 'O'
      and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
      and t.tgfoid = to_regprocedure('public.assert_pack_recipe_consistent()')
      and (
        (t.tgrelid = to_regclass('public.product_pack_conversions') and t.tgname = 'trg_zz_pack_recipe_sum')
        or (t.tgrelid = to_regclass('public.product_pack_components') and t.tgname = 'trg_zz_pack_recipe_sum')
      )
  ) and exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.assert_pack_recipe_consistent()')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and p.prosrc ilike '%not v_header.is_active%sum(pc.units_per_pack)%PT400%v_units <> v_header.total_units%PT400%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'recetas de empaque: triggers de validacion y de compatibilidad (cabecera <-> componente unico) activos y no ejecutables por /rpc (20261009d)',
  (
    select count(*) = 7
    from pg_trigger t
    where not t.tgisinternal and t.tgenabled = 'O'
      and (
        (t.tgrelid = to_regclass('public.product_pack_conversions')
         and (t.tgname, t.tgfoid) in (
           ('trg_validate_product_pack_conversion', to_regprocedure('public.validate_product_pack_conversion()')::oid),
           ('trg_product_pack_conversions_sync_component_ins', to_regprocedure('public.product_pack_conversions_sync_component()')::oid),
           ('trg_product_pack_conversions_sync_component_upd', to_regprocedure('public.product_pack_conversions_sync_component()')::oid)
         ))
        or (t.tgrelid = to_regclass('public.product_pack_components')
         and (t.tgname, t.tgfoid) in (
           ('trg_validate_product_pack_component', to_regprocedure('public.validate_product_pack_component()')::oid),
           ('trg_product_pack_components_sync_header_ins', to_regprocedure('public.product_pack_components_sync_header()')::oid),
           ('trg_product_pack_components_sync_header_upd', to_regprocedure('public.product_pack_components_sync_header()')::oid),
           ('trg_product_pack_components_sync_header_del', to_regprocedure('public.product_pack_components_sync_header()')::oid)
         ))
      )
  ) and (
    select count(*) = 3
    from pg_proc p
    where p.oid in (
        to_regprocedure('public.product_pack_conversions_sync_component()'),
        to_regprocedure('public.validate_product_pack_component()'),
        to_regprocedure('public.product_pack_components_sync_header()')
      )
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'recetas de empaque: toda receta activa cuadra con sus componentes y la cabecera refleja al componente unico (migracion 1 a 1 de 20261009d)',
  not exists (
    select 1
    from public.product_pack_conversions c
    left join lateral (
      select count(*) as n, coalesce(sum(pc.units_per_pack), 0) as units, min(pc.unit_product_id::text)::uuid as only_unit
      from public.product_pack_components pc
      where pc.conversion_id = c.id
    ) s on true
    where (c.is_active and (s.n = 0 or s.units <> c.total_units))
       or c.unit_product_id is distinct from (case when s.n = 1 then s.only_unit end)
       or c.units_per_pack <> c.total_units
  )
union all
select
  'product_pack_components: RLS por tienda (politicas de lectura de la tienda y de escritura admin / almacen), authenticated solo lee la tabla (la escritura directa la cierra 20261011d: la receta se guarda por save_pack_recipe) y sin privilegios para anon (20261009d)',
  exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.product_pack_components')
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')
      and not has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
  ) and (
    select count(*) = 2
       and bool_and(pol.roles = '{authenticated}'::name[])
       and bool_and(pol.qual ilike '%store_id = current_user_store_id()%')
       and bool_and(pol.cmd = 'SELECT' or (pol.cmd = 'ALL' and pol.qual ilike '%current_user_role()%admin%almacen%'
                                          and pol.with_check ilike '%store_id = current_user_store_id()%current_user_role()%admin%almacen%'))
    from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename = 'product_pack_components'
  )
union all
select
  'product_pack_components: los triggers de NaN / Infinity cubren cost_weight (20261009d)',
  (
    select count(*) = 2
    from pg_trigger t
    where not t.tgisinternal
      and t.tgfoid = to_regprocedure('public.reject_non_finite_numeric()')
      and t.tgname in ('trg_zz_reject_non_finite_numeric_ins', 'trg_zz_reject_non_finite_numeric_upd')
      and t.tgrelid = to_regclass('public.product_pack_components')
      and pg_get_triggerdef(t.oid) ilike '%cost_weight%'
  )
union all
select
  'rpc convert_pack_to_units: una firma de 5 argumentos (p_components al final), security definer, tienda de la sesion, bloqueo ordenado de empaque y componentes, reparto por unidades x cost_weight y huella con la distribucion (20261009d)',
  (
    select count(*) = 1
       and bool_and(pg_get_function_identity_arguments(p.oid)
             = 'p_pack_product_id uuid, p_pack_quantity integer, p_reason text, p_client_request_id uuid, p_components jsonb')
       and bool_and(p.pronargdefaults = 3)
       and bool_and(p.prosecdef)
       and bool_and(p.proconfig @> array['search_path=public'])
       and bool_and(p.prosrc ilike '%v_store_id := public.assert_store_context();%')
       and bool_and(p.prosrc ilike '%from public.product_pack_components%')
       and bool_and(p.prosrc ilike '%v_ids := v_component_ids || v_link.pack_product_id%where id = any(v_ids)%and store_id = v_store_id%order by id%for update%')
       and bool_and(p.prosrc ilike '%v_units[v_index] * v_weights[v_index]%v_shares[v_residual_index] := v_transferred_value - v_allocated%')
       and bool_and(p.prosrc ilike '%''convert_pack_to_units'', p_pack_product_id, p_pack_quantity, p_reason, p_components%')
       and bool_and(p.prosrc ilike '%get diagnostics v_rows = row_count%')
       and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
       and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'convert_pack_to_units'
  )
union all
select
  'rpc create_purchase: el modo empaque lee la receta del modelo de componentes (unidad = componente unico de alguna receta activa; empaque = total_units) (20261009d)',
  (
    select count(*) = 1
       and bool_and(p.prosrc ilike '%from public.product_pack_components pc%pc.units_per_pack = c.total_units%v_units_per_pack = any(v_unit_pack_sizes)%select c.total_units into v_pair_units%')
       and bool_and(p.prosrc not ilike '%where c.unit_product_id = v_product_id%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'conversion_mismatches suma las entradas de todos los componentes y exige que cada uno sea de una receta del empaque (20261009d)',
  exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.conversion_mismatches')
      and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
      and pg_get_viewdef(c.oid) ilike '%product_pack_components%unlinked_components%'
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select')
  ) and (
    select array_agg(a.attname::text order by a.attnum)
           = array['conversion_id', 'store_id', 'pack_product_id', 'unit_product_id', 'pack_delta', 'unit_delta',
                   'units_per_pack', 'issue', 'current_units_per_pack']
    from pg_attribute a
    where a.attrelid = to_regclass('public.conversion_mismatches') and a.attnum > 0 and not a.attisdropped
  )
union all
select
  'view product_pack_roles y pack_role(products): rol de empaque por producto con security_invoker, relacion calculada de una fila y sin acceso anon (20261009d)',
  exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.product_pack_roles')
      and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert')
  ) and exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.pack_role(public.products)')
      and not p.prosecdef
      and p.proretset
      and p.prorows = 1
      and p.provolatile = 's'
      and p.prorettype = to_regtype('public.product_pack_roles')
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'supplier_products.is_preferred: boolean not null default false, check "inactivo nunca habitual" e indice unico parcial (product_id) where is_preferred (20261009e)',
  exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = to_regclass('public.supplier_products')
      and a.attname = 'is_preferred'
      and not a.attisdropped
      and a.atttypid = 'boolean'::regtype
      and a.attnotnull
      and pg_get_expr(d.adbin, d.adrelid) = 'false'
  ) and exists (
    select 1
    from pg_constraint c
    where c.conrelid = to_regclass('public.supplier_products')
      and c.conname = 'supplier_products_preferred_active_check'
      and c.contype = 'c'
      and c.convalidated
      and pg_get_constraintdef(c.oid) ilike '%not is_preferred%or is_active%'
  ) and exists (
    select 1
    from pg_index i
    where i.indexrelid = to_regclass('public.uq_supplier_products_preferred')
      and i.indrelid = to_regclass('public.supplier_products')
      and i.indisunique
      and i.indisvalid
      and i.indnkeyatts = 1
      and pg_get_indexdef(i.indexrelid) ilike '%(product_id) where is_preferred'
  )
union all
select
  'supplier_products: triggers del habitual (guard before insert / update / delete, relevo after update / delete solo si la fila era habitual) con funciones security definer no ejecutables por /rpc (20261009e)',
  (
    select count(*) = 2
       and bool_and(t.tgenabled = 'O')
       and bool_and(p.prosecdef and p.proconfig @> array['search_path=public'])
       and bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
       and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
       and bool_or(
         t.tgname = 'trg_supplier_products_preferred_guard'
         and t.tgtype = 31
         and p.oid = to_regprocedure('public.supplier_products_preferred_guard()')
         and p.prosrc ilike '%for no key update%new.is_preferred := false%errcode = ''PT400''%new.is_preferred := true%'
       )
       and bool_or(
         t.tgname = 'trg_supplier_products_preferred_handoff'
         and t.tgtype = 25
         and p.oid = to_regprocedure('public.supplier_products_preferred_handoff()')
         and pg_get_triggerdef(t.oid) ilike '%when (old.is_preferred)%'
         and p.prosrc ilike '%supplier_products_next_preferred(old.product_id)%set is_preferred = true%'
       )
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = to_regclass('public.supplier_products')
      and not t.tgisinternal
      and t.tgname in ('trg_supplier_products_preferred_guard', 'trg_supplier_products_preferred_handoff')
  )
union all
select
  'contacts: trigger trg_contacts_release_preferred_supplier (after update de is_active / type) suelta los habituales del proveedor desactivado; relevo supplier_products_next_preferred interno (20261009e)',
  exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = to_regclass('public.contacts')
      and t.tgname = 'trg_contacts_release_preferred_supplier'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgtype = 17
      and p.oid = to_regprocedure('public.contacts_release_preferred_supplier()')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and p.prosrc ilike '%set is_preferred = false%supplier_products_next_preferred(v_link.product_id)%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  ) and exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.supplier_products_next_preferred(uuid)')
      and p.prosecdef
      and p.proconfig @> array['search_path=public']
      and p.prosrc ilike '%sp.is_active%c.is_active%last_purchased_at desc nulls last, sp.created_at, sp.id%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'rpc save_product_suppliers: una firma (uuid, jsonb), security definer con search_path, tienda de la sesion, admin / almacen (PT403), producto bloqueado (PT404), costo por register_supplier_product_price y solo la ejecutan authenticated / service_role (20261009e)',
  (
    select count(*) = 1
       and bool_and(
         p.oid = to_regprocedure('public.save_product_suppliers(uuid, jsonb)')
         and p.prosecdef
         and p.prorettype = 'jsonb'::regtype
         and not p.proretset
         and p.proconfig @> array['search_path=public']
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%current_user_role()%not in (''admin'', ''almacen'')%errcode = ''PT403''%and c.store_id = v_store_id%and store_id = v_store_id%for update%errcode = ''PT404''%set is_preferred = false%set is_active = false%public.register_supplier_product_price(%'
         and p.prosrc not ilike '%delete from%'
         and p.prosrc not ilike '%update public.products%'
         and p.prosrc not ilike '%current_stock%'
         and p.prosrc not ilike '%into public.stock_movements%'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'save_product_suppliers'
  )
union all
select
  'proveedor habitual: ningun habitual es un vinculo inactivo ni de un proveedor inactivo o que ya no es proveedor (20261009e)',
  not exists (
    select 1
    from public.supplier_products sp
    join public.contacts c on c.id = sp.supplier_id
    where sp.is_preferred
      and (not sp.is_active or not c.is_active or c.type::text not in ('proveedor', 'ambos'))
  )
union all
select
  'price_from_markup (costo al centimo, % a dos decimales, producto exacto) y assert_expected_cost_ref (PT409 con hint COST_CHANGED, interna: no ejecutable por /rpc) (20261009f)',
  exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.price_from_markup(numeric, numeric)')
      and p.provolatile = 'i'
      and p.prosrc ilike '%round(round(p_cost_ref, 2) * (10000 + round(p_markup_pct, 2) * 100) * 0.0001, 2)%'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
  and exists (
    select 1
    from pg_proc p
    where p.oid = to_regprocedure('public.assert_expected_cost_ref(numeric, numeric)')
      and p.prosrc ilike '%round(coalesce(p_current_cost_ref, 0), 2) <> round(p_expected_cost_ref, 2)%errcode = ''PT409''%hint = ''COST_CHANGED''%'
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
  )
union all
select
  'rpc reprice_product_to_markup: una firma (uuid, numeric, text, numeric), security definer con search_path, tienda de la sesion, admin / almacen (PT403), % en (0, 1000], producto bloqueado (PT404), sin costo PT400, costo esperado PT409 y delega en update_product_price (20261009f)',
  (
    select count(*) = 1
       and bool_and(
         p.oid = to_regprocedure('public.reprice_product_to_markup(uuid, numeric, text, numeric)')
         and p.prosecdef
         and p.prorettype = to_regtype('public.products')
         and not p.proretset
         and p.proconfig @> array['search_path=public']
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%assert_finite_numeric(p_markup_pct%not in (''admin'', ''almacen'')%errcode = ''PT403''%p_markup_pct <= 0 or p_markup_pct > 1000%and store_id = v_store_id%for update%errcode = ''PT404''%hint = ''NO_COST''%assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref)%return public.update_product_price(%public.price_from_markup(v_product.current_cost_ref, p_markup_pct)%'
         and p.prosrc not ilike '%update public.products%'
         and p.prosrc not ilike '%insert into%'
         and p.prosrc not ilike '%current_stock%'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'reprice_product_to_markup'
  )
union all
select
  'rpc update_product_price_checked: una firma (uuid, numeric, text, numeric), security definer con search_path, tienda de la sesion, admin / almacen (PT403), producto bloqueado (PT404), costo esperado PT409 y delega en update_product_price (20261009f)',
  (
    select count(*) = 1
       and bool_and(
         p.oid = to_regprocedure('public.update_product_price_checked(uuid, numeric, text, numeric)')
         and p.prosecdef
         and p.prorettype = to_regtype('public.products')
         and not p.proretset
         and p.proconfig @> array['search_path=public']
         and p.prosrc ilike '%v_store_id := public.assert_store_context();%not in (''admin'', ''almacen'')%errcode = ''PT403''%and store_id = v_store_id%for update%errcode = ''PT404''%assert_expected_cost_ref(v_product.current_cost_ref, p_expected_cost_ref)%return public.update_product_price(p_product_id, p_new_sale_price_ref, p_reason)%'
         and p.prosrc not ilike '%update public.products%'
         and p.prosrc not ilike '%insert into%'
         and p.prosrc not ilike '%current_stock%'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
       )
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'update_product_price_checked'
  )
union all
select
  'products.client_request_id (uuid) y client_request_hash (text) opcionales, con indice unico parcial (store_id, client_request_id) where client_request_id is not null (20261009f)',
  (
    select count(*) = 2 and bool_and(c.is_nullable = 'YES' and c.column_default is null)
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'products'
      and ((c.column_name = 'client_request_id' and c.data_type = 'uuid')
        or (c.column_name = 'client_request_hash' and c.data_type = 'text'))
  )
  and exists (
    select 1
    from pg_index i
    where i.indexrelid = to_regclass('public.products_store_client_request_unique')
      and i.indrelid = 'public.products'::regclass
      and i.indisunique
      and i.indisvalid
      and pg_get_indexdef(i.indexrelid) ilike '%(store_id, client_request_id) where (client_request_id is not null)'
  )
union all
select
  'rpc create_purchase: vincula cada linea al proveedor (pedido sin vinculo -> alta con origen vinculacion; vinculo inactivo -> se reactiva), crea el empaque del vinculo nuevo y no escribe is_preferred (20261010a)',
  (
    select count(*) = 1
       and bool_and(p.pronargs = 14 and p.prosecdef)
       and bool_and(p.prosrc ilike '%v_sp_is_new := v_sp_id is null;%if p_status = ''recibido'' then%on conflict (supplier_id, product_id)%''compra'',%elsif v_sp_is_new then%insert into public.supplier_products (%''vinculacion'',%elsif not v_sp_active then%set is_active = true,%')
       and bool_and(p.prosrc ilike '%if v_entry_mode = ''pack''%and v_sp_id = any(v_new_sp_ids)%insert into public.supplier_product_pack_units (%')
       and bool_and(p.prosrc not ilike '%is_preferred%')
       and bool_and(p.prosrc not ilike '%current_stock%')
       and bool_and(p.prosrc ilike '%purchase_idempotent_replay%v_item ->> ''tax_rate_code''%from public.product_pack_components pc%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'rpc create_purchase: proveedor de la tienda leido con for share; inactivo o que no es proveedor / ambos -> PT400 antes de crear la compra, sin assert_contact_type (20261010a)',
  (
    select count(*) = 1
       and bool_and(p.prosrc ilike '%from public.contacts c%and c.store_id = v_store_id%for share;%errcode = ''PT400''%if not v_supplier_active then%errcode = ''PT400''%v_supplier_type::text not in (''proveedor'', ''ambos'')%errcode = ''PT400''%insert into public.purchases (%')
       and bool_and(p.prosrc not ilike '%assert_contact_type(%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'rpc create_purchase: producto inactivo en cualquier linea (recibida o pedido) -> PT400 nombrando el producto, comprobado despues de bloquear los productos (order by id for update) y antes de insertar lineas (20261010b)',
  (
    select count(*) = 1
       and bool_and(p.pronargs = 14 and p.prosecdef)
       and bool_and(p.prosrc ilike '%insert into public.purchases (%where id = any(v_product_ids)%order by id%for update;%where p.id = any(v_product_ids)%and p.store_id = v_store_id%and p.is_active is not true;%if v_inactive_count = 1 then%errcode = ''PT400''%elsif v_inactive_count > 1 then%errcode = ''PT400''%insert into public.purchase_items (%')
       and bool_and(p.prosrc ilike '%purchase_idempotent_replay%where p.id = any(v_product_ids)%')
       and bool_and(p.prosrc ilike '%v_sp_is_new := v_sp_id is null;%')
       and bool_and(p.prosrc not ilike '%current_stock%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'payments: los pagos de compras (purchase_id no nulo) solo los leen admin y contador; los de ventas, toda la tienda; una sola politica de lectura (20261010c)',
  (
    select count(*) = 1
       and bool_and(pol.policyname = 'Authenticated users read payments')
       and bool_and(pol.roles = '{authenticated}'::name[])
       and bool_and(pol.qual ilike '%store_id = current_user_store_id()%purchase_id is null%current_user_role()%admin%contador%')
       and bool_and(pol.qual not ilike '%vendedor%' and pol.qual not ilike '%almacen%')
    from pg_policies pol
    where pol.schemaname = 'public'
      and pol.tablename = 'payments'
      and pol.cmd in ('SELECT', 'ALL')
  )
union all
select
  'purchase_items.disassemble_on_receive (boolean not null default false) y disassembled_conversion_id (uuid null); purchases.receive_client_request_id / receive_request_hash (20261010d)',
  (
    select count(*) = 4
       and bool_and(case c.column_name
             when 'disassemble_on_receive' then c.data_type = 'boolean' and c.is_nullable = 'NO' and c.column_default = 'false'
             when 'disassembled_conversion_id' then c.data_type = 'uuid' and c.is_nullable = 'YES'
             when 'receive_client_request_id' then c.data_type = 'uuid' and c.is_nullable = 'YES'
             else c.data_type = 'text' and c.is_nullable = 'YES'
           end)
    from information_schema.columns c
    where c.table_schema = 'public'
      and (
        (c.table_name = 'purchase_items' and c.column_name in ('disassemble_on_receive', 'disassembled_conversion_id'))
        or (c.table_name = 'purchases' and c.column_name in ('receive_client_request_id', 'receive_request_hash'))
      )
  )
union all
select
  'rpc create_purchase: guarda la marca disassemble_on_receive, exige receta activa (PT400), bloquea recetas y componentes antes que los productos y abre los empaques de la compra recibida con purchase_disassemble_lines (20261010d)',
  (
    select count(*) = 1
       and bool_and(p.pronargs = 14 and p.prosecdef)
       and bool_and(p.prosrc ilike '%jsonb_typeof(v_item -> ''disassemble_on_receive'') is distinct from ''boolean''%errcode = ''PT400''%insert into public.purchases (%perform public.purchase_disassemble_lock(v_store_id, v_disassemble_ids, v_product_ids);%where id = any(v_product_ids)%order by id%for update;%and p.is_active is not true;%public.purchase_disassemble_missing_recipes(v_store_id, v_disassemble_ids)%errcode = ''PT400''%insert into public.purchase_items (%disassemble_on_receive%total_ves = v_total_ves%if p_status = ''recibido'' and v_disassemble_ids is not null then%perform public.purchase_disassemble_lines(v_purchase.id, null);%return v_purchase;%')
       and bool_and(p.prosrc ilike '%purchase_idempotent_replay%perform public.purchase_disassemble_lock(%')
       and bool_and(p.prosrc ilike '%v_sp_is_new := v_sp_id is null;%')
       and bool_and(p.prosrc not ilike '%current_stock%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'create_purchase'
  )
union all
select
  'rpc receive_purchase_and_disassemble(uuid, jsonb, uuid): security definer, assert_store_context, documento for update -> purchase_disassemble_lock -> receive_purchase -> purchase_disassemble_lines; solo authenticated / service_role (20261010d)',
  (
    select count(*) = 1
       and bool_and(p.prosecdef and p.pronargs = 3)
       and bool_and(coalesce(p.proconfig @> array['search_path=public'], false))
       and bool_and(pg_get_function_identity_arguments(p.oid) = 'p_purchase_id uuid, p_disassemble jsonb, p_client_request_id uuid')
       and bool_and(p.prosrc ilike '%v_store_id := public.assert_store_context();%errcode = ''PT403''%from public.purchases%for update;%errcode = ''PT404''%receive_client_request_id = p_client_request_id%errcode = ''PT409''%perform public.purchase_disassemble_lock(v_store_id, v_pack_ids, v_product_ids);%errcode = ''PT409''%v_purchase := public.receive_purchase(p_purchase_id);%perform public.purchase_disassemble_lines(p_purchase_id, p_disassemble);%')
       and bool_and(p.prosrc not ilike '%current_stock%' and p.prosrc not ilike '%insert into public.stock_movements%')
       and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
       and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'receive_purchase_and_disassemble'
  )
union all
select
  'funciones internas del desarme (purchase_disassemble_lines / _lock / _missing_recipes / _request_id): sin execute para anon ni authenticated; _lines invoca convert_pack_to_units con la clave de la linea y no inserta movimientos; _lock bloquea recetas y luego productos por id (20261010d)',
  (
    select count(*) = 4
       and bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
       and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
       and bool_and(p.prosrc not ilike '%current_stock%' and p.prosrc not ilike '%insert into public.stock_movements%')
       and bool_and(p.proname <> 'purchase_disassemble_lines'
             or p.prosrc ilike '%public.assert_store_context()%and disassemble_on_receive%and disassembled_conversion_id is null%order by product_id, id%public.convert_pack_to_units(%public.purchase_disassemble_request_id(v_item.id)%set disassembled_conversion_id =%')
       and bool_and(p.proname <> 'purchase_disassemble_lock'
             or p.prosrc ilike '%from public.product_pack_conversions c%order by c.id%for update;%from public.products%order by id%for update;%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('purchase_disassemble_lines', 'purchase_disassemble_lock', 'purchase_disassemble_missing_recipes', 'purchase_disassemble_request_id')
  )
union all
select
  'receive_purchase y convert_pack_to_units siguen en sus versiones (20261006c y 20261009d): una firma cada una, 1 y 5 argumentos (20261010d no las redefine)',
  (
    select count(*) = 2
       and bool_and(case p.proname when 'receive_purchase' then p.pronargs = 1 else p.pronargs = 5 end)
       and bool_and(p.prosrc not ilike '%disassemble%')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('receive_purchase', 'convert_pack_to_units')
  )
union all
select
  'product_pack_conversions.always_disassemble_on_receive (boolean not null default false): preferencia de la receta; ninguna funcion de public la nombra salvo save_pack_recipe, que la guarda desde 20261012a (20261010e)',
  (
    select count(*) = 1
       and bool_and(c.data_type = 'boolean' and c.is_nullable = 'NO' and c.column_default = 'false')
       and not exists (
         select 1
         from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname <> 'save_pack_recipe'
           and p.prosrc ilike '%always_disassemble_on_receive%'
       )
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'product_pack_conversions'
      and c.column_name = 'always_disassemble_on_receive'
  )
union all
select
  'trigger purchases_received_disassemble_guard: constraint trigger diferido (after insert or update of status, when status = recibido) sobre purchases; su funcion es security definer, responde PT409 si queda una linea marcada sin desarmar y solo lee (20261010f)',
  (
    select count(*) = 1
       and bool_and(t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred)
       -- 21 = por fila (1) + insert (4) + update (16), after.
       and bool_and(t.tgtype = 21 and t.tgenabled = 'O' and t.tgqual is not null)
       and bool_and(t.tgattr::text = (
             select a.attnum::text
             from pg_attribute a
             where a.attrelid = 'public.purchases'::regclass and a.attname = 'status'
           ))
       and bool_and(p.prosecdef and coalesce(p.proconfig @> array['search_path=public'], false))
       and bool_and(p.prosrc ilike '%from public.purchases p%join public.purchase_items i on i.purchase_id = p.id%p.status = ''recibido''%i.disassemble_on_receive%i.disassembled_conversion_id is null%errcode = ''PT409''%')
       and bool_and(p.prosrc not ilike '%current_stock%' and p.prosrc not ilike '%insert into%' and p.prosrc not ilike '%update public.%' and p.prosrc not ilike '%delete from%')
       and bool_and(not has_function_privilege('authenticated', p.oid, 'execute'))
       and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.purchases'::regclass
      and t.tgname = 'purchases_received_disassemble_guard'
      and not t.tgisinternal
  )
union all
select
  'vista inventory_overview: security_invoker, una fila por producto con entries_30d / exits_30d / last_movement_at / last_movement_type / stock_status, select solo para authenticated / service_role e indice idx_stock_movements_product_seq (product_id, seq desc) (20261011a)',
  exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.inventory_overview')
      and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
      and has_table_privilege('authenticated', c.oid, 'select')
      and has_table_privilege('service_role', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert, update, delete')
  )
  and (
    select count(*) = 17
    from information_schema.columns col
    where col.table_schema = 'public' and col.table_name = 'inventory_overview'
      and col.column_name in (
        'id', 'store_id', 'category_id', 'sku', 'barcode', 'name', 'sale_price_ref', 'current_cost_ref',
        'current_stock', 'min_stock', 'image_url', 'is_active', 'entries_30d', 'exits_30d',
        'last_movement_at', 'last_movement_type', 'stock_status'
      )
  )
  and exists (
    select 1
    from pg_index i
    where i.indexrelid = to_regclass('public.idx_stock_movements_product_seq')
      and i.indrelid = 'public.stock_movements'::regclass
      and i.indisvalid
      and pg_get_indexdef(i.indexrelid) ilike '%(product_id, seq desc)'
  )
union all
select
  'adjust_stock rechaza la entrada libre a un producto inactivo (PT409), deja pasar las salidas y la devolucion de cliente ligada a su venta, y sigue con una sola firma de 7 argumentos (20261011b)',
  exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'adjust_stock'
      and p.prosecdef
      and p.prosrc ilike '%not v_product.is_active and p_quantity_delta > 0 and p_sale_id is null%'
      and p.prosrc ilike '%El producto esta inactivo: reactivalo antes de registrar una entrada de stock%'
      -- Lo que no cambia: R4, clave de idempotencia y stock por movimiento.
      and p.prosrc ilike '%v_type = ''devolucion_cliente'' and p_sale_id is null%'
      and p.prosrc ilike '%stock_request_replay%'
      and p.prosrc ilike '%insert into public.stock_movements%'
  )
  and (
    select count(*) = 1
      and bool_and(pg_get_function_identity_arguments(p.oid)
        = 'p_product_id uuid, p_quantity_delta integer, p_reason text, p_type stock_movement_type, p_client_request_id uuid, p_sale_id uuid, p_purchase_id uuid')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'adjust_stock'
  )
union all
select
  'save_pack_recipe guarda la receta de un empaque en una transaccion: security definer, una sola firma (la de 6 argumentos de 20261012a; la de 5 de 20261011c ya no existe), bloqueo ordenado de productos, regla de cadenas en los dos sentidos y execute solo para authenticated / service_role (20261011c)',
  (
    select count(*) = 1
      and bool_and(p.prosecdef)
      and bool_and(pg_get_function_identity_arguments(p.oid)
        = 'p_pack_product_id uuid, p_enabled boolean, p_total_units integer, p_label text, p_components jsonb, p_always_disassemble_on_receive boolean')
      and bool_and(p.proconfig @> array['search_path=public'])
      and bool_and(p.prosrc ilike '%assert_store_context()%')
      and bool_and(p.prosrc ilike '%where id = any(v_lock_ids)%order by id%for update%')
      and bool_and(p.prosrc ilike '%es un empaque con receta activa: no puede salir de otro empaque%')
      and bool_and(p.prosrc ilike '%no puede ser a la vez un empaque%')
      and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
      and bool_and(has_function_privilege('service_role', p.oid, 'execute'))
      and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe'
  )
union all
select
  'la receta de un empaque solo se escribe por save_pack_recipe: authenticated solo tiene select sobre product_pack_conversions y product_pack_components, y anon y public ningun privilegio (20261011d)',
  (
    select count(*) = 2
      and bool_and(has_table_privilege('authenticated', t.oid, 'select'))
      and bool_and(not has_table_privilege('authenticated', t.oid, 'insert, update, delete, truncate, references, trigger'))
      and bool_and(not has_table_privilege('anon', t.oid, 'select, insert, update, delete, truncate, references, trigger'))
      and bool_and(not has_table_privilege('public', t.oid, 'select, insert, update, delete, truncate, references, trigger'))
    from pg_class t
    where t.relnamespace = 'public'::regnamespace
      and t.relname in ('product_pack_conversions', 'product_pack_components')
  )
union all
select
  'tras 20261011d la receta conserva su camino de escritura y su RLS: service_role y el dueno de save_pack_recipe (security definer) escriben las dos tablas, que siguen con RLS activa y su politica de lectura (20261011d)',
  (
    select count(*) = 2
      and bool_and(has_table_privilege('service_role', t.oid, 'select'))
      and bool_and(has_table_privilege('service_role', t.oid, 'insert'))
      and bool_and(has_table_privilege('service_role', t.oid, 'update'))
      and bool_and(has_table_privilege('service_role', t.oid, 'delete'))
      and bool_and(t.relrowsecurity)
      and bool_and(exists (
        select 1 from pg_policies pol
        where pol.schemaname = 'public' and pol.tablename = t.relname and pol.cmd = 'SELECT'
      ))
    from pg_class t
    where t.relnamespace = 'public'::regnamespace
      and t.relname in ('product_pack_conversions', 'product_pack_components')
  )
  and (
    select count(*) = 1
      and bool_and(p.prosecdef)
      and bool_and(has_table_privilege(p.proowner, 'public.product_pack_conversions', 'insert'))
      and bool_and(has_table_privilege(p.proowner, 'public.product_pack_conversions', 'update'))
      and bool_and(has_table_privilege(p.proowner, 'public.product_pack_components', 'insert'))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe'
  )
union all
select
  'save_pack_recipe guarda la preferencia always_disassemble_on_receive: sexto argumento boolean con default null (null = no cambia; la receta que reemplaza a otra hereda la de la anterior), la escribe en los tres caminos (misma receta, edicion en sitio, alta / reemplazo) y la devuelve en el resultado (20261012a)',
  (
    select count(*) = 1
      and bool_and(p.pronargs = 6 and p.pronargdefaults = 4)
      and bool_and(p.proargnames[6] = 'p_always_disassemble_on_receive')
      and bool_and(p.proargtypes[5] = 'boolean'::regtype)
      and bool_and(p.prosecdef and p.proconfig @> array['search_path=public'])
      and bool_and(p.prosrc ilike '%v_always := coalesce(p_always_disassemble_on_receive, v_existing.always_disassemble_on_receive, false);%')
      and bool_and(p.prosrc ilike '%if v_existing.always_disassemble_on_receive is distinct from v_always then%set always_disassemble_on_receive = v_always%')
      and bool_and(p.prosrc ilike '%units_per_pack = p_total_units,%always_disassemble_on_receive = v_always%')
      and bool_and(p.prosrc ilike '%values (v_store_id, p_pack_product_id, p_total_units, v_label, true, v_always)%')
      and bool_and(p.prosrc ilike '%''alwaysDisassembleOnReceive'', v_always%')
      and bool_and(p.prosrc ilike '%where id = any(v_lock_ids)%order by id%for update%')
      and bool_and(p.prosrc not ilike '%current_stock%' and p.prosrc not ilike '%stock_movements%')
      and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
      and bool_and(not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'save_pack_recipe'
  )
union all
select
  'view products_price_review atribuye a la compra el costo de los componentes de un empaque desarmado en su recepcion: enlaza la conversion_entrada con purchase_items.disassembled_conversion_id, sigue con security_invoker y sin escritura ni lectura para anon (20261012b)',
  exists (
    select 1
    from pg_class c
    where c.oid = to_regclass('public.products_price_review')
      and c.relkind = 'v'
      and c.reloptions @> array['security_invoker=true']
      and pg_get_viewdef(c.oid) ilike '%coalesce(sm.purchase_id, d.purchase_id)%conversion_entrada%pi.disassembled_conversion_id = sm.conversion_id%sm.seq > s.snapshot_seq%order by sm.seq desc%'
      and has_table_privilege('authenticated', c.oid, 'select')
      and has_table_privilege('service_role', c.oid, 'select')
      and not has_table_privilege('anon', c.oid, 'select')
      and not has_table_privilege('authenticated', c.oid, 'insert')
  )
union all
select
  'purchase_items: indice parcial por disassembled_conversion_id para enlazar un desarme con su compra (20261012b)',
  exists (
    select 1
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = to_regclass('public.purchase_items')
      and ic.relname = 'idx_purchase_items_disassembled_conversion'
      and i.indisvalid
      and i.indpred is not null
      and pg_get_indexdef(i.indexrelid) ilike '%(disassembled_conversion_id)%where%disassembled_conversion_id is not null%'
  )
order by 1;
