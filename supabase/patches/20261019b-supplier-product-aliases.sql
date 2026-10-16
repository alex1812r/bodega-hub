-- =============================================================================
-- 20261019b — alias de producto por proveedor y aprendizaje del escaneo de
--             facturas (SCN-04b; plan factura-escaneo §3 "Aprendizaje", §4,
--             §5.2 SCN-04 / SCN-06; caos 6.10 y 6.14)
-- Proyecto: BodegaHub
-- Requiere: 20260716-multi-store.sql (store_id en contacts / products /
--           purchases, current_user_store_id), 20261006a (assert_store_context
--           con perfil activo). Se aplica DESPUES de 20261019a-invoice-scans.sql
--           (orden alfabetico), que es el duenio de public.invoice_scans.
--
--   0. pg_trgm (schema extensions; si ya existe en otro schema se respeta) para
--      el indice gin trigram y similarity() del emparejamiento difuso.
--   1. Fallback de public.invoice_scans: create table if not exists identico a
--      §4 + supplier_id. Si 20261019a ya la creo, no hace nada. Sin politicas
--      (son de 19a); solo se habilita RLS, que sin politicas niega todo, para
--      que la rama sola no deje la tabla abierta por PostgREST.
--   2. public.supplier_product_aliases (§4 + updated_at): un alias normalizado
--      por (tienda, proveedor). Lectura por RLS para la tienda con
--      purchases.view; sin escritura directa para authenticated (solo RPC).
--   3. claim_invoice_scan(p_scan_id, p_client_request_id) -> 'claimed' |
--      'replay': reclamo atomico del escaneo ANTES de create_purchase (un
--      unico UPDATE condicional; caduca a los 5 min). release_invoice_scan_claim
--      (mismos args) lo suelta si create_purchase fue rechazada.
--      confirm_invoice_scan(p_scan_id, p_purchase_id, p_confirmed,
--      p_client_request_id) -> boolean: marca el escaneo confirmado con la
--      compra creada si el reclamo es de ese intento y lo limpia; true si
--      confirmo en esta llamada, false en el replay con la misma compra.
--      (SCN-06-F1: la firma vieja (uuid, uuid, jsonb) void se elimina.)
--   4. learn_invoice_aliases(p_scan_id, p_lines): upsert de alias desde un
--      escaneo confirmado. Mismo producto -> hits + 1; producto distinto ->
--      REASIGNA el mismo registro con hits = 1 (caos 6.10). Devuelve las filas
--      aprendidas.
--
-- Permisos (espejo de la matriz de @bodega/core/permissions y de las RPC de
-- compras, que en SQL miran el rol como create_purchase):
--   purchases.create = rol admin | almacen
--   purchases.view   = rol admin | almacen | contador
--
-- Errores (src/lib/supabase/errors.ts mapea PT4xx a HTTP):
--   PT403 'No autorizado para confirmar escaneos de facturas'  (claim / release / confirm)
--   PT403 'No autorizado para aprender alias de facturas'      (learn)
--   PT404 'Escaneo no encontrado'          (no existe o es de otra tienda)
--   PT404 'Compra no encontrada'           (confirm: no existe o es de otra tienda)
--   PT409 'El escaneo ya fue confirmado'   (confirm con OTRA compra)
--   PT409 'El escaneo no está disponible'  (claim / confirm de un escaneo discarded/failed)
--   PT409 'El escaneo ya fue confirmado'   (claim: confirmado con la compra de otra clave)
--   PT409 'El escaneo se está confirmando en otra compra' (claim: reclamo vigente de
--         otra clave; confirm sin el reclamo de su clave)
--   PT400 'Falta la clave del intento de compra' (claim sin p_client_request_id)
--   PT409 'El escaneo no está confirmado'  (learn sobre escaneo sin confirmar)
--   PT409 'La compra no corresponde a este intento' (confirm: purchases.client_request_id
--         distinto de p_client_request_id; SCN-06-F2 M1; o compra creada antes del
--         reclamo del escaneo: compra VIEJA de la misma clave; SCN-06-F3)
--   PT409 'La compra ya está ligada a otro escaneo' (confirm: otra fila de invoice_scans
--         ya apunta a esa compra; SCN-06-F2 M1)
--   PT400 'Confirmación demasiado grande' (confirm: pg_column_size(p_confirmed) > 256 KB
--         o mas de 500 lineas; SCN-06-F2 M2)
--   PT400 'Confirmación inválida' / 'Líneas de alias inválidas' /
--         'Alias inválido en la línea %s' / 'Producto inválido en la línea %s' /
--         'Unidades por empaque inválidas en la línea %s' /
--         'Etiqueta de empaque inválida en la línea %s'
--
-- learn_invoice_aliases: una linea cuyo product_id no es un producto de la
-- tienda del escaneo se IGNORA (no cuenta en el resultado): el producto pudo
-- borrarse entre la compra y el aprendizaje y aprender el resto es mejor que
-- perderlo todo; nunca se escribe un alias hacia un producto ajeno. Una linea
-- MAL FORMADA (alias vacio / > 200, product_id que no es uuid,
-- units_per_pack no entero positivo) es un error del BFF: PT400 y no se
-- aprende nada.
--
-- SCN-06-F2 (caos ronda 1: A1, M1, M2):
--   * alias_norm debe llegar en la FORMA CANONICA de normalizeAlias
--     (@bodega/core/invoice): minusculas, sin espacios en los bordes, sin
--     espacios dobles, sin puntuacion ASCII ni caracteres de control. Si no,
--     PT400 'Alias inválido en la línea %s' (un alias sin normalizar nunca
--     coincidiria y solo ensucia la tabla).
--   * learn_invoice_aliases aprende UNA sola vez por escaneo (columna
--     invoice_scans.learned_at): la segunda llamada es un no-op que devuelve 0.
--     No se exige ademas la clave del intento: la llamada solo vale tras el
--     confirm de ese intento y una vez; la clave de la compra es legible por la
--     tienda, asi que pedirla no anadiria proteccion real.
--   * Mismo producto: una clave de empaque PRESENTE en la linea (units_per_pack
--     o pack_label, aunque sea null) SOBRESCRIBE el valor del alias; una clave
--     AUSENTE lo conserva. El BFF manda siempre las claves (null en modo
--     unidad) y las omite solo cuando el empaque de la linea no coincide con el
--     item de la compra. Producto distinto: se reasigna con lo que traiga.
--   * confirm_invoice_scan exige que la compra sea la de ESTE intento
--     (purchases.client_request_id = p_client_request_id) y que ningun otro
--     escaneo apunte ya a ella; limita p_confirmed a 256 KB y 500 lineas.
--
-- SCN-06-F3 (caos M1 residual): la clave de una compra VIEJA sin escaneo junto a
-- un escaneo nuevo pasaba (create_purchase devuelve la compra vieja y su clave
-- coincide). confirm_invoice_scan exige ademas purchases.created_at >=
-- invoice_scans.claim_started_at - 1 s (ambos now() de este servidor: el reclamo
-- se confirma antes de que empiece create_purchase; el segundo es margen). Para
-- que un doble clic del MISMO intento no mueva ese momento por delante de su
-- propia compra, claim_invoice_scan conserva claim_started_at cuando el reclamo
-- ya es de esa clave (INT-01: claimed_at, la caducidad, si se renueva).
--
-- SCN-06-F4 (caos ronda 2, M-n2): con learned_at null (el BFF aprendio 0) la RPC
-- por PostgREST aceptaba cualquier alias, hacia cualquier producto de la tienda y
-- con cualquier units_per_pack. Ahora learn_invoice_aliases solo aprende una
-- linea si:
--   * (alias_norm, product_id) esta en invoice_scans.confirmed->'lines'
--     (aliasNorm, productId): el JSON que el BFF guardo en confirm con
--     normalizeAlias(rawText) del escaneo. Se liga al confirmado y no a
--     extracted->'lines' por line_index porque normalizeAlias (NFKD en JS) no
--     tiene equivalente exacto en SQL (invoice_match_norm diverge, caos B-n7):
--     una igualdad de texto contra lo que el propio BFF guardo es exacta.
--   * product_id esta entre los purchase_items de scan.purchase_id.
--   * Empaque: units_per_pack no nulo solo se aprende si hay un purchase_item
--     del producto en entry_mode 'pack' con ese mismo units_per_pack, y la
--     etiqueta se toma de ESE item (left(btrim(pack_label), 100)), no de la
--     linea. units_per_pack null (modo unidad, A1) solo si hay un item del
--     producto en modo unidad. Si no coincide: la linea se aprende SIN claves
--     de empaque (mismo producto conserva el empaque que tenia; alias nuevo o
--     reasignado queda sin empaque). Mismo criterio que el BFF (M3).
--     Ojo: un producto que ES el empaque (receta PRO-12) se guarda en
--     purchase_items en modo unidad, asi que su tamano no se aprende.
--   * learned_at se fija en la primera llamada aunque no se aprenda ninguna
--     linea (tambien con p_lines = [] o compra sin proveedor), y el BFF llama
--     siempre, tambien con []: no queda ventana abierta tras el confirm.
--   * OJO: el contenido de invoice_scans.confirmed sigue siendo TEXTO DEL
--     USUARIO (rawText de la factura, etiquetas de empaque). Los few-shot de
--     SCN-01 deben tratarlo como datos, nunca como instrucciones.
--
-- INT-01 (integracion Extraccion + Emparejamiento):
--   * caos-5 B4: claim_invoice_scan renueva claimed_at en CADA reclamo, tambien
--     el de la misma clave (antes lo conservaba y un reintento pasados 5 min
--     quedaba sin proteccion frente a discard_invoice_scan de 19k y a otra
--     clave). El momento del primer reclamo de la clave pasa a la columna
--     claim_started_at, que es contra la que confirm compara la compra
--     (SCN-06-F3: un doble clic o un reintento del mismo intento no mueve ese
--     momento por delante de su propia compra). release y confirm la limpian.
--   * D10: p_confirmed debe ser { extraction: objeto con lines array, lines:
--     array }; la forma vieja (array suelto) es PT400 'Confirmación inválida'.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. pg_trgm
-- -----------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. FALLBACK de public.invoice_scans (duenio: 20261019a-invoice-scans.sql).
--    Identico a §4 del plan mas supplier_id. Existe solo para que esta rama
--    funcione sola; si 19a ya la creo, este create no hace nada.
-- -----------------------------------------------------------------------------

create table if not exists public.invoice_scans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  image_sha256 text not null, storage_path text not null, pages integer not null default 1,
  provider text not null, model text not null,
  input_tokens integer, output_tokens integer, duration_ms integer,
  extracted jsonb not null, matched jsonb not null,
  confirmed jsonb, purchase_id uuid references public.purchases(id),
  status text not null default 'extracted' check (status in ('extracted','confirmed','discarded','failed')),
  error text, created_at timestamptz not null default now(), confirmed_at timestamptz,
  supplier_id uuid references public.contacts(id),
  unique (store_id, image_sha256)
);

-- Sin politicas = nadie lee ni escribe por PostgREST hasta que 19a ponga las suyas.
alter table public.invoice_scans enable row level security;

-- Reclamo del intento que confirma el escaneo (SCN-06-F1, seccion 3). Aditivo
-- e idempotente: vale para la tabla de 19a y para este fallback.
alter table public.invoice_scans
  add column if not exists claim_request_id uuid,
  add column if not exists claimed_at timestamptz,
  -- INT-01: primer reclamo de la clave vigente (SCN-06-F3 compara la compra contra
  -- este momento; claimed_at se renueva en cada reclamo y solo mide la caducidad).
  add column if not exists claim_started_at timestamptz,
  -- SCN-06-F2 M2: momento del (unico) aprendizaje de alias del escaneo.
  add column if not exists learned_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2. supplier_product_aliases
-- -----------------------------------------------------------------------------

create table if not exists public.supplier_product_aliases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid not null references public.contacts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  alias_norm text not null,               -- texto literal normalizado (normalizeAlias de @bodega/core)
  pack_label text, units_per_pack integer check (units_per_pack is null or units_per_pack > 0),
  hits integer not null default 1, last_seen_at timestamptz not null default now(),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_product_aliases_store_supplier_alias_key unique (store_id, supplier_id, alias_norm)
);

alter table public.supplier_product_aliases
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_supplier_product_aliases_store_supplier
  on public.supplier_product_aliases (store_id, supplier_id);

-- El opclass vive en el schema donde este instalado pg_trgm (extensions en
-- Supabase; public si alguien lo instalo antes ahi).
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
    'create index if not exists idx_supplier_product_aliases_alias_trgm '
    'on public.supplier_product_aliases using gin (alias_norm %I.gin_trgm_ops)',
    v_schema
  );
end;
$$;

alter table public.supplier_product_aliases enable row level security;

drop policy if exists "Purchases viewers read supplier product aliases" on public.supplier_product_aliases;
create policy "Purchases viewers read supplier product aliases"
on public.supplier_product_aliases for select
to authenticated
using (
  store_id = public.current_user_store_id()
  and coalesce(public.current_user_role()::text, '') in ('admin', 'almacen', 'contador')
);

revoke all on public.supplier_product_aliases from public, anon, authenticated;
grant select on public.supplier_product_aliases to authenticated;
grant all on public.supplier_product_aliases to service_role;

-- -----------------------------------------------------------------------------
-- 3. Reclamo atomico del escaneo y confirm_invoice_scan (SCN-06-F1)
--
--    POST /api/purchases reclama el escaneo ANTES de create_purchase con un
--    unico UPDATE condicional: de N intentos concurrentes con claves distintas
--    solo uno pasa (los demas esperan el bloqueo de fila y reevaluan el WHERE).
--    El reclamo caduca a los 5 minutos (intento caido sin liberar).
-- -----------------------------------------------------------------------------

create or replace function public.claim_invoice_scan(
  p_scan_id uuid,
  p_client_request_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_scan public.invoice_scans;
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para confirmar escaneos de facturas';
  end if;

  if p_client_request_id is null then
    raise exception using errcode = 'PT400', message = 'Falta la clave del intento de compra';
  end if;

  update public.invoice_scans s
  set claim_request_id = p_client_request_id,
      -- INT-01 (caos-5 B4): cada reclamo, también el re-reclamo de la misma clave,
      -- renueva la caducidad de 5 min; un reintento pasado ese plazo vuelve a
      -- quedar protegido frente al descarte (19k) y a otra clave.
      claimed_at = now(),
      -- SCN-06-F3: el mismo intento conserva el momento de su primer reclamo, que es
      -- contra el que confirm compara la compra.
      claim_started_at = case
        when s.claim_request_id = p_client_request_id and s.claim_started_at is not null then s.claim_started_at
        else now()
      end
  where s.id = p_scan_id
    and s.store_id = v_store_id
    and s.status = 'extracted'
    and (
      s.claim_request_id is null
      or s.claim_request_id = p_client_request_id
      or s.claimed_at is null
      or s.claimed_at < now() - interval '5 minutes'
    );

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return 'claimed';
  end if;

  select s.*
  into v_scan
  from public.invoice_scans s
  where s.id = p_scan_id
    and s.store_id = v_store_id;

  if v_scan.id is null then
    raise exception using errcode = 'PT404', message = 'Escaneo no encontrado';
  end if;

  if v_scan.status = 'confirmed' then
    -- Replay: la compra que esta tienda ya creo con la misma clave.
    if exists (
      select 1
      from public.purchases p
      where p.id = v_scan.purchase_id
        and p.store_id = v_store_id
        and p.client_request_id = p_client_request_id
    ) then
      return 'replay';
    end if;
    raise exception using errcode = 'PT409', message = 'El escaneo ya fue confirmado';
  end if;

  if v_scan.status <> 'extracted' then
    raise exception using errcode = 'PT409', message = 'El escaneo no está disponible';
  end if;

  raise exception using errcode = 'PT409', message = 'El escaneo se está confirmando en otra compra';
end;
$$;

revoke all on function public.claim_invoice_scan(uuid, uuid) from public, anon;
grant execute on function public.claim_invoice_scan(uuid, uuid) to authenticated, service_role;

-- Suelta el reclamo del mismo intento si create_purchase fue rechazada. No-op si
-- el escaneo ya no esta reclamado por esa clave (otro intento o confirmado).
create or replace function public.release_invoice_scan_claim(
  p_scan_id uuid,
  p_client_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para confirmar escaneos de facturas';
  end if;

  update public.invoice_scans s
  set claim_request_id = null,
      claimed_at = null,
      claim_started_at = null
  where s.id = p_scan_id
    and s.store_id = v_store_id
    and s.status = 'extracted'
    and s.claim_request_id = p_client_request_id;
end;
$$;

revoke all on function public.release_invoice_scan_claim(uuid, uuid) from public, anon;
grant execute on function public.release_invoice_scan_claim(uuid, uuid) to authenticated, service_role;

-- Firma vieja (uuid, uuid, jsonb) returns void: no exigia el reclamo.
drop function if exists public.confirm_invoice_scan(uuid, uuid, jsonb);

create or replace function public.confirm_invoice_scan(
  p_scan_id uuid,
  p_purchase_id uuid,
  p_confirmed jsonb,
  p_client_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_scan public.invoice_scans;
  v_supplier_id uuid;
  v_purchase_key uuid;
  v_purchase_created_at timestamptz;
  v_lines jsonb;
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para confirmar escaneos de facturas';
  end if;

  -- SCN-06-F2 M2: tope de tamano y de lineas de la "verdad" de la capa 2 (su
  -- contenido sigue siendo texto del usuario; ver la cabecera).
  if p_confirmed is not null then
    if pg_column_size(p_confirmed) > 262144 then
      raise exception using errcode = 'PT400', message = 'Confirmación demasiado grande';
    end if;

    v_lines := case jsonb_typeof(p_confirmed)
      when 'object' then p_confirmed -> 'lines'
    end;

    if jsonb_typeof(v_lines) = 'array' and jsonb_array_length(v_lines) > 500 then
      raise exception using errcode = 'PT400', message = 'Confirmación demasiado grande';
    end if;
  end if;

  select s.*
  into v_scan
  from public.invoice_scans s
  where s.id = p_scan_id
    and s.store_id = v_store_id
  for update;

  if v_scan.id is null then
    raise exception using errcode = 'PT404', message = 'Escaneo no encontrado';
  end if;

  select p.supplier_id, p.client_request_id, p.created_at
  into v_supplier_id, v_purchase_key, v_purchase_created_at
  from public.purchases p
  where p.id = p_purchase_id
    and p.store_id = v_store_id;

  if not found then
    raise exception using errcode = 'PT404', message = 'Compra no encontrada';
  end if;

  if v_scan.status = 'confirmed' then
    if v_scan.purchase_id = p_purchase_id then
      return false; -- replay idempotente del mismo hook: el BFF no vuelve a aprender
    end if;
    raise exception using errcode = 'PT409', message = 'El escaneo ya fue confirmado';
  end if;

  if v_scan.status <> 'extracted' then
    raise exception using errcode = 'PT409', message = 'El escaneo no está disponible';
  end if;

  -- Solo confirma el intento que tiene el reclamo (claim_invoice_scan).
  if p_client_request_id is null or v_scan.claim_request_id is distinct from p_client_request_id then
    raise exception using errcode = 'PT409', message = 'El escaneo se está confirmando en otra compra';
  end if;

  -- D10 (INT-01): { extraction: InvoiceExtraction corregida, lines: [...] }. Ya no
  -- se admite la forma vieja (array de lineas): la lee parseConfirmedScan y el few-shot.
  if p_confirmed is null
     or jsonb_typeof(p_confirmed) <> 'object'
     or jsonb_typeof(p_confirmed -> 'extraction') is distinct from 'object'
     or jsonb_typeof(p_confirmed -> 'extraction' -> 'lines') is distinct from 'array'
     or jsonb_typeof(p_confirmed -> 'lines') is distinct from 'array' then
    raise exception using errcode = 'PT400', message = 'Confirmación inválida';
  end if;

  -- SCN-06-F2 M1: la compra debe ser la que creo ESTE intento. Si la clave ya
  -- habia creado otra compra, create_purchase la devolvio por idempotencia y no
  -- describe esta factura. El candado serializa dos escaneos contra la misma compra.
  perform pg_advisory_xact_lock(hashtextextended('invoice_scan_purchase:' || p_purchase_id::text, 0));

  -- SCN-06-F3: y creada DESPUES del reclamo de este escaneo; una compra anterior es
  -- una compra vieja de la misma clave devuelta por idempotencia.
  if v_purchase_key is distinct from p_client_request_id
     or v_scan.claim_started_at is null
     or v_purchase_created_at < v_scan.claim_started_at - interval '1 second' then
    raise exception using errcode = 'PT409', message = 'La compra no corresponde a este intento';
  end if;

  if exists (
    select 1
    from public.invoice_scans s
    where s.purchase_id = p_purchase_id
      and s.id <> p_scan_id
  ) then
    raise exception using errcode = 'PT409', message = 'La compra ya está ligada a otro escaneo';
  end if;

  update public.invoice_scans s
  set status = 'confirmed',
      confirmed = p_confirmed,
      purchase_id = p_purchase_id,
      confirmed_at = now(),
      claim_request_id = null,
      claimed_at = null,
      claim_started_at = null
  where s.id = p_scan_id
    and s.status = 'extracted';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using errcode = 'PT409', message = 'El escaneo no está disponible';
  end if;

  -- supplier_id lo trae este fallback; 20261019a podria no tenerlo.
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'invoice_scans'
      and c.column_name = 'supplier_id'
  ) then
    execute 'update public.invoice_scans set supplier_id = $1 where id = $2'
      using v_supplier_id, p_scan_id;
  end if;

  return true;
end;
$$;

revoke all on function public.confirm_invoice_scan(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.confirm_invoice_scan(uuid, uuid, jsonb, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. learn_invoice_aliases
-- -----------------------------------------------------------------------------

create or replace function public.learn_invoice_aliases(
  p_scan_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_scan public.invoice_scans;
  v_supplier_id uuid;
  v_created_by uuid;
  v_line jsonb;
  v_ord bigint;
  v_alias text;
  v_product text;
  v_pack_label text;
  v_units jsonb;
  v_row record;
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para aprender alias de facturas';
  end if;

  select s.*
  into v_scan
  from public.invoice_scans s
  where s.id = p_scan_id
    and s.store_id = v_store_id;

  if v_scan.id is null then
    raise exception using errcode = 'PT404', message = 'Escaneo no encontrado';
  end if;

  if v_scan.status <> 'confirmed' or v_scan.purchase_id is null then
    raise exception using errcode = 'PT409', message = 'El escaneo no está confirmado';
  end if;

  select p.supplier_id
  into v_supplier_id
  from public.purchases p
  where p.id = v_scan.purchase_id
    and p.store_id = v_store_id;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 500 then
    raise exception using errcode = 'PT400', message = 'Líneas de alias inválidas';
  end if;

  -- Forma de cada linea. Mal formada = error del BFF: no se aprende nada.
  for v_line, v_ord in
    select e.value, e.ord from jsonb_array_elements(p_lines) with ordinality as e(value, ord)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception using errcode = 'PT400', message = format('Alias inválido en la línea %s', v_ord);
    end if;

    -- Forma canonica de normalizeAlias (SCN-06-F2 M2): sin recortar aqui; un
    -- alias con mayusculas, espacios en bordes o dobles, puntuacion ASCII o
    -- caracteres de control no viene del BFF.
    v_alias := v_line ->> 'alias_norm';
    if v_alias is null or v_alias = '' or length(v_alias) > 200
       or v_alias <> btrim(v_alias)
       or v_alias <> lower(v_alias)
       or position('  ' in v_alias) > 0
       or v_alias ~ '[]!"#$%&''()*+,./:;<=>?@[\\^_`{|}~-]'
       or v_alias ~ '[[:cntrl:]]'
       or position(chr(160) in v_alias) > 0 then
      raise exception using errcode = 'PT400', message = format('Alias inválido en la línea %s', v_ord);
    end if;

    v_product := v_line ->> 'product_id';
    if v_product is null
       or v_product !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'PT400', message = format('Producto inválido en la línea %s', v_ord);
    end if;

    v_units := v_line -> 'units_per_pack';
    if v_units is not null and jsonb_typeof(v_units) <> 'null' then
      if jsonb_typeof(v_units) <> 'number'
         or (v_units #>> '{}')::numeric <> trunc((v_units #>> '{}')::numeric)
         or (v_units #>> '{}')::numeric <= 0
         or (v_units #>> '{}')::numeric > 100000 then
        raise exception using errcode = 'PT400', message = format('Unidades por empaque inválidas en la línea %s', v_ord);
      end if;
    end if;

    if v_line ? 'pack_label' and jsonb_typeof(v_line -> 'pack_label') not in ('string', 'null') then
      raise exception using errcode = 'PT400', message = format('Etiqueta de empaque inválida en la línea %s', v_ord);
    end if;
    v_pack_label := btrim(v_line ->> 'pack_label');
    if v_pack_label is not null and length(v_pack_label) > 100 then
      raise exception using errcode = 'PT400', message = format('Etiqueta de empaque inválida en la línea %s', v_ord);
    end if;
  end loop;

  select pr.id
  into v_created_by
  from public.profiles pr
  where pr.id = auth.uid();

  -- SCN-06-F2 M2: una sola vez por escaneo. UPDATE condicional atomico: de dos
  -- llamadas concurrentes solo una pasa; la otra (o cualquier repeticion) es un
  -- no-op que devuelve 0. Si el upsert falla, la transaccion revierte learned_at.
  update public.invoice_scans s
  set learned_at = now()
  where s.id = p_scan_id
    and s.learned_at is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 0;
  end if;

  -- SCN-06-F4: learned_at ya quedo fijado; sin proveedor no hay donde aprender.
  if v_supplier_id is null then
    return 0;
  end if;

  -- Dedup dentro de p_lines (gana la ultima linea de cada alias) y productos de
  -- otra tienda fuera. Un upsert por alias para conocer si la linea trae cada
  -- clave de empaque (A1): presente (aunque sea null) sobrescribe; ausente conserva.
  -- SCN-06-F4 (M-n2): solo lineas del confirmado del escaneo cuyo producto esta en
  -- los purchase_items de la compra; el empaque sale del item (ver cabecera).
  v_rows := 0;
  for v_row in
    select
      l.alias_norm,
      l.product_id,
      case when coalesce(pk.found, false) then pk.pack_label end as pack_label,
      (l.units_key = 'number' and coalesce(pk.found, false))
        or (l.units_key = 'null' and coalesce(un.found, false)) as has_pack_label,
      case when coalesce(pk.found, false) then l.units_per_pack end as units_per_pack,
      (l.units_key = 'number' and coalesce(pk.found, false))
        or (l.units_key = 'null' and coalesce(un.found, false)) as has_units_per_pack
    from (
      select distinct on (e.value ->> 'alias_norm')
        e.value ->> 'alias_norm' as alias_norm,
        (e.value ->> 'product_id')::uuid as product_id,
        case
          when jsonb_typeof(e.value -> 'units_per_pack') = 'number'
            then (e.value ->> 'units_per_pack')::numeric::integer
        end as units_per_pack,
        coalesce(jsonb_typeof(e.value -> 'units_per_pack'), 'absent') as units_key
      from jsonb_array_elements(p_lines) with ordinality as e(value, ord)
      order by e.value ->> 'alias_norm', e.ord desc
    ) l
    join public.products pr
      on pr.id = l.product_id
     and pr.store_id = v_store_id
    left join lateral (
      select true as found, nullif(left(btrim(pi.pack_label), 100), '') as pack_label
      from public.purchase_items pi
      where pi.purchase_id = v_scan.purchase_id
        and pi.product_id = l.product_id
        and pi.entry_mode = 'pack'
        and pi.units_per_pack = l.units_per_pack
      order by pi.id
      limit 1
    ) pk on true
    left join lateral (
      select true as found
      from public.purchase_items pi
      where pi.purchase_id = v_scan.purchase_id
        and pi.product_id = l.product_id
        and pi.entry_mode = 'unit'
      limit 1
    ) un on true
    where exists (
        select 1
        from public.purchase_items pi
        where pi.purchase_id = v_scan.purchase_id
          and pi.product_id = l.product_id
      )
      and jsonb_typeof(v_scan.confirmed -> 'lines') = 'array'
      and exists (
        select 1
        from jsonb_array_elements(v_scan.confirmed -> 'lines') c(value)
        where jsonb_typeof(c.value) = 'object'
          and c.value ->> 'aliasNorm' = l.alias_norm
          and lower(c.value ->> 'productId') = l.product_id::text
      )
  loop
    insert into public.supplier_product_aliases as a (
      store_id, supplier_id, product_id, alias_norm, pack_label, units_per_pack,
      hits, last_seen_at, created_by, created_at, updated_at
    )
    values (
      v_store_id, v_supplier_id, v_row.product_id, v_row.alias_norm, v_row.pack_label,
      v_row.units_per_pack, 1, now(), v_created_by, now(), now()
    )
    on conflict (store_id, supplier_id, alias_norm) do update
    set product_id = excluded.product_id,
        hits = case when a.product_id = excluded.product_id then a.hits + 1 else 1 end,
        pack_label = case
          when a.product_id = excluded.product_id and not v_row.has_pack_label then a.pack_label
          else excluded.pack_label
        end,
        units_per_pack = case
          when a.product_id = excluded.product_id and not v_row.has_units_per_pack then a.units_per_pack
          else excluded.units_per_pack
        end,
        last_seen_at = now(),
        updated_at = now();

    v_rows := v_rows + 1;
  end loop;

  return v_rows;
end;
$$;

revoke all on function public.learn_invoice_aliases(uuid, jsonb) from public, anon;
grant execute on function public.learn_invoice_aliases(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. FALLBACK de lectura de public.invoice_scans (SCN-06). El POST de compras
--    lee el escaneo con el cliente del usuario (filtro explicito por tienda)
--    antes de crear la compra. Si 20261019a ya puso sus politicas, este bloque
--    no hace nada: solo actua cuando la tabla NO tiene ninguna politica (la
--    rama sola, con el fallback de la seccion 1). Lectura por tienda para
--    purchases.view (admin | almacen | contador); sin escritura directa.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_scans'
  ) then
    execute $p$
      create policy "Fallback 19b: purchases viewers read invoice scans"
      on public.invoice_scans for select
      to authenticated
      using (
        store_id = public.current_user_store_id()
        and coalesce(public.current_user_role()::text, '') in ('admin', 'almacen', 'contador')
      )
    $p$;
    grant select on public.invoice_scans to authenticated;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
