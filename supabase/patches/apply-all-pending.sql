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
