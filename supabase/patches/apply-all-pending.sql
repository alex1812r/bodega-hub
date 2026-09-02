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
-- Ejecutar por separado el archivo completo:
--   supabase/patches/20260716-multi-store.sql
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
