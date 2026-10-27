-- =============================================================================
-- 20261019q — escaneo de factura: búsquedas exactas por POST, sin texto de la
--             factura en la URL (REP7-01; auditoría p8 P8-M1, caos p7 C7-M1, D35)
-- Proyecto: BodegaHub
-- Requiere: 20260716-multi-store.sql (store_id), 20261006a (assert_store_context
--           con perfil activo), 20261019a (invoice_scans), 20261019b
--           (supplier_product_aliases, pg_trgm), 20261019d (invoice_match_norm,
--           invoice_match_candidates), 20261019i (escrituras service-only) y
--           20261019o (SELECT por columna de invoice_scans). Se aplica DESPUÉS de 19o.
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
--    [{ id, supplier_id, number, read_number, supplier_tax_id, matched_contact_id,
--       date, total, purchase_id, purchase: { status } | null }].
--    REP14-01 (M-p15-1, D63; edición idempotente, 19q no desplegado): con p_number casa
--    el número LEÍDO (extracted->>number) o el EFECTIVO (confirmed->extraction->>number
--    si no está vacío, si no el leído); 'number' es el efectivo y 'read_number' el leído.
--    REP14-05 (M-qa1401-1, mismo criterio; edición idempotente): sin p_number casa el total y
--    la fecha LEÍDOS o los EFECTIVOS (confirmed->extraction->>total / ->>date si no están
--    vacíos, si no los leídos); 'date'/'total' son los efectivos y 'read_date'/'read_total'
--    los leídos.
--    REP14-05b (edición idempotente): el total se compara como numeric redondeado al
--    céntimo, no como texto (p_totals llega como String(cents/100), "27895", y el JSON
--    guarda 27895.00 o el texto "7708.80"); lo que no es un número JSON ni un texto decimal
--    plano (^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$) no casa y no lanza error, ni en la fila ni
--    en p_totals (filtro en el jsonpath, antes del cast). «Leído o efectivo» = leído o
--    confirmado (vacío -> el efectivo es el leído): una lectura del jsonb por campo. La fecha se compara como clave ISO: DD/MM/AAAA o DD-MM-AAAA (día y mes de
--    1-2 dígitos, mismo separador, como admite la revisión) pasa a AAAA-MM-DD en la fila y
--    en p_date; otro texto, tal cual (sin cast a date: lo imposible no casa, no falla).
--    Día primero siempre. Igual que invoice_duplicate_candidates (20261026a).
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
-- REP7-04 (QA REP7-01 F1 y F2) añade:
-- 4. idx_products_match_name_trgm (GIN trigram sobre invoice_match_norm(name)) y
--    invoice_match_candidates redefinida (misma firma y contrato que 20261019d) con el
--    operador % sobre los índices trigram: con ~1.200 productos la llamada de 450
--    textos tardaba 17 s y PostgREST la cortaba (57014). Reaplicar 19d deshace esto.
-- 5. save_invoice_scan_match(p_store_id, p_id, p_matched) -> setof invoice_scans:
--    guarda SOLO matched de un escaneo 'extracted' (el reintento cacheado tras un
--    MATCH_ERROR). security definer, execute solo service_role, como 20261019i.
--
-- Idempotente (create or replace, create index if not exists, revoke/grant
-- repetibles), una transacción. No toca stock ni dinero; la única escritura es
-- matched de invoice_scans (5).
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
  -- error) y p_date a clave ISO (DD/MM/AAAA o DD-MM-AAAA -> AAAA-MM-DD; si no, el texto).
  v_totals := array(select round(btrim(t)::numeric, 2) from unnest(p_totals) t
                    where t ~ '^ *-?[0-9]{1,20}([.][0-9]{0,20})? *$');
  v_date := (case when p_date ~ '^ *[0-9]{1,2}([/-])[0-9]{1,2}\1[0-9]{4} *$'
            then split_part(translate(btrim(p_date), '/', '-'), '-', 3)
                 || '-' || lpad(split_part(translate(btrim(p_date), '/', '-'), '-', 2), 2, '0')
                 || '-' || lpad(split_part(translate(btrim(p_date), '/', '-'), '-', 1), 2, '0')
            else btrim(p_date) end);

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
        -- REP14-05b: «leído o efectivo» = leído o confirmado (si el confirmado está vacío, el efectivo
        -- es el leído; si no vale, no casa). Total: número JSON o texto decimal plano (v_total_path),
        -- a numeric al céntimo, leyendo el jsonb una vez por campo. Fecha: clave ISO (DD/MM/AAAA o
        -- DD-MM-AAAA -> AAAA-MM-DD; otro texto tal cual).
        or (v_pattern is null
            and (round((jsonb_path_query_first(s.extracted, v_total_path) #>> '{}')::numeric, 2) = any(v_totals)
                 or round((jsonb_path_query_first(s.confirmed -> 'extraction', v_total_path) #>> '{}')::numeric, 2) = any(v_totals))
            and (v_date is null
                 or (case when (s.extracted ->> 'date') ~ '^ *[0-9]{1,2}([/-])[0-9]{1,2}\1[0-9]{4} *$'
                       then split_part(translate(btrim((s.extracted ->> 'date')), '/', '-'), '-', 3)
                            || '-' || lpad(split_part(translate(btrim((s.extracted ->> 'date')), '/', '-'), '-', 2), 2, '0')
                            || '-' || lpad(split_part(translate(btrim((s.extracted ->> 'date')), '/', '-'), '-', 1), 2, '0')
                       else btrim((s.extracted ->> 'date')) end) = v_date
                 or (case when nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), '') ~ '^ *[0-9]{1,2}([/-])[0-9]{1,2}\1[0-9]{4} *$'
                       then split_part(translate(btrim(nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), '')), '/', '-'), '-', 3)
                            || '-' || lpad(split_part(translate(btrim(nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), '')), '/', '-'), '-', 2), 2, '0')
                            || '-' || lpad(split_part(translate(btrim(nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), '')), '/', '-'), '-', 1), 2, '0')
                       else btrim(nullif(btrim(s.confirmed -> 'extraction' ->> 'date'), '')) end) = v_date))
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

-- 4. invoice_match_candidates con indices trigram (REP7-04, QA REP7-01 F1) ------------
--
-- 20261019d comparaba cada texto con TODOS los alias del proveedor y TODOS los productos
-- activos con similarity(...) >= 0.6, que no usa indice: 450 textos x 1180 productos
-- (+ 1528 alias) = 1,2 millones de similarity() y 17 s medidos en el lab; PostgREST
-- cortaba a los 8 s (57014) y el escaneo de 75-150 lineas daba 500.
-- Ahora cada lado filtra ademas con el operador % (umbral pg_trgm.similarity_threshold
-- = 0.6, fijado en la funcion, asi que no depende de la sesion) sobre un indice GIN
-- trigram: el de alias_norm (19b) y uno nuevo sobre invoice_match_norm(products.name).
-- El similarity(...) >= 0.6 de 19d se conserva: % con umbral 0,6 compara el mismo real
-- con el mismo double, asi que filas, scores y orden son los de 19d. Misma firma, mismo
-- contrato, security definer con el mismo chequeo de tienda y rol; grants de 19d.
-- plan_cache_mode = force_custom_plan: plpgsql pasa al plan generico tras 5 llamadas en la
-- misma conexion (las del pool de PostgREST); con el proveedor como parametro el plan
-- generico recorre sus alias por el btree (store_id, supplier_id) y evalua % par a par
-- (450 textos x 1528 alias: 5,4 s medidos). El plan por llamada usa el GIN (~90 ms).
-- fastupdate = off en los dos GIN: con fastupdate las filas nuevas van a una lista
-- pendiente que cada busqueda recorre entera hasta el siguiente vacuum (1200 productos
-- recien creados: 2,4 s por llamada; sin ella 0,24 s, y la insercion pasa de 0,43 a 0,52 s).
-- OJO: reaplicar 19d devuelve la version sin indice: volver a aplicar este parche.

do $$
declare
  v_schema text;
begin
  select n.nspname
  into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format(
    'create index if not exists idx_products_match_name_trgm '
    'on public.products using gin (public.invoice_match_norm(name) %I.gin_trgm_ops) '
    'with (fastupdate = off)',
    v_schema
  );
  alter index public.idx_products_match_name_trgm set (fastupdate = off);
  alter index public.idx_supplier_product_aliases_alias_trgm set (fastupdate = off);
  -- Lo que ya estuviera en la lista pendiente pasa al indice.
  perform pg_catalog.gin_clean_pending_list('public.idx_products_match_name_trgm'::regclass);
  perform pg_catalog.gin_clean_pending_list('public.idx_supplier_product_aliases_alias_trgm'::regclass);

  -- Carga la libreria de pg_trgm en esta sesion: sin ella pg_trgm.similarity_threshold
  -- es un placeholder y el "set" de la funcion de abajo solo lo admite un superusuario
  -- (en Supabase postgres no lo es). Con la libreria cargada es un parametro USERSET.
  execute format('select %I.similarity(%L, %L)', v_schema, 'a', 'a');
end;
$$;

create or replace function public.invoice_match_candidates(
  p_supplier_name text,
  p_supplier_tax_id text default null,
  p_texts text[] default '{}'::text[],
  p_descriptions text[] default null,
  p_supplier_id uuid default null,
  p_limit integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
set pg_trgm.similarity_threshold = 0.6
set plan_cache_mode = force_custom_plan
as $$
declare
  v_store_id uuid;
  v_name text := btrim(coalesce(p_supplier_name, ''));
  v_tax_id text;
  v_tax_letter text;
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 5);
  v_texts text[] := coalesce(p_texts, '{}'::text[]);
  v_suppliers jsonb;
  v_supplier_id uuid;
  v_lines jsonb;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para emparejar facturas';
  end if;

  if coalesce(array_length(v_texts, 1), 0) > 500
     or (p_descriptions is not null
         and coalesce(array_length(p_descriptions, 1), 0) <> coalesce(array_length(v_texts, 1), 0)) then
    raise exception using errcode = 'PT400', message = 'Líneas de factura inválidas';
  end if;

  -- RIF comparable: como sameTaxId (match/text.ts). v_tax_id = digitos sin la
  -- letra de tipo (normalizeTaxId); v_tax_letter = esa letra o ''.
  v_tax_id := regexp_replace(upper(coalesce(p_supplier_tax_id, '')), '[^A-Z0-9]', '', 'g');
  v_tax_letter := coalesce(substring(v_tax_id from '^[JVEGPC]'), '');
  v_tax_id := regexp_replace(v_tax_id, '^[JVEGPC]', '');

  -- a. Candidatos de proveedor.
  with scored as (
    select
      c.id,
      c.name,
      c.tax_id,
      case when v_name = '' then 0::real
           else similarity(public.invoice_match_norm(c.name), v_name) end as score,
      v_tax_id <> ''
        and regexp_replace(t.cmp, '^[JVEGPC]', '') = v_tax_id
        and (v_tax_letter = ''
             or coalesce(substring(t.cmp from '^[JVEGPC]'), '') in ('', v_tax_letter))
        as tax_id_match
    from public.contacts c
    cross join lateral (
      select regexp_replace(upper(coalesce(c.tax_id, '')), '[^A-Z0-9]', '', 'g') as cmp
    ) t
    where c.store_id = v_store_id
      and c.is_active
      and c.type in ('proveedor', 'ambos')
  ), ranked as (
    select s.*
    from scored s
    where s.tax_id_match or s.score >= 0.3
    order by s.tax_id_match desc, s.score desc, s.name, s.id
    limit 5
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'contact_id', r.id,
           'name', r.name,
           'tax_id', r.tax_id,
           'score', round(r.score::numeric, 4),
           'tax_id_match', r.tax_id_match
         ) order by r.tax_id_match desc, r.score desc, r.name, r.id), '[]'::jsonb)
  into v_suppliers
  from ranked r;

  -- b. Proveedor cuyos alias cuentan.
  if p_supplier_id is not null then
    select c.id
    into v_supplier_id
    from public.contacts c
    where c.id = p_supplier_id
      and c.store_id = v_store_id
      and c.is_active
      and c.type in ('proveedor', 'ambos');
  end if;

  if v_supplier_id is null then
    select (array_agg((e ->> 'contact_id')::uuid))[1]
    into v_supplier_id
    from jsonb_array_elements(v_suppliers) e
    where (e ->> 'tax_id_match')::boolean
    having count(*) = 1;
  end if;

  if v_supplier_id is null then
    select (e ->> 'contact_id')::uuid
    into v_supplier_id
    from jsonb_array_elements(v_suppliers) with ordinality as x(e, ord)
    where not (e ->> 'tax_id_match')::boolean
    order by (e ->> 'score')::numeric desc, x.ord
    limit 1;
  end if;

  -- c. Candidatos por linea. % (umbral 0,6) usa los indices trigram; similarity >= 0.6
  -- sigue como el filtro de 19d, calculada una sola vez por par (lateral con offset 0,
  -- que el planner no aplana): invoice_match_norm(name) es una regexp por fila.
  with input as (
    select
      t.ord::integer as ordinal,
      left(btrim(coalesce(t.txt, '')), 500) as txt,
      left(btrim(coalesce(p_descriptions[t.ord], t.txt, '')), 500) as descr
    from unnest(v_texts) with ordinality as t(txt, ord)
  ), by_alias as (
    select i.ordinal, a.product_id, s.score, 'alias'::text as via
    from input i
    join public.supplier_product_aliases a
      on a.store_id = v_store_id
     and a.supplier_id = v_supplier_id
     and a.alias_norm % i.txt
    join public.products p
      on p.id = a.product_id
     and p.store_id = v_store_id
    cross join lateral (select similarity(a.alias_norm, i.txt) as score offset 0) s
    where i.txt <> ''
      and s.score >= 0.6
  ), by_name as (
    select i.ordinal, p.id as product_id, s.score, 'name'::text as via
    from input i
    join public.products p
      on p.store_id = v_store_id
     and p.is_active
     and public.invoice_match_norm(p.name) % i.descr
    cross join lateral (select similarity(public.invoice_match_norm(p.name), i.descr) as score offset 0) s
    where i.descr <> ''
      and s.score >= 0.6
  ), best as (
    select distinct on (u.ordinal, u.product_id) u.*
    from (select * from by_alias union all select * from by_name) u
    order by u.ordinal, u.product_id, u.score desc, (u.via = 'alias') desc
  ), top_n as (
    select b.*,
           row_number() over (partition by b.ordinal order by b.score desc, (b.via = 'alias') desc, b.product_id) as rn
    from best b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ordinal', n.ordinal,
           'product_id', n.product_id,
           'score', round(n.score::numeric, 4),
           'via', n.via
         ) order by n.ordinal, n.rn), '[]'::jsonb)
  into v_lines
  from top_n n
  where n.rn <= v_limit;

  return jsonb_build_object(
    'suppliers', v_suppliers,
    'supplier_id', v_supplier_id,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.invoice_match_candidates(text, text, text[], text[], uuid, integer) from public, anon;
grant execute on function public.invoice_match_candidates(text, text, text[], text[], uuid, integer)
  to authenticated, service_role;

-- 5. save_invoice_scan_match (REP7-04, QA REP7-01 F2) ---------------------------------
--
-- Tras un MATCH_ERROR (D35) la fila queda 'extracted' con matched = '{}'. El reintento
-- de la misma foto sale del cache y re-empareja, pero solo complete_invoice_scan
-- escribia matched (y exige el intento 'processing' vigente): el detalle seguia con
-- matched null y la revision no se podia retomar. Esta RPC guarda SOLO matched de un
-- escaneo 'extracted' de la tienda: no cambia el estado, ni las paginas cobradas, ni
-- la lectura. Como las demas escrituras de invoice_scans (20261019i): security
-- definer, search_path vacio, execute solo service_role; la tienda la pone el BFF
-- desde la sesion. Vacio si la fila no es de la tienda o ya no esta 'extracted'.

create or replace function public.save_invoice_scan_match(
  p_store_id uuid,
  p_id uuid,
  p_matched jsonb
)
returns setof public.invoice_scans
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_store_id is null or p_id is null
     or jsonb_typeof(p_matched) is distinct from 'object'
     or p_matched = '{}'::jsonb then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  return query
  with done as (
    update public.invoice_scans s
    set matched = p_matched
    where s.id = p_id
      and s.store_id = p_store_id
      and s.status = 'extracted'
    returning s.*
  )
  select * from done;
end;
$$;

revoke all on function public.save_invoice_scan_match(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_invoice_scan_match(uuid, uuid, jsonb) to service_role;

commit;

notify pgrst, 'reload schema';
