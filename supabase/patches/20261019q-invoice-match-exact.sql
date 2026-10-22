-- =============================================================================
-- 20261019q — escaneo de factura: búsquedas exactas por POST, sin texto de la
--             factura en la URL (REP7-01; auditoría p8 P8-M1, caos p7 C7-M1, D35)
-- Proyecto: BodegaHub
-- Requiere: 20260716-multi-store.sql (store_id), 20261006a (assert_store_context
--           con perfil activo), 20261019a (invoice_scans), 20261019b
--           (supplier_product_aliases) y 20261019o (SELECT por columna de
--           invoice_scans). Se aplica DESPUÉS de 19o.
--
-- P8-M1: loadMatchContext pedía los alias exactos con
-- `supplier_product_aliases?alias_norm=in.(...)`: con ≥55 líneas de texto normal
-- la URL pasaba de ~8 kB, el gateway respondía 414 y el escaneo daba 500 con la
-- página ya cobrada. Lo mismo, con menos margen, para los barcodes crudos
-- (`products?barcode=in.(...)`) y para el número y la fecha leídos
-- (`invoice_scans?extracted->>number=ilike...`, `extracted->>date=eq...`). Regla
-- (D35): ninguna lectura del escaneo mete texto de la factura en la URL. Estas
-- tres RPC lo reciben en el cuerpo POST (text[] / text):
--
-- 1. invoice_match_exact_aliases(p_supplier_id uuid, p_alias_keys text[]) -> jsonb
--    Alias del proveedor cuyo alias_norm es EXACTAMENTE una de las claves
--    (unique (store_id, supplier_id, alias_norm): como mucho una fila por clave).
--    [{ id, alias_norm, product_id, pack_label, units_per_pack, hits }].
-- 2. invoice_match_barcode_products(p_barcodes text[]) -> jsonb
--    ids de los productos de la tienda (activos o no) con barcode igual a uno de
--    los valores: [uuid]. El detalle se lee después por id.
-- 3. invoice_match_previous_scans(p_number, p_totals, p_date, p_exclude_scan_id,
--    p_limit) -> jsonb
--    Escaneos de la tienda no descartados ni fallidos, del más reciente al más
--    antiguo, hasta p_limit (<= 200):
--      * con p_number (número normalizado, solo [A-Z0-9]): extracted->>number
--        contiene esos caracteres en orden y termina en el último, sin
--        distinguir mayúsculas (el patrón '%F%A%C%1' que antes iba en la URL);
--        quien llama filtra después por igualdad normalizada;
--      * sin p_number: extracted->>total es uno de p_totals (texto del número
--        JSON) y, si viene p_date, extracted->>date = p_date.
--    [{ id, supplier_id, number, supplier_tax_id, matched_contact_id, date,
--       total, purchase_id, purchase: { status } | null }].
--
-- Las tres devuelven un único jsonb: PostgREST no lo corta en max_rows.
--
-- Security INVOKER: leen con la sesión del usuario, así que la RLS de
-- supplier_product_aliases, products, invoice_scans (más el SELECT por columna
-- de 19o: no se lee claim_request_id) y purchases sigue aplicando. Además
-- filtran por store_id = assert_store_context() (la tienda del perfil activo,
-- nunca un parámetro) y exigen rol admin | almacen, igual que
-- invoice_match_candidates (20261019d). search_path = public.
--
-- Acotadas: más de 1000 claves / barcodes, más de 10 totales, un número de más de
-- 4000 caracteres o fuera de [A-Z0-9], o p_limit fuera de 1..200 -> PT400. Una
-- factura tiene como mucho 300 líneas (3 claves y 2 barcodes por línea).
--
-- Grants: solo authenticated (el BFF las llama con la sesión del usuario);
-- revoke a public y anon.
--
-- Errores (src/lib/supabase/errors.ts mapea PT4xx a HTTP):
--   42501 sin tienda activa (assert_store_context)
--   PT403 'No autorizado para emparejar facturas'
--   PT400 'Líneas de factura inválidas'
--
-- Idempotente (create or replace, revoke/grant repetibles), una transacción.
-- Solo lectura: no toca stock, dinero ni filas.
-- =============================================================================

begin;

-- 1. invoice_match_exact_aliases --------------------------------------------------------

create or replace function public.invoice_match_exact_aliases(
  p_supplier_id uuid,
  p_alias_keys text[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_store_id uuid;
  v_keys text[] := coalesce(p_alias_keys, '{}'::text[]);
  v_result jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para emparejar facturas';
  end if;

  if coalesce(array_length(v_keys, 1), 0) > 1000 then
    raise exception using errcode = 'PT400', message = 'Líneas de factura inválidas';
  end if;

  if p_supplier_id is null or coalesce(array_length(v_keys, 1), 0) = 0 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'alias_norm', a.alias_norm,
           'product_id', a.product_id,
           'pack_label', a.pack_label,
           'units_per_pack', a.units_per_pack,
           'hits', a.hits
         ) order by a.id), '[]'::jsonb)
  into v_result
  from public.supplier_product_aliases a
  where a.store_id = v_store_id
    and a.supplier_id = p_supplier_id
    and a.alias_norm = any(v_keys);

  return v_result;
end;
$$;

revoke all on function public.invoice_match_exact_aliases(uuid, text[]) from public, anon;
grant execute on function public.invoice_match_exact_aliases(uuid, text[]) to authenticated;

-- 2. invoice_match_barcode_products ---------------------------------------------------

create or replace function public.invoice_match_barcode_products(
  p_barcodes text[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_store_id uuid;
  v_barcodes text[] := coalesce(p_barcodes, '{}'::text[]);
  v_result jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para emparejar facturas';
  end if;

  if coalesce(array_length(v_barcodes, 1), 0) > 1000 then
    raise exception using errcode = 'PT400', message = 'Líneas de factura inválidas';
  end if;

  select coalesce(jsonb_agg(p.id order by p.id), '[]'::jsonb)
  into v_result
  from public.products p
  where p.store_id = v_store_id
    and p.barcode = any(v_barcodes);

  return v_result;
end;
$$;

revoke all on function public.invoice_match_barcode_products(text[]) from public, anon;
grant execute on function public.invoice_match_barcode_products(text[]) to authenticated;

-- 3. invoice_match_previous_scans ------------------------------------------------------

create or replace function public.invoice_match_previous_scans(
  p_number text default null,
  p_totals text[] default null,
  p_date text default null,
  p_exclude_scan_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_store_id uuid;
  v_pattern text;
  v_result jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para emparejar facturas';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200
     or coalesce(array_length(p_totals, 1), 0) > 10
     or (p_number is not null and (length(p_number) > 4000 or p_number !~ '^[A-Z0-9]+$'))
     or (p_number is null and coalesce(array_length(p_totals, 1), 0) = 0) then
    raise exception using errcode = 'PT400', message = 'Líneas de factura inválidas';
  end if;

  -- '%F%A%C%1': los caracteres en orden, separadores y ceros sobrantes en los '%'.
  -- p_number solo tiene [A-Z0-9]: no hay comodines de LIKE que escapar.
  if p_number is not null then
    v_pattern := '%' || array_to_string(regexp_split_to_array(p_number, ''), '%');
  end if;

  with found as (
    select s.id, s.supplier_id, s.extracted, s.matched, s.purchase_id, s.created_at, pu.status as purchase_status
    from public.invoice_scans s
    left join public.purchases pu on pu.id = s.purchase_id
    where s.store_id = v_store_id
      and s.status not in ('discarded', 'failed')
      and (p_exclude_scan_id is null or s.id <> p_exclude_scan_id)
      and (
        (v_pattern is not null and (s.extracted ->> 'number') ilike v_pattern)
        or (v_pattern is null
            and (s.extracted ->> 'total') = any(p_totals)
            and (p_date is null or (s.extracted ->> 'date') = p_date))
      )
    order by s.created_at desc, s.id
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id,
           'supplier_id', f.supplier_id,
           'number', f.extracted ->> 'number',
           'supplier_tax_id', f.extracted -> 'supplier' ->> 'taxId',
           'matched_contact_id', f.matched -> 'supplier' ->> 'contactId',
           'date', f.extracted ->> 'date',
           'total', f.extracted ->> 'total',
           'purchase_id', f.purchase_id,
           'purchase', case when f.purchase_status is null then null
                            else jsonb_build_object('status', f.purchase_status) end
         ) order by f.created_at desc, f.id), '[]'::jsonb)
  into v_result
  from found f;

  return v_result;
end;
$$;

revoke all on function public.invoice_match_previous_scans(text, text[], text, uuid, integer) from public, anon;
grant execute on function public.invoice_match_previous_scans(text, text[], text, uuid, integer) to authenticated;

commit;

notify pgrst, 'reload schema';
