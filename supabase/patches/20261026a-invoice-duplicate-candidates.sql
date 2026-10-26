-- =============================================================================
-- 20261026a — escaneo de factura: candidatos a duplicado YA filtrados por proveedor
--             (REP12-06; QA REP12-01 B-qa-rep12-01-1, D53/D55)
-- =============================================================================
-- invoice_match_previous_scans (20261019q) devuelve los p_limit (<= 200) escaneos más
-- recientes con el número (o fecha + total) y el BFF filtra después por proveedor. Si el
-- mismo número se repite con otros proveedores en más de p_limit escaneos más nuevos, el
-- duplicado real del proveedor elegido queda fuera del tope y el aviso no sale (lab: n.º
-- 00001234 con 950 escaneos vivos, el del proveedor pedido desde el puesto 140).
--
-- 1. invoice_duplicate_candidates(p_number, p_totals, p_date, p_exclude_scan_id, p_limit,
--    p_supplier_ids, p_tax_digits) -> jsonb
--    Mismo contrato y mismas filas que invoice_match_previous_scans, pero el filtro de
--    proveedor va ANTES del tope: solo escaneos cuyo proveedor puede ser el de la
--    consulta (superconjunto de la regla del BFF, findDuplicateScans, que decide):
--      * supplier_id o matched.supplier.contactId en p_supplier_ids, o
--      * los dígitos del RIF leído (extracted.supplier.taxId) en p_tax_digits, o
--      * los dígitos del RIF guardado (contacts.tax_id, misma tienda) de su supplier_id o
--        de su contacto leído en p_tax_digits.
--    "Dígitos" = normalizeTaxId del BFF: mayúsculas, solo [A-Z0-9] y sin la letra de tipo
--    inicial [JVEGPC]; la letra la compara el BFF (sameTaxId).
--    REP14-01 (M-p15-1, D63): un escaneo casa por número si casa su número LEÍDO
--    (extracted.number) o su número EFECTIVO: el confirmado por el usuario
--    (confirmed.extraction.number) si existe y no está vacío, si no el leído. 'number'
--    devuelve el efectivo y 'read_number' el leído (el BFF casa con cualquiera). Así, teclear
--    el número correcto encuentra la compra confirmada tecleándolo aunque el modelo no lo
--    leyera, y volver a leer el mismo número erróneo sin corregirlo sigue avisando.
--    REP14-05 (M-qa1401-1, mismo criterio; edición idempotente, no desplegado): sin número,
--    un escaneo casa por total y fecha si casan los LEÍDOS o los EFECTIVOS (los confirmados,
--    confirmed.extraction.total / .date, si no están vacíos; si no los leídos). 'date' y
--    'total' devuelven los efectivos y 'read_date' / 'read_total' los leídos.
--    Los ids y RIF viajan en el cuerpo POST (D35: nada de texto de la factura en la URL).
--    La usan POST /api/purchases/invoice-scan/duplicates (proveedor elegido / leído) y el
--    emparejamiento del escaneo (loadMatchContext, con el proveedor LEÍDO: contacto resuelto y
--    RIF leído; sin proveedor leído sigue con invoice_match_previous_scans).
--
-- Security INVOKER (RLS de invoice_scans, purchases y contacts), tienda de
-- assert_store_context(), rol admin | almacen (PT403), como 20261019q.
-- Acotada (PT400): p_limit fuera de 1..200, más de 10 totales, número de más de 4000
-- caracteres o fuera de [A-Z0-9], sin número ni totales, ningún proveedor (ni id ni RIF),
-- más de 10 ids o 10 RIF, id fuera de [A-Za-z0-9_-]{1,64}, RIF fuera de [A-Z0-9]{1,20}.
-- Grants: solo authenticated.
--
-- Requiere 20261019a y 20261019o (columnas de invoice_scans legibles por authenticated).
-- No redefine nada: reaplicar 20261019q no lo deshace. Idempotente, una transacción. Solo
-- lectura: no toca stock ni dinero.
-- ORDEN: aplicar ANTES de desplegar el BFF de REP12-06. Sin el parche, el ESCANEO con proveedor
-- leído falla al emparejar (PGRST202) y la consulta de duplicados de la revisión responde 500
-- («No se pudo comprobar…», sin bloquear). Después, verify-patches.sql (filas "(20261026a").
-- =============================================================================

begin;

create or replace function public.invoice_duplicate_candidates(
  p_number text default null,
  p_totals text[] default null,
  p_date text default null,
  p_exclude_scan_id uuid default null,
  p_limit integer default 50,
  p_supplier_ids text[] default null,
  p_tax_digits text[] default null
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
  v_ids text[] := coalesce(p_supplier_ids, '{}'::text[]);
  v_digits text[] := coalesce(p_tax_digits, '{}'::text[]);
  v_result jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para emparejar facturas';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 200
     or coalesce(array_length(p_totals, 1), 0) > 10
     or (p_number is not null and (length(p_number) > 4000 or p_number !~ '^[A-Z0-9]+$'))
     or (p_number is null and coalesce(array_length(p_totals, 1), 0) = 0)
     or coalesce(array_length(v_ids, 1), 0) + coalesce(array_length(v_digits, 1), 0) = 0
     or coalesce(array_length(v_ids, 1), 0) > 10
     or coalesce(array_length(v_digits, 1), 0) > 10
     or exists (select 1 from unnest(v_ids) i where i is null or i !~ '^[A-Za-z0-9_-]{1,64}$')
     or exists (select 1 from unnest(v_digits) d where d is null or d !~ '^[A-Z0-9]{1,20}$') then
    raise exception using errcode = 'PT400', message = 'Líneas de factura inválidas';
  end if;

  -- '%F%A%C%1': como invoice_match_previous_scans (20261019q).
  if p_number is not null then
    v_pattern := '%' || array_to_string(regexp_split_to_array(p_number, ''), '%');
  end if;

  with found as (
    select s.id, s.supplier_id, s.extracted, s.matched, s.purchase_id, s.created_at, pu.status as purchase_status,
           coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'number'), ''), s.extracted ->> 'number') as effective_number,
           coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), ''), s.extracted ->> 'date') as effective_date,
           coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'total'), ''), s.extracted ->> 'total') as effective_total
    from public.invoice_scans s
    left join public.purchases pu on pu.id = s.purchase_id
    where s.store_id = v_store_id
      and s.status not in ('discarded', 'failed')
      and (p_exclude_scan_id is null or s.id <> p_exclude_scan_id)
      and (
        -- REP14-01 (D63): número efectivo (el confirmado si no está vacío, si no el leído) o el leído.
        (v_pattern is not null
         and (coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'number'), ''), s.extracted ->> 'number') ilike v_pattern
              or (s.extracted ->> 'number') ilike v_pattern))
        -- REP14-05: total y fecha, los leídos o los efectivos (confirmados si no están vacíos).
        or (v_pattern is null
            and ((s.extracted ->> 'total') = any(p_totals)
                 or coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'total'), ''), s.extracted ->> 'total') = any(p_totals))
            and (p_date is null
                 or (s.extracted ->> 'date') = p_date
                 or coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), ''), s.extracted ->> 'date') = p_date))
      )
      -- Proveedor antes del tope (superconjunto; el BFF aplica findDuplicateScans).
      and (
        s.supplier_id::text = any(v_ids)
        or (s.matched -> 'supplier' ->> 'contactId') = any(v_ids)
        or regexp_replace(regexp_replace(upper(coalesce(s.extracted -> 'supplier' ->> 'taxId', '')),
             '[^A-Z0-9]', '', 'g'), '^[JVEGPC]', '') = any(v_digits)
        or exists (
          select 1
          from public.contacts c
          where c.store_id = v_store_id
            and (c.id = s.supplier_id or c.id::text = (s.matched -> 'supplier' ->> 'contactId'))
            and regexp_replace(regexp_replace(upper(coalesce(c.tax_id, '')), '[^A-Z0-9]', '', 'g'),
                  '^[JVEGPC]', '') = any(v_digits)
        )
      )
    order by s.created_at desc, s.id
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id,
           'supplier_id', f.supplier_id,
           'number', f.effective_number,
           'read_number', f.extracted ->> 'number',
           'supplier_tax_id', f.extracted -> 'supplier' ->> 'taxId',
           'matched_contact_id', f.matched -> 'supplier' ->> 'contactId',
           'date', f.effective_date,
           'read_date', f.extracted ->> 'date',
           'total', f.effective_total,
           'read_total', f.extracted ->> 'total',
           'purchase_id', f.purchase_id,
           'purchase', case when f.purchase_status is null then null
                            else jsonb_build_object('status', f.purchase_status) end
         ) order by f.created_at desc, f.id), '[]'::jsonb)
  into v_result
  from found f;

  return v_result;
end;
$$;

revoke all on function public.invoice_duplicate_candidates(text, text[], text, uuid, integer, text[], text[]) from public, anon;
grant execute on function public.invoice_duplicate_candidates(text, text[], text, uuid, integer, text[], text[]) to authenticated;

commit;

notify pgrst, 'reload schema';
