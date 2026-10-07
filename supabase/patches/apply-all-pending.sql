-- =============================================================================
-- Aplicar TODOS los patches pendientes (orden cronologico)
-- Proyecto: BodegaHub
-- Uso: pegar en Supabase Dashboard → SQL Editor → Run
-- Idempotente: se puede re-ejecutar sin romper datos existentes.
-- Ver: docs/supabase-setup.md (seccion patches)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 20260705 — precio de empaque en supplier_products + RPC
-- -----------------------------------------------------------------------------
alter table public.supplier_products
  add column if not exists last_pack_cost_ref numeric(12,2)
  check (last_pack_cost_ref is null or last_pack_cost_ref >= 0);

drop function if exists public.register_supplier_product_price(uuid, numeric, numeric, text, text);

create or replace function public.register_supplier_product_price(
  p_supplier_product_id uuid,
  p_new_cost_ref numeric,
  p_new_cost_ves numeric,
  p_origin text,
  p_notes text default null,
  p_new_pack_cost_ref numeric default null,
  p_price_input_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp public.supplier_products;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_variation_percent numeric(8,2);
  v_history_id uuid;
begin
  if public.current_user_role() not in ('admin', 'almacen') then
    raise exception 'No autorizado para registrar precios de proveedor';
  end if;

  if p_new_cost_ref is null or p_new_cost_ref < 0 then
    raise exception 'El costo no puede ser negativo';
  end if;

  if p_origin not in ('cotizacion', 'compra', 'ajuste', 'vinculacion') then
    raise exception 'Origen de precio invalido';
  end if;

  if p_price_input_mode is not null and p_price_input_mode not in ('unit', 'pack') then
    raise exception 'Modo de precio invalido';
  end if;

  if p_price_input_mode = 'pack' and (p_new_pack_cost_ref is null or p_new_pack_cost_ref < 0) then
    raise exception 'Indica un precio de empaque valido';
  end if;

  select * into v_sp
  from public.supplier_products
  where id = p_supplier_product_id
  for update;

  if not found then
    raise exception 'Relacion proveedor-producto no encontrada';
  end if;

  if not v_sp.is_active then
    raise exception 'No se puede registrar precio en una relacion inactiva';
  end if;

  v_old_cost_ref := v_sp.last_cost_ref;
  v_old_cost_ves := v_sp.last_cost_ves;

  v_history_id := public.append_supplier_product_price_history(
    p_supplier_product_id,
    v_old_cost_ref,
    v_old_cost_ves,
    p_new_cost_ref,
    p_new_cost_ves,
    p_origin,
    p_notes
  );

  update public.supplier_products
  set last_cost_ref = p_new_cost_ref,
      last_cost_ves = p_new_cost_ves,
      last_pack_cost_ref = case
        when p_price_input_mode = 'pack' then p_new_pack_cost_ref
        when p_price_input_mode = 'unit' then null
        else last_pack_cost_ref
      end,
      last_purchased_at = case when p_origin = 'compra' then now() else last_purchased_at end,
      updated_at = now()
  where id = p_supplier_product_id
  returning * into v_sp;

  if v_old_cost_ref is not null and v_old_cost_ref > 0 then
    v_variation_percent := round(((p_new_cost_ref - v_old_cost_ref) / v_old_cost_ref) * 100, 2);
  else
    v_variation_percent := null;
  end if;

  return jsonb_build_object(
    'supplier_product', to_jsonb(v_sp),
    'variation_percent', v_variation_percent,
    'history_id', v_history_id
  );
end;
$$;

grant execute on function public.register_supplier_product_price(uuid, numeric, numeric, text, text, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 20260706 — codigo de barras en products
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists barcode text;

create unique index if not exists products_barcode_unique
  on public.products (barcode)
  where barcode is not null and trim(barcode) <> '';

-- -----------------------------------------------------------------------------
-- 20260707 — bucket Storage imagenes de productos
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  524288,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

notify pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- 20260716 — multitienda (stores + store_id + superadmin)
-- -----------------------------------------------------------------------------
-- Ejecutar por separado, en este orden (cada uno en su propio Run):
--   1) supabase/patches/20260716a-user-role-superadmin.sql  (enum; va ANTES
--      aunque el sufijo "a" lo ordene despues por nombre)
--   2) supabase/patches/20260716-multi-store.sql
--   3) supabase/patches/20260716b-multi-store-views.sql
-- (demasiado largo para incrustar aqui; el SQL Editor de Supabase no soporta \i)

-- -----------------------------------------------------------------------------
-- 20260717 — metodos de pago habilitados por tienda
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260717-enabled-payment-methods.sql

-- -----------------------------------------------------------------------------
-- 20260809 — impuesto (%) por categoria
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260809-category-tax-rate.sql

-- -----------------------------------------------------------------------------
-- 20260810 — RPCs con store_id (create_purchase/sale, pagos, receive/cancel/return)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260810-rpc-store-context.sql
-- Requiere multitienda (assert_store_context + columnas store_id).
-- -----------------------------------------------------------------------------
-- 20260810b — campos VES + tax snapshot en compras
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260810b-purchase-ves-fields.sql
-- Requiere 20260810-rpc-store-context.sql
-- -----------------------------------------------------------------------------
-- 20260810c — create_purchase confia en REF+VES del frontend
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260810c-purchase-trust-frontend.sql
-- Requiere 20260810b-purchase-ves-fields.sql
-- -----------------------------------------------------------------------------
-- 20260810d — saldo compras en REF (paid_ref)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260810d-purchase-paid-ref.sql
-- Luego (opcional one-shot): supabase/patches/20260810d-fix-existing-purchase-payment.sql
-- Requiere 20260810-rpc-store-context.sql
-- -----------------------------------------------------------------------------
-- 20260811 — conversión empaque → unidad (dual SKU)
-- -----------------------------------------------------------------------------
-- Primero (Run aparte): supabase/patches/20260811a-stock-movement-conversion-enum.sql
-- Luego: supabase/patches/20260811-pack-unit-conversion.sql
-- Requiere 20260716-multi-store.sql (stores, assert_store_context)
-- -----------------------------------------------------------------------------
-- 20260812d — cliente POS default por tienda
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260812d-pos-default-customer.sql
-- -----------------------------------------------------------------------------
-- 20260813 — agregar barcode sin editar producto (vendedor/cajero)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260813-add-product-barcode.sql
-- -----------------------------------------------------------------------------
-- 20260813b — costo producto = unitario con IVA de la linea de compra
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260813b-product-cost-with-line-tax.sql
-- -----------------------------------------------------------------------------
-- 20260813c — one-shot backfill costos producto con IVA de ultima compra
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional, una vez): supabase/patches/20260813c-one-shot-backfill-product-cost-with-line-tax.sql
-- -----------------------------------------------------------------------------
-- 20260813d — one-shot split jabo-harm → 3 variantes (24 stock c/u)
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260813d-one-shot-split-jabo-harm-variants.sql
-- -----------------------------------------------------------------------------
-- 20260813e — one-shot corrige qty shampoo en compra C-20260810155452483
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260813e-one-shot-fix-shampoo-pack-qty.sql
-- -----------------------------------------------------------------------------
-- 20260813f — one-shot transfer 12u shampoo a variante suav-mane-ro
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260813f-one-shot-transfer-shampoo-suav-mane-ro.sql
-- -----------------------------------------------------------------------------
-- 20260813g — one-shot vault Mercaseu C-20260814011924874 (deposito efectivo)
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260813g-one-shot-backfill-vault-mercaseu-purchase.sql
-- -----------------------------------------------------------------------------
-- 20260813h — fix adjust_stock store_id
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260813h-fix-adjust-stock-store-id.sql
-- -----------------------------------------------------------------------------
-- 20260815 — one-shot vault Mercaseu C-20260814214845696 (deposito efectivo)
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260815-one-shot-backfill-vault-mercaseu-C-20260814214845696.sql
-- -----------------------------------------------------------------------------
-- 20260815b — one-shot vault Delilicor C-20260815204121850 (deposito efectivo)
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260815b-one-shot-backfill-vault-delilicor-purchase.sql
-- -----------------------------------------------------------------------------
-- 20260815c — one-shot transfer mitad malta manzana verde
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260815c-one-shot-transfer-malta-manz-verd.sql
-- -----------------------------------------------------------------------------
-- 20260819 — tope de apertura de caja (medianoche Caracas + 24 h)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20260819-cash-session-auto-close.sql
-- -----------------------------------------------------------------------------
-- 20260819b — one-shot: corregir cierre cab7b096 (omitio fondo apertura)
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260819b-fix-cash-close-cab7b096.sql
-- -----------------------------------------------------------------------------
-- 20260821 — one-shot: compra C-20260821230623761 puff-mora → puff-azul
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260821-one-shot-fix-purchase-puff-product.sql
-- -----------------------------------------------------------------------------
-- 20260821b — one-shot: transferir efectivo dia 20-ago (cierre 0e06be09) al baul
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260821b-one-shot-transfer-yesterday-cash-to-vault.sql
-- -----------------------------------------------------------------------------
-- 20260821c — one-shot: completar efectivo ventas acumulado hasta 20-ago al baul
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260821c-one-shot-backfill-cash-sales-thru-yesterday-vault.sql
-- -----------------------------------------------------------------------------
-- 20260824 — one-shot: transferir efectivo VES caja hasta 24-ago 00:35 Caracas
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260824-one-shot-transfer-cash-thru-240835-vault.sql
-- -----------------------------------------------------------------------------
-- 20260828 — one-shot: corrige pago mixto USD+VES venta V-20260828013116483
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260828-one-shot-fix-sale-mixed-usd-ves-payment.sql
-- -----------------------------------------------------------------------------
-- 20260830 — one-shot: cancelar 6 ventas pendiente_pago sin pago (SOLO sales)
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260830-one-shot-cancel-unpaid-pendiente-pago-sales.sql
-- NO toca compras. Equivalente a cancel_sale: status cancelada + restock ajuste_entrada.
-- -----------------------------------------------------------------------------
-- 20260830b — one-shot: remueve 1u cerv-pola-ligh-lata-250m de V-20260829180857754
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260830b-one-shot-remove-sale-pola-ligh-unit.sql
-- Ajusta pago_movil + cash account_in + vault sale_in cuenta; stock → 1.
-- -----------------------------------------------------------------------------
-- 20260830b — one-shot: +1 Polar (cerv-pola-lata-250m) en V-20260830152541402
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260830b-one-shot-add-polar-unit-sale-V-20260830152541402.sql
-- NO toca Polar Light ni compras. Marker FIX_ADD_POLAR:V-20260830152541402.
-- -----------------------------------------------------------------------------
-- 20260830c — one-shot: swap just-dura-400-ml → just-manz-15-lt en V-20260830152541402
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260830c-one-shot-swap-justy-dura-to-manz-sale-V-20260830152541402.sql
-- Preserva Polar 9 + snacks. Restock dura + venta manzana. Marker FIX_SWAP_JUSTY:V-20260830152541402.
-- -----------------------------------------------------------------------------
-- 20260830d — one-shot: +1 plat-tom-80gr en V-20260830152541402
-- -----------------------------------------------------------------------------
-- Ejecutar (opcional; ya aplicado en prod si corriste el script): supabase/patches/20260830d-one-shot-add-plat-tom-sale-V-20260830152541402.sql
-- Inserta linea Platanitos Tom ×1; ajusta pago_movil + vault. Marker FIX_ADD_PLAT_TOM:V-20260830152541402.
-- -----------------------------------------------------------------------------
-- 20261005 — stock integrity views: 9 vistas de invariantes de inventario + rpc stock_integrity_report
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261005-stock-integrity-views.sql
-- Idempotente. Oraculo: select public.stock_integrity_report() debe devolver las 9 claves en 0.
-- -----------------------------------------------------------------------------
-- 20261006a — stock ledger guards: stock_movements.seq + trigger stock_movements_apply, guardas de current_stock (C2),
--             perfiles inactivos (C9), escrituras solo por RPC (C17), vistas security_invoker (C18), anon sin execute
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006a-stock-ledger-guards.sql
-- Idempotente, una transaccion. Las RPC de stock vigentes siguen funcionando (modo legado) hasta los parches b/c.
-- OJO: desde este parche un INSERT de products con current_stock > 0 por PostgREST devuelve PT400 (ver STK-508).
-- -----------------------------------------------------------------------------
-- 20261006b — sales rpc hardening: create_sale (9 args, drop de la de 8), create_sale_with_payments, cancel_sale,
--             return_sale, register_payment y cancel_payment en modo estricto del libro (C4, C7, C8, C10, C11, C15, C19)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006b-sales-rpc-hardening.sql
-- Requiere 20261006a y 20260909. Idempotente, una transaccion. Anade sales.client_request_hash y la secuencia
-- sales_invoice_seq (las facturas nuevas salen como V-YYYYMMDD-NNNNNN).
-- OJO: return_sale ahora anula los pagos activos de la venta; si el cierre de caja de un cobro ya fue transferido
-- al baul la devolucion se rechaza (PT409) igual que cancel_payment.
-- -----------------------------------------------------------------------------
-- 20261006c — purchases + inventory rpc hardening: create_purchase (14 args, drop de la de 13), receive_purchase,
--             cancel_purchase, return_purchase, adjust_stock (7 args, drop de la de 4), convert_pack_to_units (4 args,
--             drop de la de 3) en modo estricto del libro y register_payment (C6, C8 compras, C11, C12, C13, C14, C15)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006c-purchases-inventory-rpc-hardening.sql
-- Requiere 20261006a y 20261006b. Idempotente, una transaccion. Anade purchases.client_request_id/_hash, la tabla
-- stock_request_keys (claves de ajustes y conversiones) y la secuencia purchases_number_seq (las compras nuevas salen
-- como C-YYYYMMDD-NNNNNN).
-- OJO: las tres firmas nuevas solo anaden parametros opcionales al final; el BFF vigente las sigue llamando igual.
-- return_purchase ya no acepta compras en pedido (PT409) y una linea en modo empaque sobre el SKU empaque de un par
-- ingresa pack_count empaques (se guarda como linea en modo unidad al costo del empaque).
-- -----------------------------------------------------------------------------
-- 20261006d — stock integrity views v2 (C16): stock_chain_breaks por seq, documentos mutados en
--             movements_without_document / reversal_mismatches, conversion_mismatches contra la propia conversion
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006d-stock-integrity-views-v2.sql
-- Requiere 20261005 y 20261006a. Idempotente, una transaccion. Siguen siendo 9 vistas (mismos nombres, columnas nuevas
-- solo al final) y stock_integrity_report no cambia. Quita a anon el acceso a las 9 vistas.
-- OJO: en una base con historia pueden aparecer filas nuevas (documentos editados a mano por one-shots): revisar
-- movements_without_document.issue y reversal_mismatches.issue antes de darlas por descuadre de stock.
-- -----------------------------------------------------------------------------
-- 20261006e — stock ledger strict: stock_movements_apply sin modo legado (ignora el stock_after del llamador) y
--             products_stock_guard sin el pase de funciones security definer
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006e-stock-ledger-strict.sql
-- Requiere 20261006a, b y c APLICADOS ANTES (con una RPC de stock antigua viva, sus ventas/compras fallarian con PT409).
-- Idempotente, una transaccion. Reaplicar 20261006a reinstala el modo legado: volver a aplicar este parche despues.
-- OJO one-shots por SQL Editor: insertar en stock_movements YA mueve products.current_stock (no hacer ademas el update
-- a mano) y el stock_after escrito a mano se descarta.
-- -----------------------------------------------------------------------------
-- 20261006f — rpc review fixes (STK-516): cancel_sale repone vendido - ya devuelto (R1), record_cash_close_difference
--             con guardas y sin execute por /rpc (R2), cancel_purchase / return_purchase rechazan pagos activos (R3),
--             register_payment bloquea la sesion de caja (R5) y create_sale / create_sale_with_payments /
--             create_purchase validan la entrada (R6)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006f-rpc-review-fixes.sql
-- Requiere 20261006a, b, c y e, y 20260904b. Idempotente, una transaccion. Ninguna firma cambia.
-- Reaplicar 20261006b o 20261006c reinstala las versiones anteriores de esas RPC: volver a aplicar este parche despues.
-- OJO: cancelar o devolver una compra con pagos activos ahora responde PT409 ("Anula primero los pagos…"), igual que
-- cancel_sale. Las compras que YA quedaron cancelado / devuelto con un pago activo no se tocan (revisarlas a mano).
-- auto_close_stale_cash_sessions, ensure_store_vault y record_cash_close_difference dejan de ser ejecutables por
-- authenticated (el cron del BFF usa service_role; las RPC de caja las llaman como propietario).
-- -----------------------------------------------------------------------------
-- 20261006g — rpc review fixes 2 (STK-601): adjust_stock exige el documento en las devoluciones (R4),
--             update_product_price / register_supplier_product_price / deactivate_supplier_product con contexto de
--             tienda, funciones internas sin execute por /rpc (R12), cancel_payment_apply comprueba el baul (R7),
--             stock_movements solo-append por trigger (R11) y cancel_sale / register_payment rechazan borradores (R17)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006g-rpc-review-fixes-2.sql
-- Requiere 20261006a, b, c, e y f, 20260705 y 20260811b. Idempotente, una transaccion. Ninguna firma cambia.
-- Reaplicar 20261006b, c o f reinstala las versiones anteriores de esas RPC: volver a aplicar este parche despues.
-- OJO: un ajuste devolucion_cliente / devolucion_proveedor SIN venta / compra ahora responde PT400 ("Una devolucion de
-- cliente debe indicar la venta a la que corresponde" / "Una devolucion a proveedor debe indicar la compra a la que
-- corresponde"): la UI y el BFF deben enviar saleId / purchaseId o dejar de ofrecer esos tipos como ajuste libre.
-- OJO one-shots: update / delete / truncate sobre stock_movements solo pasan en conexion directa (SQL Editor: postgres);
-- desde una funcion llamada por PostgREST responden PT409. get_open_cash_session_for_user y
-- append_supplier_product_price_history dejan de ser ejecutables por authenticated (assert_contact_type no: el BFF la usa).
-- -----------------------------------------------------------------------------
-- 20261006h — rls store scope + finite guards (STK-615): lineas de venta / compra, historiales de precio y empaques
--             solo se leen y escriben desde su tienda (N1, N2), caja y baul sin escritura por PostgREST (N3), las RPC
--             con numeric de entrada rechazan NaN / Infinity (N4), PT403 en las RPC de precios (N6) y
--             cancel_payment_apply bloquea la sesion de caja abierta antes de F4 (R5c)
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006h-rls-store-scope-and-finite-guards.sql
-- Requiere 20261006a, b, c, e, f y g, 20260716, 20260811b, 20260812c y 20260904b. Idempotente, una transaccion. Ninguna
-- firma cambia. Reaplicar 20261006b, c, f o g, 20260904b o 20260812c (o la copia de register_supplier_product_price de
-- este mismo archivo) reinstala las versiones anteriores de esas RPC: volver a aplicar este parche despues.
-- OJO: store_vaults, vault_movements, cash_movements y cash_sessions dejan de aceptar insert / update / delete por
-- PostgREST con la sesion de un usuario (42501): todo cambio de caja o baul pasa por las RPC. Los one-shots por SQL
-- Editor (postgres) no cambian. Un NaN / Infinity en un parametro numeric responde PT400 ("Valor numerico invalido en
-- <campo>: debe ser un numero finito"); el rol no autorizado en update_product_price, register_supplier_product_price y
-- deactivate_supplier_product responde PT403 (antes 400). NO se tocan los datos: una fila que ya tenga NaN (ventas,
-- compras, precios) hay que corregirla a mano.
-- -----------------------------------------------------------------------------
-- 20261006i — reject non-finite numeric columns (STK-625): las columnas numeric de public rechazan NaN / Infinity
--             escritos directamente en la tabla (M1, residuo de N4), con dos triggers por tabla y una funcion comun
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261006i-reject-non-finite-numeric-columns.sql
-- Requiere 20261006h (mismo texto de error). Idempotente, una transaccion. No redefine ninguna RPC, no anade
-- constraints y no toca filas. Funciona igual en PostgreSQL 13 (no usa 'Infinity'::numeric).
-- OJO: un insert / update que deje NaN o Infinity en una columna numeric responde PT400 ("Valor numerico invalido en
-- <columna>: debe ser un numero finito"), tambien por SQL Editor (postgres) y dentro de las RPC. Una fila que YA tenga
-- NaN sigue siendo editable y hay que corregirla a mano (solo se rechaza la columna que cambia a un valor no finito).
-- OJO: para borrar o cambiar de tipo una columna numeric hay que soltar antes los triggers
-- trg_zz_reject_non_finite_numeric_ins / _upd de su tabla; despues de eso, o de anadir una columna numeric nueva,
-- volver a aplicar este parche (regenera los triggers desde el catalogo; verify-patches lo detecta si falta).
-- -----------------------------------------------------------------------------
-- 20261007a — tax rates (SHR-10): catalogo de alicuotas de IVA tax_rates (globales + por tienda; semilla exento 0,
--             reducida 8, general 16), categories.tax_rate_id sincronizada por trigger con tax_rate,
--             app_settings.default_tax_rate_id, purchase_items.tax_rate_code y create_purchase con tax_rate_code por linea
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261007a-tax-rates.sql
-- Requiere 20260716, 20260809 y la serie 20261006a … i completa. Idempotente, una transaccion. La firma de create_purchase
-- no cambia. Reaplicar 20261006c, f o h reinstala el create_purchase anterior: volver a aplicar este parche despues.
-- OJO: migra datos la primera vez (categories.tax_rate_id, app_settings.default_tax_rate_id y purchase_items.tax_rate_code
-- por porcentaje; tax_rate no se toca). Un porcentaje que no sea 0, 8 ni 16 crea en su tienda la alicuota 'otro-<pct>'
-- INACTIVA: revisar despues de aplicar con  select * from public.tax_rates_pending_review;
-- OJO: create_purchase responde PT400 si el tax_rate de una linea no es el pct de una alicuota ACTIVA de la tienda (las
-- compras nuevas de productos cuya categoria quedo en 'otro-<pct>' se rechazan hasta activar esa alicuota o reasignar la
-- categoria), y categories responde PT400 al guardar un tax_rate sin alicuota. Las alicuotas no se borran: se desactivan.
-- -----------------------------------------------------------------------------
-- 20261007b — tax rates store override (SHR-10): RPC override_tax_rate_for_store, unico camino del BFF para cambiar una
--             alicuota (PATCH /api/tax-rates/{id}); crea la fila de la tienda a partir de la global y le traspasa
--             categorias y alicuota por defecto en una sola transaccion
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261007b-tax-rates-store-override.sql
-- Requiere 20261007a. Idempotente, una transaccion. Solo crea la funcion: no migra ni toca filas, stock ni dinero.
-- Solo admin (PT403); PT404 si la alicuota no existe para la tienda; PT409 al desactivar una alicuota que usan
-- categorias activas o que es la alicuota por defecto; PT400 con label vacio o pct fuera de 0..100.
-- -----------------------------------------------------------------------------
-- ORDEN DE DESPLIEGUE (SHR-10): aplicar 20261007a y 20261007b ANTES de desplegar el BFF de la rama feat/ux-mejoras.
-- Ese BFF ya pide las columnas nuevas en sus select (categories.tax_rate_id, app_settings.default_tax_rate_id,
-- purchase_items.tax_rate_code) y llama a tax_rates_for_store y override_tax_rate_for_store: sin los dos parches,
-- categorias, configuracion, detalle de compra y /api/tax-rates responden error. Los parches si son compatibles con el
-- BFF anterior (create_purchase sigue aceptando solo tax_rate), asi que el orden seguro es parches -> verify -> BFF.
-- -----------------------------------------------------------------------------
-- 20261008a — register_payment idempotency (PAG-06a, P4-3): clave opcional p_client_request_id en register_payment
--             (payments.client_request_id + client_request_hash, unica por tienda); el reintento con la misma clave
--             devuelve el pago original sin tocar documento, caja ni baul; otro contenido responde PT409
-- -----------------------------------------------------------------------------
-- Ejecutar: supabase/patches/20261008a-register-payment-idempotency.sql
-- Requiere 20261006c (stock_request_hash) y 20261006h (register_payment vigente). Idempotente, una transaccion. No migra
-- ni toca filas: anade dos columnas nullable y un indice unico parcial a payments. La semantica monetaria no cambia (el
-- cuerpo es copia del de 20261006h); sin clave la RPC se comporta igual y create_sale_with_payments no se toca.
-- OJO: firma nueva de 13 argumentos; el parche elimina la de 12 (PGRST203). Reaplicar 20261006b, c, f, g o h reinstala
-- la de 12 y deja dos sobrecargas: volver a aplicar este parche despues (verify-patches lo detecta).
-- Orden con el BFF: indistinto. El BFF que envia la clave sobre una base sin el parche recibe PGRST202 y registra el
-- pago una vez sin idempotencia (queda en el log); el BFF anterior funciona sobre la base ya parcheada.
