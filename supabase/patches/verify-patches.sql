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
        = 'p_pack_product_id uuid, p_pack_quantity integer, p_reason text, p_client_request_id uuid'
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
order by 1;
