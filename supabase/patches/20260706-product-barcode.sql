-- Patch: código de barras opcional en products
-- Ejecutar en Supabase SQL Editor (proyecto remoto).
-- Ver docs/supabase-setup.md

alter table public.products
  add column if not exists barcode text;

create unique index if not exists products_barcode_unique
  on public.products (barcode)
  where barcode is not null and trim(barcode) <> '';
