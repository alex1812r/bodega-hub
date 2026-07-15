-- Catálogo de investigación de campo — julio 2026
-- Ejecutar en SQL Editor de Supabase después de seed.sql y supabase-schema.sql.
-- Idempotente: UUID fijos; re-ejecutar actualiza nombres, precios y vínculos.
--
-- Interpretación de precios: las cifras anotadas (ej. 5.5 ref) son por CAJA/PAQUETE.
-- last_cost_ref guarda costo UNITARIO = precio_embalaje / unidades_por_embalaje.
-- Empaques predeterminados: bebidas caja 6 und; chucherías paquete 12 und.

begin;

-- =========================
-- Categorías
-- =========================

insert into public.categories (id, name, description, is_active)
values
  (
    'f1111111-1111-4111-8111-111111111111',
    'Bebidas',
    'Refrescos y bebidas gaseosas',
    true
  ),
  (
    'f2222222-2222-4222-8222-222222222222',
    'Chucherias',
    'Snacks, papitas y golosinas',
    true
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active;

-- =========================
-- Proveedores
-- =========================

insert into public.contacts (id, type, name, address, notes, is_active)
values
  (
    'f3333333-3333-4333-8333-333333333333',
    'proveedor',
    'Bodega de bebida',
    'Av. principal El Cementerio, Los Carmenes',
    'Ref entre frente de Ferrera Ferrera. Cotización investigación jul/2026.',
    true
  ),
  (
    'f4444444-4444-4444-8444-444444444444',
    'proveedor',
    'Tienda Congolos',
    'El Cementerio, entrada del centro comercial San Jorge',
    'Cotización investigación jul/2026.',
    true
  )
on conflict (id) do update set
  type = excluded.type,
  name = excluded.name,
  address = excluded.address,
  notes = excluded.notes,
  is_active = excluded.is_active;

-- =========================
-- Productos
-- =========================

insert into public.products (
  id,
  category_id,
  sku,
  name,
  sale_price_ref,
  current_cost_ref,
  current_stock,
  min_stock,
  is_active
)
values
  -- Bebidas — Bodega de bebida
  (
    'f5010001-0001-4001-8001-000000000001',
    'f1111111-1111-4111-8111-111111111111',
    'glup-2lt',
    'Glup 2L',
    0,
    0.92,
    0,
    5,
    true
  ),
  (
    'f5010002-0002-4002-8002-000000000002',
    'f1111111-1111-4111-8111-111111111111',
    'frescolita-1-5lt',
    'Frescolita 1.5L',
    0,
    0.80,
    0,
    5,
    true
  ),
  (
    'f5010003-0003-4003-8003-000000000003',
    'f1111111-1111-4111-8111-111111111111',
    'fanta-2lt',
    'Fanta 2L',
    0,
    0.83,
    0,
    5,
    true
  ),
  (
    'f5010004-0004-4004-8004-000000000004',
    'f1111111-1111-4111-8111-111111111111',
    'coca-cola-2lt',
    'Coca-Cola 2L',
    0,
    1.33,
    0,
    5,
    true
  ),
  (
    'f5010005-0005-4005-8005-000000000005',
    'f1111111-1111-4111-8111-111111111111',
    'coca-cola-1lt',
    'Coca-Cola 1L',
    0,
    0.83,
    0,
    5,
    true
  ),
  (
    'f5010006-0006-4006-8006-000000000006',
    'f1111111-1111-4111-8111-111111111111',
    'coca-cola-1-5lt',
    'Coca-Cola 1.5L',
    0,
    1.08,
    0,
    5,
    true
  ),
  -- Chucherías — Tienda Congolos
  (
    'f6010001-0001-4001-8001-000000000001',
    'f2222222-2222-4222-8222-222222222222',
    'cheestris-50gr',
    'Cheestris 50gr',
    0,
    0.79,
    0,
    5,
    true
  ),
  (
    'f6010002-0002-4002-8002-000000000002',
    'f2222222-2222-4222-8222-222222222222',
    'doritos-45gr',
    'Doritos 45gr',
    0,
    0.91,
    0,
    5,
    true
  ),
  (
    'f6010003-0003-4003-8003-000000000003',
    'f2222222-2222-4222-8222-222222222222',
    'flips-28gr',
    'Flips 28gr',
    0,
    0.63,
    0,
    5,
    true
  ),
  (
    'f6010004-0004-4004-8004-000000000004',
    'f2222222-2222-4222-8222-222222222222',
    'kesitos-25gr',
    'Kesitos 25gr',
    0,
    0.58,
    0,
    5,
    true
  ),
  (
    'f6010005-0005-4005-8005-000000000005',
    'f2222222-2222-4222-8222-222222222222',
    'chiskesitos-45gr',
    'Chiskesitos 45gr',
    0,
    0.71,
    0,
    5,
    true
  ),
  (
    'f6010006-0006-4006-8006-000000000006',
    'f2222222-2222-4222-8222-222222222222',
    'puffy-25gr',
    'Puffy 25gr',
    0,
    0.29,
    0,
    5,
    true
  )
on conflict (id) do update set
  category_id = excluded.category_id,
  sku = excluded.sku,
  name = excluded.name,
  sale_price_ref = excluded.sale_price_ref,
  current_cost_ref = excluded.current_cost_ref,
  is_active = excluded.is_active;

-- =========================
-- Vínculos proveedor ↔ producto
-- pack_price_ref = precio anotado en campo (caja/paquete)
-- =========================

insert into public.supplier_products (
  id,
  supplier_id,
  product_id,
  supplier_sku,
  last_cost_ref,
  notes,
  is_active
)
values
  (
    'f7010001-0001-4001-8001-000000000001',
    'f3333333-3333-4333-8333-333333333333',
    'f5010001-0001-4001-8001-000000000001',
    'glup-2lt',
    0.92,
    '5.50 ref / caja de 6 und',
    true
  ),
  (
    'f7010002-0002-4002-8002-000000000002',
    'f3333333-3333-4333-8333-333333333333',
    'f5010002-0002-4002-8002-000000000002',
    'frescolita-1-5lt',
    0.80,
    '4.80 ref / caja de 6 und',
    true
  ),
  (
    'f7010003-0003-4003-8003-000000000003',
    'f3333333-3333-4333-8333-333333333333',
    'f5010003-0003-4003-8003-000000000003',
    'fanta-2lt',
    0.83,
    '5.00 ref / caja de 6 und',
    true
  ),
  (
    'f7010004-0004-4004-8004-000000000004',
    'f3333333-3333-4333-8333-333333333333',
    'f5010004-0004-4004-8004-000000000004',
    'coca-cola-2lt',
    1.33,
    '8.00 ref / caja de 6 und',
    true
  ),
  (
    'f7010005-0005-4005-8005-000000000005',
    'f3333333-3333-4333-8333-333333333333',
    'f5010005-0005-4005-8005-000000000005',
    'coca-cola-1lt',
    0.83,
    '5.00 ref / caja de 6 und',
    true
  ),
  (
    'f7010006-0006-4006-8006-000000000006',
    'f3333333-3333-4333-8333-333333333333',
    'f5010006-0006-4006-8006-000000000006',
    'coca-cola-1-5lt',
    1.08,
    '6.50 ref / caja de 6 und',
    true
  ),
  (
    'f7010007-0007-4007-8007-000000000007',
    'f4444444-4444-4444-8444-444444444444',
    'f6010001-0001-4001-8001-000000000001',
    'cheestris-50gr',
    0.79,
    '9.50 ref / paquete de 12 und',
    true
  ),
  (
    'f7010008-0008-4008-8008-000000000008',
    'f4444444-4444-4444-8444-444444444444',
    'f6010002-0002-4002-8002-000000000002',
    'doritos-45gr',
    0.91,
    '10.90 ref / paquete de 12 und',
    true
  ),
  (
    'f7010009-0009-4009-8009-000000000009',
    'f4444444-4444-4444-8444-444444444444',
    'f6010003-0003-4003-8003-000000000003',
    'flips-28gr',
    0.63,
    '7.60 ref / paquete de 12 und',
    true
  ),
  (
    'f7010010-0010-4010-8010-000000000010',
    'f4444444-4444-4444-8444-444444444444',
    'f6010004-0004-4004-8004-000000000004',
    'kesitos-25gr',
    0.58,
    '7.00 ref / paquete de 12 und',
    true
  ),
  (
    'f7010011-0011-4011-8011-000000000011',
    'f4444444-4444-4444-8444-444444444444',
    'f6010005-0005-4005-8005-000000000005',
    'chiskesitos-45gr',
    0.71,
    '8.50 ref / paquete de 12 und',
    true
  ),
  (
    'f7010012-0012-4012-8012-000000000012',
    'f4444444-4444-4444-8444-444444444444',
    'f6010006-0006-4006-8006-000000000006',
    'puffy-25gr',
    0.29,
    '3.50 ref / paquete de 12 und',
    true
  )
on conflict (id) do update set
  supplier_id = excluded.supplier_id,
  product_id = excluded.product_id,
  supplier_sku = excluded.supplier_sku,
  last_cost_ref = excluded.last_cost_ref,
  notes = excluded.notes,
  is_active = excluded.is_active;

-- Historial de cotización (solo si aún no hay entrada para este vínculo)
insert into public.supplier_product_price_history (
  supplier_product_id,
  old_cost_ref,
  new_cost_ref,
  origin,
  notes,
  changed_by
)
select
  sp.id,
  null,
  sp.last_cost_ref,
  'cotizacion',
  sp.notes,
  '11111111-1111-4111-8111-111111111111'::uuid
from public.supplier_products sp
where sp.id in (
  'f7010001-0001-4001-8001-000000000001',
  'f7010002-0002-4002-8002-000000000002',
  'f7010003-0003-4003-8003-000000000003',
  'f7010004-0004-4004-8004-000000000004',
  'f7010005-0005-4005-8005-000000000005',
  'f7010006-0006-4006-8006-000000000006',
  'f7010007-0007-4007-8007-000000000007',
  'f7010008-0008-4008-8008-000000000008',
  'f7010009-0009-4009-8009-000000000009',
  'f7010010-0010-4010-8010-000000000010',
  'f7010011-0011-4011-8011-000000000011',
  'f7010012-0012-4012-8012-000000000012'
)
and not exists (
  select 1
  from public.supplier_product_price_history h
  where h.supplier_product_id = sp.id
    and h.origin = 'cotizacion'
);

-- =========================
-- Empaques predeterminados
-- =========================

insert into public.supplier_product_pack_units (
  id,
  supplier_product_id,
  label,
  units_per_pack,
  is_default,
  is_active
)
values
  ('f8010001-0001-4001-8001-000000000001', 'f7010001-0001-4001-8001-000000000001', 'Caja 6 und', 6, true, true),
  ('f8010002-0002-4002-8002-000000000002', 'f7010002-0002-4002-8002-000000000002', 'Caja 6 und', 6, true, true),
  ('f8010003-0003-4003-8003-000000000003', 'f7010003-0003-4003-8003-000000000003', 'Caja 6 und', 6, true, true),
  ('f8010004-0004-4004-8004-000000000004', 'f7010004-0004-4004-8004-000000000004', 'Caja 6 und', 6, true, true),
  ('f8010005-0005-4005-8005-000000000005', 'f7010005-0005-4005-8005-000000000005', 'Caja 6 und', 6, true, true),
  ('f8010006-0006-4006-8006-000000000006', 'f7010006-0006-4006-8006-000000000006', 'Caja 6 und', 6, true, true),
  ('f8010007-0007-4007-8007-000000000007', 'f7010007-0007-4007-8007-000000000007', 'Paquete 12 und', 12, true, true),
  ('f8010008-0008-4008-8008-000000000008', 'f7010008-0008-4008-8008-000000000008', 'Paquete 12 und', 12, true, true),
  ('f8010009-0009-4009-8009-000000000009', 'f7010009-0009-4009-8009-000000000009', 'Paquete 12 und', 12, true, true),
  ('f8010010-0010-4010-8010-000000000010', 'f7010010-0010-4010-8010-000000000010', 'Paquete 12 und', 12, true, true),
  ('f8010011-0011-4011-8011-000000000011', 'f7010011-0011-4011-8011-000000000011', 'Paquete 12 und', 12, true, true),
  ('f8010012-0012-4012-8012-000000000012', 'f7010012-0012-4012-8012-000000000012', 'Paquete 12 und', 12, true, true)
on conflict (id) do update set
  supplier_product_id = excluded.supplier_product_id,
  label = excluded.label,
  units_per_pack = excluded.units_per_pack,
  is_default = excluded.is_default,
  is_active = excluded.is_active;

commit;
