-- =============================================================================
-- 20261019d — candidatos trigram para emparejar una factura escaneada
--             (SCN-05b; plan factura-escaneo §3 "Emparejamiento" y "Proveedor
--             del documento", §4, §5.2 SCN-05)
-- Proyecto: BodegaHub
-- Requiere: 20260716-multi-store.sql (store_id en contacts / products /
--           supplier_products), 20261006a (assert_store_context con perfil
--           activo), 20261019b-supplier-product-aliases.sql (pg_trgm y
--           public.supplier_product_aliases).
--
--   1. public.invoice_match_norm(text): normalizador SQL de nombres para
--      comparar contra textos ya normalizados con normalizeAlias
--      (@bodega/core/invoice). Diferencias con normalizeAlias:
--        * los acentos se quitan con translate() sobre una tabla fija de
--          letras latinas (aeiou con tilde / dieresis / circunflejo / grave,
--          n con tilde, c cedilla, y), en minuscula y mayuscula. No depende de
--          la extension unaccent (no esta garantizada en todos los proyectos)
--          y es IMMUTABLE. normalizeAlias quita TODA marca combinante (\p{M})
--          de cualquier alfabeto;
--        * "no alfanumerico -> espacio" usa [[:alnum:]] del ctype de la base:
--          con ctype C solo cuenta ASCII, asi que una letra no latina que
--          normalizeAlias conserva aqui se vuelve espacio.
--      Para los nombres de productos y proveedores de una bodega venezolana
--      ambos dan el mismo resultado.
--   2. public.invoice_match_candidates(p_supplier_name, p_supplier_tax_id,
--      p_texts, p_descriptions, p_supplier_id, p_limit) -> jsonb. En UNA
--      llamada, para la tienda del llamante:
--        a. suppliers: contactos activos tipo proveedor / ambos con RIF
--           normalizado igual al leido o similarity(nombre normalizado,
--           p_supplier_name) >= 0,3; maximo 5, RIF igual primero y luego por
--           score. { contact_id, name, tax_id, score, tax_id_match }.
--        b. supplier_id: proveedor cuyos alias se usaron. p_supplier_id si es
--           un proveedor/ambos activo de la tienda; si no, el UNICO contacto
--           con RIF igual; si no, el de mejor score. NULL si no hay ninguno.
--        c. lines: por cada texto (ordinal 1-based), hasta p_limit (<= 5)
--           candidatos con score >= 0,6, uno por producto (el mejor; empate ->
--           alias): { ordinal, product_id, score, via }.
--             via 'alias': similarity(alias_norm, p_texts[i]) sobre los alias
--               del proveedor (b) cuyo producto es de la tienda.
--             via 'name': similarity(invoice_match_norm(products.name),
--               p_descriptions[i] o, si falta, p_texts[i]) sobre productos
--               ACTIVOS de la tienda.
--      p_texts / p_descriptions llegan ya normalizados con normalizeAlias; el
--      alias guardado sale del rawText, por eso el alias se compara con
--      p_texts (rawText) y el nombre con la descripcion, que no trae
--      cantidades ni precios.
--
-- Security definer: la consulta cruza contacts, products y
-- supplier_product_aliases en una sola llamada y debe dar el mismo resultado
-- sin depender de las politicas de cada tabla (que cambian por modulo). El
-- aislamiento lo da el filtro explicito store_id = assert_store_context() en
-- TODAS las tablas, y el rol (purchases.create = admin | almacen) se verifica
-- antes de leer nada. search_path = public, extensions: similarity() se
-- resuelve donde este instalado pg_trgm (extensions en Supabase; public si ya
-- estaba ahi, ver 20261019b); ambos schemas son de superusuario.
--
-- Errores (src/lib/supabase/errors.ts mapea PT4xx a HTTP):
--   42501 sin tienda activa (assert_store_context)
--   PT403 'No autorizado para emparejar facturas'
--   PT400 'Líneas de factura inválidas' (mas de 500 textos, o p_descriptions
--         con distinto largo que p_texts)
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. invoice_match_norm
-- -----------------------------------------------------------------------------

create or replace function public.invoice_match_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          coalesce(p_text, ''),
          'áàâäãåéèêëíìîïóòôöõúùûüñçýÿÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇÝ',
          'aaaaaaeeeeiiiiooooouuuuncyyAAAAAAEEEEIIIIOOOOOUUUUNCY'
        )
      ),
      '[^[:alnum:]]+',
      ' ',
      'g'
    )
  );
$$;

revoke all on function public.invoice_match_norm(text) from public, anon;
grant execute on function public.invoice_match_norm(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. invoice_match_candidates
-- -----------------------------------------------------------------------------

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
as $$
declare
  v_store_id uuid;
  v_name text := btrim(coalesce(p_supplier_name, ''));
  v_tax_id text;
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

  -- RIF comparable: como normalizeTaxId (match/text.ts).
  v_tax_id := regexp_replace(
    regexp_replace(upper(coalesce(p_supplier_tax_id, '')), '[^A-Z0-9]', '', 'g'),
    '^[JVEGPC]', ''
  );

  -- a. Candidatos de proveedor.
  with scored as (
    select
      c.id,
      c.name,
      c.tax_id,
      case when v_name = '' then 0::real
           else similarity(public.invoice_match_norm(c.name), v_name) end as score,
      v_tax_id <> '' and regexp_replace(
        regexp_replace(upper(coalesce(c.tax_id, '')), '[^A-Z0-9]', '', 'g'),
        '^[JVEGPC]', ''
      ) = v_tax_id as tax_id_match
    from public.contacts c
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

  -- c. Candidatos por linea.
  with input as (
    select
      t.ord::integer as ordinal,
      left(btrim(coalesce(t.txt, '')), 500) as txt,
      left(btrim(coalesce(p_descriptions[t.ord], t.txt, '')), 500) as descr
    from unnest(v_texts) with ordinality as t(txt, ord)
  ), by_alias as (
    select i.ordinal, a.product_id, similarity(a.alias_norm, i.txt) as score, 'alias'::text as via
    from input i
    join public.supplier_product_aliases a
      on a.store_id = v_store_id
     and a.supplier_id = v_supplier_id
    join public.products p
      on p.id = a.product_id
     and p.store_id = v_store_id
    where i.txt <> ''
      and similarity(a.alias_norm, i.txt) >= 0.6
  ), by_name as (
    select i.ordinal, p.id as product_id,
           similarity(public.invoice_match_norm(p.name), i.descr) as score,
           'name'::text as via
    from input i
    join public.products p
      on p.store_id = v_store_id
     and p.is_active
    where i.descr <> ''
      and similarity(public.invoice_match_norm(p.name), i.descr) >= 0.6
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

commit;

notify pgrst, 'reload schema';
