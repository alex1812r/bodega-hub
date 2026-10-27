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
--    REP14-05b (edición idempotente, no desplegado): el total se compara como numeric
--    redondeado al céntimo, no como texto (el BFF manda String(cents/100), "27895", y
--    el JSON guarda 27895.00 o el texto "7708.80"); lo que no es un número JSON ni un texto
--    decimal plano (^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$: ni exponentes ni comas) no casa y
--    no lanza error, ni en la fila ni en p_totals (el filtro va en el jsonpath, antes del
--    cast). «Leído o efectivo» se evalúa como leído o confirmado (si el confirmado está
--    vacío el efectivo es el leído): cada campo del jsonb se lee una vez por fila, el mismo
--    coste que la comparación de texto (EXPLAIN en lab, .notes/factura-escaneo/rep14/
--    05b-explain-*). La fecha se compara como clave ISO: DD/MM/AAAA
--    o DD-MM-AAAA (día y mes de 1-2 dígitos, mismo separador: los formatos que admite la
--    revisión, getInvoiceDateIssue) pasa a AAAA-MM-DD, en la fila y en p_date; cualquier
--    otro texto se compara tal cual (sin cast a date: una fecha imposible no lanza error,
--    solo no casa). Día primero siempre (Venezuela). 'date'/'total' se devuelven crudos.
--    Los ids y RIF viajan en el cuerpo POST (D35: nada de texto de la factura en la URL).
--    La usan POST /api/purchases/invoice-scan/duplicates (proveedor elegido / leído) y el
--    emparejamiento del escaneo (loadMatchContext, con el proveedor LEÍDO: contacto resuelto y
--    RIF leído; sin proveedor leído sigue con invoice_match_previous_scans).
--    REP15-02 (B-p16-1, auditoría p16; edición idempotente, no desplegado): la fecha y el número
--    se normalizan quitando TODO espacio Unicode y tabulador, en los extremos o en medio (la clase
--    \s de JS: \t \n \v \f \r, espacio, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F,
--    U+205F, U+3000, U+FEFF), como withoutSpaces / invoiceDateKey del BFF. Antes solo se quitaban
--    espacios ASCII (btrim y ' *') y una fecha confirmada «05/06/2025<NBSP>» o «05/06/2025<TAB>» no
--    casaba por total + fecha. Dos funciones nuevas: invoice_without_spaces(text) y
--    invoice_date_key(text) (clave ISO sin blancos). La clave se aplica a p_date y a la fecha
--    leída y confirmada; el número/fecha confirmados «vacíos» son los que quedan vacíos sin
--    blancos. Además se REDEFINE aquí invoice_match_previous_scans (misma firma y contrato que
--    20261019q) con la misma normalización.
--    REP15-02 (B-p16Q-2, QA p16): un RIF de relleno (dígitos todo ceros, «J-00000000-0») no
--    identifica proveedor: los p_tax_digits de solo ceros se ignoran (el BFF ya no los manda:
--    normalizeTaxId da "").
--    REP15-02b (B-qa1502-1, QA REP15-02; edición idempotente, no desplegado): el patrón del número
--    ('%F%A%C%1', acaba en el último carácter) se comparaba con el texto crudo y un número guardado
--    con un blanco Unicode, TAB o punto al FINAL («QA-R15-0203<NBSP>») no salía por número aunque el
--    BFF lo considera igual. Ahora se compara con invoice_number_key(text) (mayúsculas, solo [A-Z0-9],
--    como normalizeInvoiceNumber antes de quitar rótulo y ceros), en las dos RPC: siguen siendo un
--    superconjunto del BFF, que decide.
--
-- Security INVOKER (RLS de invoice_scans, purchases y contacts), tienda de
-- assert_store_context(), rol admin | almacen (PT403), como 20261019q.
-- Acotada (PT400): p_limit fuera de 1..200, más de 10 totales, número de más de 4000
-- caracteres o fuera de [A-Z0-9], sin número ni totales, ningún proveedor (ni id ni RIF),
-- más de 10 ids o 10 RIF, id fuera de [A-Za-z0-9_-]{1,64}, RIF fuera de [A-Z0-9]{1,20}.
-- Grants: solo authenticated (las tres funciones de normalización: authenticated y service_role).
--
-- Requiere 20261019a y 20261019o (columnas de invoice_scans legibles por authenticated) y
-- 20261019q. REP15-02: redefine invoice_match_previous_scans, así que reaplicar 20261019q obliga a
-- reaplicar este parche después. Idempotente, una transacción. Solo lectura: no toca stock ni
-- dinero.
-- ORDEN: aplicar ANTES de desplegar el BFF de REP12-06. Sin el parche, el ESCANEO con proveedor
-- leído falla al emparejar (PGRST202) y la consulta de duplicados de la revisión responde 500
-- («No se pudo comprobar…», sin bloquear). Después, verify-patches.sql (filas "(20261026a").
-- =============================================================================

begin;

-- REP15-02 (B-p16-1): el texto sin ningún espacio Unicode ni tabulador (la clase \s de JS, como
-- withoutSpaces del BFF). null -> null.
create or replace function public.invoice_without_spaces(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select regexp_replace(p_value, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g')
$$;

revoke all on function public.invoice_without_spaces(text) from public, anon;
grant execute on function public.invoice_without_spaces(text) to authenticated, service_role;

-- REP15-02 (B-p16-1): clave de fecha comparable, como invoiceDateKey del BFF: sin blancos
-- (invoice_without_spaces) y DD/MM/AAAA o DD-MM-AAAA (día y mes de 1-2 dígitos, mismo separador)
-- -> AAAA-MM-DD; otro texto, tal cual (sin cast a date: lo imposible no casa, no falla).
-- null -> null; solo blancos -> ''.
create or replace function public.invoice_date_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case when k.v ~ '^[0-9]{1,2}([/-])[0-9]{1,2}\1[0-9]{4}$'
              then split_part(translate(k.v, '/', '-'), '-', 3)
                   || '-' || lpad(split_part(translate(k.v, '/', '-'), '-', 2), 2, '0')
                   || '-' || lpad(split_part(translate(k.v, '/', '-'), '-', 1), 2, '0')
              else k.v end
  from (select public.invoice_without_spaces(p_value) as v) k
$$;

revoke all on function public.invoice_date_key(text) from public, anon;
grant execute on function public.invoice_date_key(text) to authenticated, service_role;

-- REP15-02b (B-qa1502-1): número de factura comparable con el patrón '%F%A%C%1': en mayúsculas y solo
-- [A-Z0-9], como normalizeInvoiceNumber del BFF antes de quitar rótulo y ceros (de eso se encarga el
-- '%' inicial del patrón). Sin ella, el patrón (que acaba en el último carácter) no casaba un número
-- guardado con un blanco Unicode, TAB o punto al final. null -> null.
create or replace function public.invoice_number_key(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select regexp_replace(upper(p_value), '[^A-Z0-9]', '', 'g')
$$;

revoke all on function public.invoice_number_key(text) from public, anon;
grant execute on function public.invoice_number_key(text) to authenticated, service_role;

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
  v_totals numeric[];
  v_date text;
  -- REP14-05b: número JSON, o texto decimal plano (sin exponente ni comas); lo demás no casa.
  v_total_path constant jsonpath := '$.total ? (@.type() == "number" || (@.type() == "string" && @ like_regex "^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$"))';
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

  -- REP14-05b: p_totals a numeric al céntimo (los que no son un decimal plano se ignoran, sin
  -- error). REP15-02: p_date a clave ISO sin blancos (invoice_date_key).
  v_totals := array(select round(btrim(t)::numeric, 2) from unnest(p_totals) t
                    where t ~ '^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$');
  v_date := nullif(public.invoice_date_key(p_date), '');
  -- REP15-02 (B-p16Q-2): un RIF de relleno (solo ceros) no identifica proveedor.
  v_digits := array(select d from unnest(v_digits) d where d !~ '^0+$');

  with found as (
    select s.id, s.supplier_id, s.extracted, s.matched, s.purchase_id, s.created_at, pu.status as purchase_status,
           -- REP15-02: «vacío» = vacío sin blancos (invoice_without_spaces); se devuelve el texto crudo.
           case when public.invoice_without_spaces(s.confirmed -> 'extraction' ->> 'number') <> ''
                then s.confirmed -> 'extraction' ->> 'number' else s.extracted ->> 'number' end as effective_number,
           case when public.invoice_without_spaces(s.confirmed -> 'extraction' ->> 'date') <> ''
                then s.confirmed -> 'extraction' ->> 'date' else s.extracted ->> 'date' end as effective_date,
           coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'total'), ''), s.extracted ->> 'total') as effective_total
    from public.invoice_scans s
    left join public.purchases pu on pu.id = s.purchase_id
    where s.store_id = v_store_id
      and s.status not in ('discarded', 'failed')
      and (p_exclude_scan_id is null or s.id <> p_exclude_scan_id)
      and (
        -- REP14-01 (D63): número efectivo (el confirmado si no está vacío, si no el leído) o el leído.
        -- REP15-02b (B-qa1502-1): el patrón se compara con la clave (invoice_number_key), no con el texto
        -- crudo: un blanco Unicode, TAB o punto al final ya no impide casar.
        (v_pattern is not null
         and (public.invoice_number_key(case when public.invoice_without_spaces(s.confirmed -> 'extraction' ->> 'number') <> ''
                    then s.confirmed -> 'extraction' ->> 'number' else s.extracted ->> 'number' end) like v_pattern
              or public.invoice_number_key(s.extracted ->> 'number') like v_pattern))
        -- REP14-05: total y fecha, los leídos o los efectivos (confirmados si no están vacíos).
        -- REP14-05b: «leído o efectivo» = leído o confirmado (si el confirmado está vacío, el efectivo
        -- es el leído; si no vale, no casa). Total: número JSON o texto decimal plano (v_total_path),
        -- a numeric al céntimo, leyendo el jsonb una vez por campo. Fecha: clave ISO.
        -- REP15-02 (B-p16-1): la clave ISO sin ningún blanco Unicode (invoice_date_key).
        or (v_pattern is null
            and (round((jsonb_path_query_first(s.extracted, v_total_path) #>> '{}')::numeric, 2) = any(v_totals)
                 or round((jsonb_path_query_first(s.confirmed -> 'extraction', v_total_path) #>> '{}')::numeric, 2) = any(v_totals))
            and (v_date is null
                 or public.invoice_date_key(s.extracted ->> 'date') = v_date
                 or public.invoice_date_key(s.confirmed -> 'extraction' ->> 'date') = v_date))
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

-- REP15-02 (B-p16-1): invoice_match_previous_scans redefinida (misma firma y contrato que 20261019q,
-- REP14-01/05/05b) con la fecha y el número normalizados sin blancos Unicode, como arriba.
-- Reaplicar 20261019q la devuelve a la versión anterior: reaplicar este parche después.
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
  v_totals numeric[];
  v_date text;
  -- REP14-05b: número JSON, o texto decimal plano (sin exponente ni comas); lo demás no casa.
  v_total_path constant jsonpath := '$.total ? (@.type() == "number" || (@.type() == "string" && @ like_regex "^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$"))';
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

  -- REP14-05b: p_totals a numeric al céntimo (los que no son un decimal plano se ignoran, sin
  -- error). REP15-02: p_date a clave ISO sin blancos (invoice_date_key).
  v_totals := array(select round(btrim(t)::numeric, 2) from unnest(p_totals) t
                    where t ~ '^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$');
  v_date := nullif(public.invoice_date_key(p_date), '');

  with found as (
    select s.id, s.supplier_id, s.extracted, s.matched, s.purchase_id, s.created_at, pu.status as purchase_status,
           -- REP15-02: «vacío» = vacío sin blancos (invoice_without_spaces); se devuelve el texto crudo.
           case when public.invoice_without_spaces(s.confirmed -> 'extraction' ->> 'number') <> ''
                then s.confirmed -> 'extraction' ->> 'number' else s.extracted ->> 'number' end as effective_number,
           case when public.invoice_without_spaces(s.confirmed -> 'extraction' ->> 'date') <> ''
                then s.confirmed -> 'extraction' ->> 'date' else s.extracted ->> 'date' end as effective_date,
           coalesce(nullif(btrim(s.confirmed -> 'extraction' ->> 'total'), ''), s.extracted ->> 'total') as effective_total
    from public.invoice_scans s
    left join public.purchases pu on pu.id = s.purchase_id
    where s.store_id = v_store_id
      and s.status not in ('discarded', 'failed')
      and (p_exclude_scan_id is null or s.id <> p_exclude_scan_id)
      and (
        -- REP14-01 (D63): número efectivo (el confirmado si no está vacío, si no el leído) o el leído.
        -- REP15-02b (B-qa1502-1): el patrón se compara con la clave (invoice_number_key), no con el texto
        -- crudo: un blanco Unicode, TAB o punto al final ya no impide casar.
        (v_pattern is not null
         and (public.invoice_number_key(case when public.invoice_without_spaces(s.confirmed -> 'extraction' ->> 'number') <> ''
                    then s.confirmed -> 'extraction' ->> 'number' else s.extracted ->> 'number' end) like v_pattern
              or public.invoice_number_key(s.extracted ->> 'number') like v_pattern))
        -- REP14-05: total y fecha, los leídos o los efectivos (confirmados si no están vacíos).
        -- REP14-05b: «leído o efectivo» = leído o confirmado (si el confirmado está vacío, el efectivo
        -- es el leído; si no vale, no casa). Total: número JSON o texto decimal plano (v_total_path),
        -- a numeric al céntimo, leyendo el jsonb una vez por campo. Fecha: clave ISO.
        -- REP15-02 (B-p16-1): la clave ISO sin ningún blanco Unicode (invoice_date_key).
        or (v_pattern is null
            and (round((jsonb_path_query_first(s.extracted, v_total_path) #>> '{}')::numeric, 2) = any(v_totals)
                 or round((jsonb_path_query_first(s.confirmed -> 'extraction', v_total_path) #>> '{}')::numeric, 2) = any(v_totals))
            and (v_date is null
                 or public.invoice_date_key(s.extracted ->> 'date') = v_date
                 or public.invoice_date_key(s.confirmed -> 'extraction' ->> 'date') = v_date))
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

revoke all on function public.invoice_match_previous_scans(text, text[], text, uuid, integer) from public, anon;
grant execute on function public.invoice_match_previous_scans(text, text[], text, uuid, integer) to authenticated;

commit;

notify pgrst, 'reload schema';
