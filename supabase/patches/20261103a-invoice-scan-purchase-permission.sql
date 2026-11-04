-- =============================================================================
-- 20261103a — escaneo de factura: un único predicado de permiso de compra
--             (REP20-01; caos p21 A M-p21A-1, D78(a)) y purga sin TOCTOU
--             (REP20-02; caos p21 A B-p21A-1, D78(b)); create_purchase con el
--             predicado y purga que respeta el uso (REP20-06; QA REP20-05)
-- Proyecto: BodegaHub
-- Requiere: 20261010d (o deploy/ux-mejoras-01-antes-del-bff.sql), 20261019a,
--           20261019b, 20261019c, 20261019k, 20261019m, 20261019o, 20261019q y
--           20261026a. Se aplica DESPUÉS de todos ellos (fila 12 del orden de
--           docs/factura-escaneo.md) y ANTES del BFF de REP20-01/02/06 (la purga
--           del BFF filtra por last_used_at, que crea §8).
-- =============================================================================
-- El BFF autoriza el escaneo con los permisos efectivos (getEffectivePermissions
-- de @bodega/core/permissions: rol + granted_permissions − denied_permissions),
-- pero las RPC del módulo miraban solo el rol (admin | almacen). Un vendedor o
-- contador con purchases.create CONCEDIDO pasaba la ruta, reserve_invoice_scan
-- cobraba la página, el modelo leía la factura y el emparejamiento respondía
-- PT403; el descarte no miraba ni el rol ni quién creó el escaneo.
--
-- 1. user_can_create_purchase(p_user_id) -> boolean: EL predicado. Mismo cálculo
--    que getEffectivePermissions para purchases.create: perfil activo; admin
--    siempre (ignora las excepciones por usuario); almacén salvo denegación;
--    vendedor y contador solo con la concesión y sin denegación; superadmin
--    nunca. Solo service_role.
--    current_user_can_create_purchase() -> boolean: el mismo predicado para el
--    usuario del JWT (auth.uid()); execute authenticated / service_role.
-- 2. RLS de lectura de invoice_scans (19a) y supplier_product_aliases (19b): los
--    roles de antes O el predicado. Con la concesión el vendedor lee su escaneo
--    (reintento en caché, antes 409) y los alias que usa el emparejamiento.
-- 3. reserve_invoice_scan (copia de 19k): PT403 'No autorizado para escanear
--    facturas' si p_user_id no tiene el permiso, ANTES del lock, la caché, la
--    cuota y la reserva; el BFF responde 403 sin cobrar ni llamar al modelo.
-- 4. discard_invoice_scan_by_user(p_store_id, p_id, p_user_id) (nueva, solo service_role):
--    el descarte del usuario. PT403 sin el permiso o fuera de la tienda; PT403
--    si no es quien creó el escaneo (created_by) ni un admin de la tienda; si
--    pasa, delega en discard_invoice_scan(p_store_id, p_id) (19m), que sigue
--    siendo el reemplazo interno de una lectura en caché fuera del contrato.
-- 5. Cambia SOLO la comprobación de rol por el predicado (mismos mensajes,
--    firmas, retornos y grants) en: claim_invoice_scan (copia de 19m) y
--    release_invoice_scan_claim (copia de 19o), que pierden su bloque propio de
--    denegación del almacén (lo cubre el predicado); confirm_invoice_scan y
--    learn_invoice_aliases (copia de 19b); invoice_match_exact_aliases,
--    invoice_match_barcode_products e invoice_match_candidates (copia de 19q);
--    invoice_duplicate_candidates e invoice_match_previous_scans (copia de 26a).
-- 6. Purga (REP20-02, B-p21A-1): el cron borra primero las filas, con created_at
--    comprobado en el mismo DELETE (BFF), y sus imágenes pasan a la fase de
--    huérfanos. Tabla invoice_scan_upload_grants (sin acceso para anon /
--    authenticated): por carpeta <store>/<sha>, la última URL de subida emitida y
--    la reserva de la purga.
--    record_invoice_scan_upload(p_store_id, p_sha256) (nueva, solo service_role):
--    upload-url la anota ANTES de mirar el bucket, y el POST del escaneo antes de
--    leer o escribir la carpeta; false (el BFF da 503 sin firmar, leer ni reservar)
--    si la purga tiene la carpeta reservada (< 15 min).
--    list_expired_invoice_scan_objects (redefine la de 19c, misma firma): excluye
--    la carpeta de CUALQUIER fila y la de una URL emitida en 24 h, y reserva lo que
--    devuelve en la misma sentencia; la fila de la carpeta serializa reserva y
--    anotación. Antes limpia anotaciones de más de 24 h y reservas de más de 15 min.
--    release_invoice_scan_object_claims(p_names) (nueva, solo service_role): el
--    cron suelta la reserva tras borrar de Storage.
-- 7. create_purchase (copia íntegra de 20261010d, REP20-06 M-q2005-1): cambia SOLO la
--    comprobación de rol por current_user_can_create_purchase() (mismo mensaje
--    'No autorizado para crear compras', firma de 14 argumentos, retorno y grants).
--    Con la concesión, vendedor y contador registran la compra del escaneo; el
--    almacén con purchases.create denegado recibe PT403, como en la app.
-- 8. invoice_scans.last_used_at (REP20-06 B-q2005-2): reserve_invoice_scan (§3) lo
--    anota al reabrir desde la caché; la lista y el DELETE de la purga (BFF) dejan
--    fuera la fila con last_used_at o claimed_at posteriores al corte.
--
-- Reaplicación: reaplicar 19a, 19b, 19c, 19k, 19m, 19o, 19q o 26a devuelve su
-- versión con el rol solo (o la política vieja; 19c, la lista sin reserva que
-- borra imágenes reutilizadas): volver a aplicar este parche después y correr
-- verify-patches.sql (filas "(20261103a"). Lo mismo con create_purchase: reaplicar
-- 20261010d (o deploy/ux-mejoras-01-antes-del-bff.sql, o cualquier parche de su
-- cadena que obligue a reaplicar 20261010d) la devuelve con el rol solo.
--
-- Idempotente (create or replace / if not exists / drop policy if exists). No cambia
-- stock ni dinero: §7 redefine create_purchase (RPC de stock) sin tocar su lógica,
-- solo quién la puede llamar.
-- =============================================================================

begin;

-- 1. Predicado de permiso de compra ---------------------------------------------------

create or replace function public.user_can_create_purchase(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select pr.is_active
      and case
        when pr.role::text = 'admin' then true
        when pr.role::text in ('almacen', 'vendedor', 'contador') then
          (pr.role::text = 'almacen' or (pr.granted_permissions ? 'purchases.create'))
          and not (pr.denied_permissions ? 'purchases.create')
        else false
      end
    from public.profiles pr
    where pr.id = p_user_id
  ), false);
$$;

comment on function public.user_can_create_purchase(uuid) is
  'purchases.create efectivo del usuario, como getEffectivePermissions: activo; admin siempre; almacen salvo denegacion; vendedor/contador con concesion y sin denegacion (REP20-01, D78(a)).';

revoke all on function public.user_can_create_purchase(uuid) from public, anon, authenticated;
grant execute on function public.user_can_create_purchase(uuid) to service_role;

create or replace function public.current_user_can_create_purchase()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_can_create_purchase(auth.uid());
$$;

comment on function public.current_user_can_create_purchase() is
  'user_can_create_purchase del usuario del JWT (REP20-01, D78(a)).';

revoke all on function public.current_user_can_create_purchase() from public, anon;
grant execute on function public.current_user_can_create_purchase() to authenticated, service_role;

-- 2. RLS de lectura -------------------------------------------------------------------

drop policy if exists "Purchase viewers read invoice scans" on public.invoice_scans;
create policy "Purchase viewers read invoice scans"
on public.invoice_scans for select
to authenticated
using (
  store_id = public.current_user_store_id()
  and (
    public.current_user_role() in ('admin', 'almacen', 'contador')
    or public.current_user_can_create_purchase()
  )
);

drop policy if exists "Purchases viewers read supplier product aliases" on public.supplier_product_aliases;
create policy "Purchases viewers read supplier product aliases"
on public.supplier_product_aliases for select
to authenticated
using (
  store_id = public.current_user_store_id()
  and (
    coalesce(public.current_user_role()::text, '') in ('admin', 'almacen', 'contador')
    or public.current_user_can_create_purchase()
  )
);

-- 3. reserve_invoice_scan (19k + predicado) -------------------------------------------

create or replace function public.reserve_invoice_scan(
  p_store_id uuid,
  p_user_id uuid,
  p_sha256 text,
  p_storage_path text,
  p_pages integer,
  p_limit integer,
  p_provider text,
  p_model text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'America/Caracas') at time zone 'America/Caracas';
  v_day_end timestamptz;
  v_row public.invoice_scans%rowtype;
  v_exists boolean;
  v_used integer;
  v_id uuid;
  v_attempt_id uuid := gen_random_uuid();
  v_claim_columns text;
begin
  v_day_end := v_day_start + interval '1 day';

  if p_store_id is null or p_user_id is null
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_pages is null or p_pages < 1 or p_pages > 10
     or p_limit is null or p_limit < 0 or p_limit > 10000
     or p_storage_path is null
     or p_storage_path not in (
       p_store_id::text || '/' || p_sha256 || '/p1.jpg',
       p_store_id::text || '/' || p_sha256 || '/p1.png',
       p_store_id::text || '/' || p_sha256 || '/p1.webp'
     ) then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  -- B2 (SCN-03o): el usuario debe ser un perfil activo de la tienda.
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.store_id = p_store_id and p.is_active
  ) then
    raise exception 'El usuario no pertenece a esta tienda.' using errcode = '42501';
  end if;

  -- REP20-01 (M-p21A-1, D78(a)): sin purchases.create efectivo, nada de caché,
  -- cuota ni lectura; el BFF responde 403 antes de llamar al modelo.
  if not public.user_can_create_purchase(p_user_id) then
    raise exception using errcode = 'PT403', message = 'No autorizado para escanear facturas';
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice_scan:' || p_store_id::text));

  select * into v_row
  from public.invoice_scans s
  where s.store_id = p_store_id and s.image_sha256 = p_sha256
  for update;
  v_exists := found;

  -- REP2-03c (D25-c): confirmado en una compra anulada → se libera (extracted, sin
  -- compra ni confirmación) y el reescaneo la sirve como lectura sin compra ligada.
  if v_exists and v_row.status = 'confirmed' and exists (
    select 1 from public.purchases p
    where p.id = v_row.purchase_id and p.store_id = p_store_id and p.status = 'cancelado'
  ) then
    update public.invoice_scans s
    set status = 'extracted', purchase_id = null, confirmed = null, confirmed_at = null
    where s.id = v_row.id and s.status = 'confirmed';

    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.invoice_scans'::regclass
        and a.attname = 'learned_at' and a.attnum > 0 and not a.attisdropped
    ) then
      execute 'update public.invoice_scans s set learned_at = null where s.id = $1' using v_row.id;
    end if;

    v_row.status := 'extracted';
  end if;

  if v_exists and v_row.status in ('extracted', 'confirmed') then
    -- REP20-06 (B-q2005-2): reabrir desde la caché es uso; la purga no lo borra (§8).
    update public.invoice_scans s set last_used_at = now() where s.id = v_row.id;
    return jsonb_build_object('outcome', 'cached', 'id', v_row.id);
  end if;

  if v_exists and v_row.status = 'processing'
     and v_row.created_at > now() - (interval '50 seconds' * v_row.pages + interval '60 seconds') then
    return jsonb_build_object('outcome', 'in_progress', 'id', v_row.id);
  end if;

  select coalesce(sum(s.usage_pages), 0)::integer into v_used
  from public.invoice_scans s
  where s.store_id = p_store_id
    and s.created_at >= v_day_start
    and s.created_at < v_day_end;

  if v_used + p_pages > p_limit then
    return jsonb_build_object('outcome', 'quota', 'used', v_used, 'limit', p_limit);
  end if;

  if v_exists then
    -- N9 (19g): una fila de otro día pasa a hoy con solo este intento.
    update public.invoice_scans s
    set status = 'processing',
        storage_path = p_storage_path,
        pages = p_pages,
        provider = p_provider,
        model = p_model,
        created_by = p_user_id,
        attempt_id = v_attempt_id,
        input_tokens = null,
        output_tokens = null,
        duration_ms = null,
        extracted = '{}'::jsonb,
        matched = '{}'::jsonb,
        error = null,
        usage_pages = case
          when s.created_at >= v_day_start and s.created_at < v_day_end then s.usage_pages + p_pages
          else p_pages
        end,
        created_at = now()
    where s.id = v_row.id
    returning s.id into v_id;

    -- M1 (SCN-03o): el reescaneo no hereda el reclamo de Emparejamiento (19b).
    -- Solo las columnas que existen: sin 19b no hay nada que limpiar.
    select string_agg(format('%I = null', a.attname), ', ' order by a.attname)
    into v_claim_columns
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.invoice_scans'::regclass
      and a.attname in ('claim_request_id', 'claimed_at', 'learned_at')
      and a.attnum > 0
      and not a.attisdropped;

    if v_claim_columns is not null then
      execute format('update public.invoice_scans s set %s where s.id = $1', v_claim_columns) using v_id;
    end if;
  else
    insert into public.invoice_scans (
      store_id, created_by, image_sha256, storage_path, pages, provider, model,
      extracted, matched, status, usage_pages, attempt_id
    )
    values (
      p_store_id, p_user_id, p_sha256, p_storage_path, p_pages, p_provider, p_model,
      '{}'::jsonb, '{}'::jsonb, 'processing', p_pages, v_attempt_id
    )
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'outcome', 'reserved', 'id', v_id, 'attemptId', v_attempt_id,
    'used', v_used + p_pages, 'limit', p_limit
  );
end;
$$;

comment on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) is
  'Reserva atómica (lock por tienda) de un escaneo de factura con intento nuevo; páginas 1..10, límite 0..10000; 42501 si el usuario no es de la tienda; PT403 sin purchases.create efectivo (REP20-01); al reusar la fila limpia el reclamo de Emparejamiento; la reapertura en caché anota last_used_at (REP20-06); libera el confirmed con compra cancelado (REP2-03c); solo service_role (SCN-03h, SCN-03l, SCN-03n, SCN-03o).';

revoke all on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) to service_role;

-- 4. discard_invoice_scan del usuario -------------------------------------------------

create or replace function public.discard_invoice_scan_by_user(p_store_id uuid, p_id uuid, p_user_id uuid)
returns setof public.invoice_scans
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_created_by uuid;
begin
  if p_store_id is null or p_id is null or p_user_id is null then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  if not public.user_can_create_purchase(p_user_id) or not exists (
    select 1 from public.profiles pr
    where pr.id = p_user_id and pr.store_id = p_store_id
  ) then
    raise exception using errcode = 'PT403', message = 'No autorizado para descartar escaneos de facturas';
  end if;

  select s.created_by into v_created_by
  from public.invoice_scans s
  where s.id = p_id and s.store_id = p_store_id
  for update;

  if not found then
    return;
  end if;

  if v_created_by is distinct from p_user_id and not exists (
    select 1 from public.profiles pr
    where pr.id = p_user_id and pr.store_id = p_store_id and pr.role::text = 'admin'
  ) then
    raise exception using errcode = 'PT403',
      message = 'Solo quien escaneó esta factura o un administrador de la tienda puede descartarla.';
  end if;

  return query select * from public.discard_invoice_scan(p_store_id, p_id);
end;
$$;

comment on function public.discard_invoice_scan_by_user(uuid, uuid, uuid) is
  'Descarte del usuario: PT403 sin purchases.create efectivo, fuera de la tienda o si no es quien creó el escaneo ni admin; delega en discard_invoice_scan(uuid, uuid); solo service_role (REP20-01, D78(a)).';

revoke all on function public.discard_invoice_scan_by_user(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_invoice_scan_by_user(uuid, uuid, uuid) to service_role;

-- 5. Comprobación de rol -> predicado -------------------------------------------------

-- claim_invoice_scan (19m)

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

  if not public.current_user_can_create_purchase() then
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
      end,
      -- REP2-03c (D25-c): un escaneo confirmado en una compra ANULADA se libera
      -- en este mismo UPDATE (vuelve a extracted sin compra ni confirmacion).
      status = 'extracted',
      purchase_id = case when s.status = 'confirmed' then null else s.purchase_id end,
      confirmed = case when s.status = 'confirmed' then null else s.confirmed end,
      confirmed_at = case when s.status = 'confirmed' then null else s.confirmed_at end,
      learned_at = case when s.status = 'confirmed' then null else s.learned_at end
  where s.id = p_scan_id
    and s.store_id = v_store_id
    and (
      (
        s.status = 'extracted'
        and (
          s.claim_request_id is null
          or s.claim_request_id = p_client_request_id
          or (
            (s.claimed_at is null or s.claimed_at < now() - interval '5 minutes')
            -- CIE-06: el reclamo cuya clave ya creo su compra no caduca nunca.
            and not exists (
              select 1
              from public.purchases p
              where p.store_id = s.store_id
                and p.client_request_id = s.claim_request_id
                and s.claim_started_at is not null
                and p.created_at >= s.claim_started_at - interval '1 second'
            )
          )
          -- REP3-03d (B14): la compra de la clave del reclamo esta anulada; el
          -- escaneo ya no es de nadie, aunque el reclamo no haya caducado.
          or exists (
            select 1
            from public.purchases p
            where p.store_id = s.store_id
              and p.client_request_id = s.claim_request_id
              and s.claim_started_at is not null
              and p.created_at >= s.claim_started_at - interval '1 second'
              and p.status = 'cancelado'
          )
        )
      )
      -- REP2-03c: solo 'cancelado' (terminal); 'devuelto' sigue bloqueando.
      or (
        s.status = 'confirmed'
        and exists (
          select 1
          from public.purchases p
          where p.id = s.purchase_id
            and p.store_id = s.store_id
            and p.status = 'cancelado'
            -- REP3-03d (B17, N10): la clave de la compra anulada no puede crear otra
            -- (create_purchase da PT409); no se libera y cae en el replay.
            and p.client_request_id is distinct from p_client_request_id
        )
      )
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

  -- CIE-06: la clave del reclamo ya creo su compra; el escaneo es de esa compra.
  if exists (
    select 1
    from public.purchases p
    where p.store_id = v_store_id
      and p.client_request_id = v_scan.claim_request_id
      and v_scan.claim_started_at is not null
      and p.created_at >= v_scan.claim_started_at - interval '1 second'
  ) then
    raise exception using errcode = 'PT409', message = 'Esta factura ya se registró en otra compra';
  end if;

  raise exception using errcode = 'PT409', message = 'El escaneo se está confirmando en otra compra';
end;
$$;

revoke all on function public.claim_invoice_scan(uuid, uuid) from public, anon;
grant execute on function public.claim_invoice_scan(uuid, uuid) to authenticated, service_role;

-- release_invoice_scan_claim (19o)

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

  if not public.current_user_can_create_purchase() then
    raise exception using errcode = 'PT403', message = 'No autorizado para confirmar escaneos de facturas';
  end if;

  update public.invoice_scans s
  set claim_request_id = null,
      claimed_at = null,
      claim_started_at = null
  where s.id = p_scan_id
    and s.store_id = v_store_id
    and s.status = 'extracted'
    and s.claim_request_id = p_client_request_id
    -- CIE-06: un reclamo ligado a la compra de su clave no se suelta, salvo que
    -- esa compra este anulada (REP3-03d, B14).
    and not exists (
      select 1
      from public.purchases p
      where p.store_id = s.store_id
        and p.client_request_id = s.claim_request_id
        and s.claim_started_at is not null
        and p.created_at >= s.claim_started_at - interval '1 second'
        and p.status <> 'cancelado'
    );
end;
$$;

revoke all on function public.release_invoice_scan_claim(uuid, uuid) from public, anon;
grant execute on function public.release_invoice_scan_claim(uuid, uuid) to authenticated, service_role;

-- confirm_invoice_scan (19b)

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

  if not public.current_user_can_create_purchase() then
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

-- learn_invoice_aliases (19b)

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

  if not public.current_user_can_create_purchase() then
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

-- invoice_match_exact_aliases (19q)

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

  if not public.current_user_can_create_purchase() then
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

-- invoice_match_barcode_products (19q)

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

  if not public.current_user_can_create_purchase() then
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

-- invoice_match_candidates (19q)

-- Carga la librería de pg_trgm en esta sesión, como 19q: sin ella el
-- "set pg_trgm.similarity_threshold" de la función solo lo admite un superusuario.
do $$
declare
  v_schema text;
begin
  select n.nspname
  into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

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

  if not public.current_user_can_create_purchase() then
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


-- invoice_duplicate_candidates (26a)

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

  if not public.current_user_can_create_purchase() then
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

-- invoice_match_previous_scans (26a)

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

  if not public.current_user_can_create_purchase() then
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

-- 6. Purga sin TOCTOU (REP20-02, B-p21A-1, D78(b)) -------------------------------------
-- El borrado de filas del cron ya vuelve a mirar created_at en el mismo DELETE (BFF).
-- Aquí, la fase de huérfanos: no borra un objeto con fila ni con URL de subida emitida
-- en las últimas 24 h, y lo que lista queda reservado hasta que el cron lo borra.

create table if not exists public.invoice_scan_upload_grants (
  store_id text not null,
  image_sha256 text not null,
  issued_at timestamptz,
  purge_claimed_at timestamptz,
  primary key (store_id, image_sha256)
);

comment on table public.invoice_scan_upload_grants is
  'Por carpeta <store_id>/<sha256> del bucket invoice-scans: última URL de subida emitida (upload-url) y reserva de la purga (REP20-02, D78(b)). Solo la tocan las funciones security definer.';

alter table public.invoice_scan_upload_grants enable row level security;
revoke all on table public.invoice_scan_upload_grants from public, anon, authenticated;

create or replace function public.record_invoice_scan_upload(p_store_id uuid, p_sha256 text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_store_id is null or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'PT400', message = 'Escaneo no válido';
  end if;

  -- La fila de la carpeta serializa esta anotación con la reserva de la purga.
  insert into public.invoice_scan_upload_grants as g (store_id, image_sha256, issued_at)
  values (p_store_id::text, p_sha256, now())
  on conflict (store_id, image_sha256) do update
    set issued_at = excluded.issued_at,
        purge_claimed_at = null
    where g.purge_claimed_at is null
       or g.purge_claimed_at < now() - interval '15 minutes';

  return found;
end;
$$;

comment on function public.record_invoice_scan_upload(uuid, text) is
  'upload-url y POST del escaneo: anota el uso (URL de subida emitida) de <store>/<sha>; false si la purga tiene reservada la carpeta (sus objetos se están borrando). REP20-02, D78(b).';

revoke all on function public.record_invoice_scan_upload(uuid, text) from public, anon, authenticated;
grant execute on function public.record_invoice_scan_upload(uuid, text) to service_role;

-- Redefine la de 20261019c (misma firma y retorno). Antes protegía solo la carpeta de
-- una fila con created_at >= p_before; ahora la de cualquier fila y la de una URL
-- emitida en 24 h, y reserva lo que devuelve.
create or replace function public.list_expired_invoice_scan_objects(
  p_before timestamptz,
  p_limit integer
)
returns table (name text)
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.invoice_scan_upload_grants g
  where (g.issued_at is null or g.issued_at < now() - interval '24 hours')
    and (g.purge_claimed_at is null or g.purge_claimed_at < now() - interval '15 minutes');

  with candidates as (
    select o.name as object_name,
           o.created_at as object_created_at,
           split_part(o.name, '/', 1) as folder_store,
           split_part(o.name, '/', 2) as folder_sha
    from storage.objects o
    where o.bucket_id = 'invoice-scans'
      and o.created_at < p_before
      and not exists (
        select 1
        from public.invoice_scans s
        where s.store_id::text = split_part(o.name, '/', 1)
          and s.image_sha256 = split_part(o.name, '/', 2)
      )
      and not exists (
        select 1
        from public.invoice_scan_upload_grants g
        where g.store_id = split_part(o.name, '/', 1)
          and g.image_sha256 = split_part(o.name, '/', 2)
          and g.issued_at >= now() - interval '24 hours'
      )
    order by o.created_at asc
    limit greatest(coalesce(p_limit, 0), 0)
  ),
  claimed as (
    -- Misma fila que record_invoice_scan_upload: si upload-url anotó la carpeta
    -- después de la lectura de arriba, el WHERE la deja fuera.
    insert into public.invoice_scan_upload_grants as g (store_id, image_sha256, purge_claimed_at)
    select distinct c.folder_store, c.folder_sha, now() from candidates c
    on conflict (store_id, image_sha256) do update
      set purge_claimed_at = now()
      where g.issued_at is null
         or g.issued_at < now() - interval '24 hours'
    returning g.store_id, g.image_sha256
  )
  select c.object_name
  from candidates c
  join claimed k on k.store_id = c.folder_store and k.image_sha256 = c.folder_sha
  order by c.object_created_at asc;
$$;

comment on function public.list_expired_invoice_scan_objects(timestamptz, integer) is
  'Objetos del bucket invoice-scans anteriores a p_before sin fila ni URL de subida en 24 h; reserva sus carpetas para la purga (cron, service role). 20261019c, redefinida en 20261103a (REP20-02).';

revoke all on function public.list_expired_invoice_scan_objects(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.list_expired_invoice_scan_objects(timestamptz, integer) to service_role;

create or replace function public.release_invoice_scan_object_claims(p_names text[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.invoice_scan_upload_grants g
  using (
    select distinct split_part(n, '/', 1) as folder_store, split_part(n, '/', 2) as folder_sha
    from unnest(coalesce(p_names, '{}'::text[])) as n
  ) r
  where g.store_id = r.folder_store
    and g.image_sha256 = r.folder_sha
    and g.purge_claimed_at is not null;
$$;

comment on function public.release_invoice_scan_object_claims(text[]) is
  'Cron de purga: suelta la reserva de las carpetas de p_names, ya borrados de Storage (REP20-02, D78(b)).';

revoke all on function public.release_invoice_scan_object_claims(text[]) from public, anon, authenticated;
grant execute on function public.release_invoice_scan_object_claims(text[]) to service_role;

-- 7. create_purchase (20261010d + predicado) ------------------------------------------
-- REP20-06 (QA REP20-05 M-q2005-1, D78(a)): el vendedor o contador con purchases.create
-- concedido escaneaba y emparejaba, pero create_purchase miraba solo el rol y la compra
-- respondía PT403. Copia íntegra de la versión vigente (20261010d, la misma que trae
-- deploy/ux-mejoras-01-antes-del-bff.sql) en la que cambia SOLO esa comprobación: mismo
-- mensaje, firma, retorno, atributos y grants. El almacén con purchases.create denegado
-- pasa a PT403, como en la app (la ruta ya le respondía 403).

create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_items jsonb,
  p_exchange_rate_id uuid default null,
  p_ref_rate_ves numeric default null,
  p_discount_ref numeric default 0,
  p_tax_ref numeric default 0,
  p_notes text default null,
  p_purchase_number text default null,
  p_status public.purchase_status default 'recibido',
  p_discount_ves numeric default null,
  p_tax_ves numeric default null,
  p_subtotal_ves numeric default null,
  p_subtotal_ref numeric default null,
  p_client_request_id uuid default null
)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_rate numeric(14,4);
  v_purchase public.purchases;
  v_item jsonb;
  v_product public.products;
  v_product_id uuid;
  v_product_ids uuid[];
  v_quantity integer;
  v_unit_cost_ref numeric(12,2);
  v_unit_cost_ves numeric(14,2);
  v_cost_with_tax_ref numeric(12,2);
  v_cost_with_tax_ves numeric(14,2);
  v_line_subtotal_ref numeric(14,2);
  v_line_subtotal_ves numeric(14,2);
  v_discount_ref numeric(14,2);
  v_discount_ves numeric(14,2);
  v_tax_ref numeric(14,2);
  v_tax_ves numeric(14,2);
  v_subtotal_ref numeric(14,2);
  v_subtotal_ves numeric(14,2);
  v_total_ref numeric(14,2);
  v_total_ves numeric(14,2);
  v_supplier_sku text;
  v_sp_id uuid;
  v_old_cost_ref numeric(12,2);
  v_old_cost_ves numeric(14,2);
  v_entry_mode text;
  v_pack_label text;
  v_pack_count integer;
  v_units_per_pack integer;
  v_pack_cost_ref numeric(12,2);
  v_pack_cost_ves numeric(14,2);
  v_tax_rate numeric(5,2);
  v_tax_rate_code text;
  v_tax_rate_pct numeric(5,2);
  v_line_tax_ref numeric(14,2);
  v_line_tax_ves numeric(14,2);
  v_cost_currency text;
  v_pair_units integer;
  v_unit_pack_sizes integer[];
  v_request_hash text;
  v_number_seq bigint;
  v_rows integer;
  v_constraint text;
  v_supplier_name text;
  v_supplier_type public.contact_type;
  v_supplier_active boolean;
  v_sp_active boolean;
  v_sp_is_new boolean;
  v_new_sp_ids uuid[] := '{}';
  v_inactive_names text;
  v_inactive_count integer;
  v_disassemble_ids uuid[];
  v_missing_recipes text;
begin
  v_store_id := public.assert_store_context();
  -- N4 — NaN / Infinity no son menores que 0 y atravesaban las guardas de abajo.
  perform public.assert_finite_numeric(p_ref_rate_ves, 'la tasa ref/VES');
  perform public.assert_finite_numeric(p_discount_ref, 'el descuento');
  perform public.assert_finite_numeric(p_tax_ref, 'el impuesto');
  perform public.assert_finite_numeric(p_discount_ves, 'el descuento en Bs');
  perform public.assert_finite_numeric(p_tax_ves, 'el impuesto en Bs');
  perform public.assert_finite_numeric(p_subtotal_ves, 'el subtotal en Bs');
  perform public.assert_finite_numeric(p_subtotal_ref, 'el subtotal');

  -- REP20-06 (M-q2005-1, D78(a)): el permiso efectivo de la app, no solo el rol.
  if not public.current_user_can_create_purchase() then
    raise exception using errcode = 'PT403', message = 'No autorizado para crear compras';
  end if;

  -- C6 — reintento del mismo envio. El advisory lock serializa dos peticiones
  -- simultaneas con la misma clave: la segunda espera el commit de la primera y
  -- encuentra su compra (nunca llega al indice unico).
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('purchase-request:' || v_store_id::text || ':' || p_client_request_id::text, 0)
    );

    v_request_hash := public.stock_request_hash(jsonb_build_array(
      'create_purchase',
      p_supplier_id,
      p_items,
      p_status,
      round(coalesce(p_discount_ref, 0), 2)::text,
      round(coalesce(p_tax_ref, 0), 2)::text,
      round(p_discount_ves, 2)::text,
      round(p_tax_ves, 2)::text,
      round(p_subtotal_ves, 2)::text,
      round(p_subtotal_ref, 2)::text
    ));
    v_purchase := public.purchase_idempotent_replay(v_store_id, p_client_request_id, v_request_hash);

    if v_purchase.id is not null then
      return v_purchase;
    end if;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'PT400', message = 'La compra debe tener al menos un item';
  end if;

  -- R6 — forma de cada linea antes de convertirla: un uuid, un entero o un
  -- monto mal escritos salian como 22P02 crudo. Las cantidades se miran segun
  -- el modo de la linea, igual que en el bucle de abajo.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'PT400', message = 'Identificador de producto invalido en item de compra';
    end if;

    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');

    if exists (
      select 1
      from unnest(
        array['unit_cost_ref', 'unit_cost_ves', 'subtotal_ref', 'subtotal_ves', 'tax_rate', 'tax_ref', 'tax_ves']
        || case when v_entry_mode = 'pack' then array['pack_cost_ref', 'pack_cost_ves'] else array[]::text[] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,12}([.][0-9]+)?$'
    ) then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if exists (
      select 1
      from unnest(
        case when v_entry_mode = 'pack' then array['pack_count', 'units_per_pack'] else array['quantity'] end
      ) as k(name)
      where (v_item ->> k.name) is not null
        and (v_item ->> k.name) !~ '^-?[0-9]{1,9}$'
    ) then
      raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
    end if;

    -- COM-14 — la marca "Desarmar al recibir" es un booleano de JSON o no va.
    if v_item ? 'disassemble_on_receive'
       and jsonb_typeof(v_item -> 'disassemble_on_receive') is distinct from 'boolean' then
      raise exception using
        errcode = 'PT400',
        message = 'Marca de desarmar al recibir invalida en item de compra';
    end if;
  end loop;

  if p_exchange_rate_id is not null then
    select rate_ves into v_rate
    from public.exchange_rates
    where id = p_exchange_rate_id
      and store_id = v_store_id;
  else
    v_rate := p_ref_rate_ves;
  end if;

  if v_rate is null or v_rate <= 0 then
    raise exception using errcode = 'PT400', message = 'Debe indicar una tasa ref/VES valida';
  end if;

  if p_status is null or p_status not in ('pedido', 'recibido') then
    raise exception using errcode = 'PT400', message = 'Solo se puede crear una compra en estado pedido o recibido';
  end if;

  if p_discount_ves is null or p_tax_ves is null or p_subtotal_ves is null or p_subtotal_ref is null then
    raise exception using
      errcode = 'PT400',
      message = 'Debe enviar subtotal/descuento/impuesto en REF y VES desde el cliente';
  end if;

  v_discount_ref := coalesce(p_discount_ref, 0);
  v_discount_ves := p_discount_ves;
  v_tax_ref := coalesce(p_tax_ref, 0);
  v_tax_ves := p_tax_ves;
  v_subtotal_ref := p_subtotal_ref;
  v_subtotal_ves := p_subtotal_ves;

  if v_discount_ref < 0 or v_discount_ves < 0 or v_tax_ref < 0 or v_tax_ves < 0
     or v_subtotal_ref < 0 or v_subtotal_ves < 0 then
    raise exception using errcode = 'PT400', message = 'Totales de compra invalidos';
  end if;

  -- COM-02 — el proveedor debe ser de la tienda, estar activo y ser proveedor / ambos.
  -- Son las reglas de siempre (assert_contact_type + tienda), ahora con PT400 y
  -- mensaje propio: antes el inactivo y el que no es proveedor salian sin errcode.
  -- FOR SHARE: quien desactiva al proveedor o lo deja solo como cliente espera a
  -- que esta compra termine, y la compra ve su estado confirmado (la compra no
  -- deja un vinculo nuevo con un proveedor que se desactivo a mitad).
  select c.name, c.type, c.is_active
  into v_supplier_name, v_supplier_type, v_supplier_active
  from public.contacts c
  where c.id = p_supplier_id
    and c.store_id = v_store_id
  for share;

  if not found then
    if exists (select 1 from public.contacts where id = p_supplier_id and is_active) then
      raise exception using errcode = 'PT400', message = 'Contacto no pertenece a tu tienda';
    end if;

    raise exception using errcode = 'PT400', message = 'Proveedor no encontrado';
  end if;

  if not v_supplier_active then
    raise exception using
      errcode = 'PT400',
      message = format('El proveedor %s está inactivo: no se puede registrar la compra', v_supplier_name);
  end if;

  if v_supplier_type::text not in ('proveedor', 'ambos') then
    raise exception using
      errcode = 'PT400',
      message = format('El contacto %s no es proveedor: no se puede registrar la compra', v_supplier_name);
  end if;

  -- C11 — el numero por defecto sale de una secuencia: dos compras en el mismo
  -- milisegundo ya no chocan en purchases_store_number_unique.
  if p_purchase_number is null then
    v_number_seq := nextval('public.purchases_number_seq');
  end if;

  insert into public.purchases (
    purchase_number,
    supplier_id,
    user_id,
    exchange_rate_id,
    ref_rate_ves,
    discount_ref,
    tax_ref,
    status,
    notes,
    store_id,
    client_request_id,
    client_request_hash
  )
  values (
    coalesce(
      p_purchase_number,
      'C-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-'
        || lpad(v_number_seq::text, greatest(6, length(v_number_seq::text)), '0')
    ),
    p_supplier_id,
    auth.uid(),
    p_exchange_rate_id,
    v_rate,
    v_discount_ref,
    v_tax_ref,
    p_status,
    p_notes,
    v_store_id,
    p_client_request_id,
    case when p_client_request_id is not null then v_request_hash end
  )
  returning * into v_purchase;

  -- Documento primero; despues TODOS los productos de la compra en una sola
  -- sentencia y en orden fijo.
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_product_ids
  from jsonb_array_elements(p_items) as e(value);

  -- COM-14 — productos de las lineas marcadas "Desarmar al recibir". Si la compra
  -- nace recibida, sus empaques se abren al final: las cabeceras de receta y los
  -- componentes se bloquean AQUI, junto con los productos de la compra y por id,
  -- antes que ningun otro producto (la sentencia de abajo repite el bloqueo de
  -- los que ya quedaron tomados).
  select array_agg(distinct (e.value ->> 'product_id')::uuid)
  into v_disassemble_ids
  from jsonb_array_elements(p_items) as e(value)
  where e.value -> 'disassemble_on_receive' = 'true'::jsonb;

  if v_disassemble_ids is not null and p_status = 'recibido' then
    perform public.purchase_disassemble_lock(v_store_id, v_disassemble_ids, v_product_ids);
  end if;

  perform 1
  from public.products
  where id = any(v_product_ids)
    and store_id = v_store_id
  order by id
  for update;

  -- COM-15 — ninguna linea puede ser de un producto inactivo, ni en una compra
  -- recibida ni en un pedido. Se mira con los productos ya bloqueados: desactivar
  -- uno espera a que esta compra termine y, si la desactivacion llego antes, aqui
  -- ya se ve. Al lanzar, la transaccion deshace la compra insertada arriba.
  select count(*), string_agg(p.name, ', ' order by p.name, p.id)
  into v_inactive_count, v_inactive_names
  from public.products p
  where p.id = any(v_product_ids)
    and p.store_id = v_store_id
    and p.is_active is not true;

  if v_inactive_count = 1 then
    raise exception using
      errcode = 'PT400',
      message = format('El producto %s está inactivo: no se puede registrar la compra', v_inactive_names);
  elsif v_inactive_count > 1 then
    raise exception using
      errcode = 'PT400',
      message = format('Los productos %s están inactivos: no se puede registrar la compra', v_inactive_names);
  end if;

  -- COM-14 — una linea marcada exige que su producto sea el empaque de una receta
  -- activa, en un pedido y en una compra recibida. Un producto que no existe lo
  -- rechaza el bucle de abajo con su PT404.
  if v_disassemble_ids is not null then
    v_missing_recipes := public.purchase_disassemble_missing_recipes(v_store_id, v_disassemble_ids);

    if v_missing_recipes is not null then
      raise exception using
        errcode = 'PT400',
        message = format(
          'Sin receta de apertura activa: %s. No se puede marcar «Desarmar al recibir» en esas líneas',
          v_missing_recipes
        );
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_supplier_sku := v_item ->> 'supplier_sku';
    v_entry_mode := coalesce(nullif(trim(v_item ->> 'entry_mode'), ''), 'unit');
    v_cost_currency := coalesce(nullif(trim(v_item ->> 'cost_currency'), ''), 'ves');

    if v_cost_currency not in ('ves', 'ref') then
      raise exception using errcode = 'PT400', message = 'cost_currency invalido en item de compra';
    end if;

    v_unit_cost_ref := (v_item ->> 'unit_cost_ref')::numeric;
    v_unit_cost_ves := (v_item ->> 'unit_cost_ves')::numeric;
    v_line_subtotal_ref := (v_item ->> 'subtotal_ref')::numeric;
    v_line_subtotal_ves := (v_item ->> 'subtotal_ves')::numeric;
    v_tax_rate := (v_item ->> 'tax_rate')::numeric;
    v_line_tax_ref := (v_item ->> 'tax_ref')::numeric;
    v_line_tax_ves := (v_item ->> 'tax_ves')::numeric;

    -- SHR-10 — el IVA de la linea sale del catalogo tax_rates (alicuotas de la
    -- tienda: propias + globales). Con tax_rate_code manda la alicuota y su pct
    -- es el snapshot de la linea; con solo tax_rate (clientes anteriores) el
    -- porcentaje debe ser el de una alicuota activa y se guarda su code. Un
    -- tax_rate ausente o fuera de 0..100 lo siguen rechazando las guardas de abajo.
    v_tax_rate_code := nullif(trim(v_item ->> 'tax_rate_code'), '');

    if v_tax_rate_code is not null then
      select t.pct into v_tax_rate_pct
      from public.tax_rates_for_store(v_store_id) t
      where t.code = v_tax_rate_code
        and t.is_active;

      if not found then
        raise exception using
          errcode = 'PT400',
          message = format('La alicuota de IVA "%s" no existe o no esta activa en tu tienda', v_tax_rate_code);
      end if;

      if v_tax_rate is not null and v_tax_rate <> v_tax_rate_pct then
        raise exception using
          errcode = 'PT400',
          message = format(
            'El porcentaje de IVA enviado (%s %%) no coincide con la alicuota "%s" (%s %%)',
            v_tax_rate, v_tax_rate_code, v_tax_rate_pct
          );
      end if;

      v_tax_rate := v_tax_rate_pct;
    elsif v_tax_rate is not null and v_tax_rate >= 0 and v_tax_rate <= 100 then
      select t.code into v_tax_rate_code
      from public.tax_rate_for_pct(v_store_id, v_tax_rate, true) t;

      if not found then
        raise exception using
          errcode = 'PT400',
          message = format('El porcentaje de IVA %s %% no corresponde a ninguna alicuota activa', v_tax_rate);
      end if;
    end if;

    if v_unit_cost_ref is null or v_unit_cost_ves is null
       or v_line_subtotal_ref is null or v_line_subtotal_ves is null
       or v_tax_rate is null or v_line_tax_ref is null or v_line_tax_ves is null then
      raise exception using
        errcode = 'PT400',
        message = 'Cada item debe enviar costos/subtotales/impuesto en REF y VES';
    end if;

    if v_unit_cost_ref < 0 or v_unit_cost_ves < 0
       or v_line_subtotal_ref < 0 or v_line_subtotal_ves < 0
       or v_tax_rate < 0 or v_tax_rate > 100
       or v_line_tax_ref < 0 or v_line_tax_ves < 0 then
      raise exception using errcode = 'PT400', message = 'Montos invalidos en item de compra';
    end if;

    if v_entry_mode = 'pack' then
      v_pack_label := nullif(trim(v_item ->> 'pack_label'), '');
      v_pack_count := (v_item ->> 'pack_count')::integer;
      v_units_per_pack := (v_item ->> 'units_per_pack')::integer;
      v_pack_cost_ref := (v_item ->> 'pack_cost_ref')::numeric;
      v_pack_cost_ves := (v_item ->> 'pack_cost_ves')::numeric;

      if v_pack_label is null
         or v_pack_count is null or v_pack_count <= 0
         or v_units_per_pack is null or v_units_per_pack <= 0
         or v_pack_cost_ref is null or v_pack_cost_ves is null
         or v_pack_cost_ref < 0 or v_pack_cost_ves < 0 then
        raise exception using
          errcode = 'PT400',
          message = 'Item pack incompleto: requiere label, conteos y pack_cost REF+VES';
      end if;

      -- C13 — si el producto pertenece a una receta empaque -> unidad activa, las
      -- unidades por empaque las fija la receta, no el cliente.
      -- PRO-12 — lado unidad: recetas activas de las que el producto es el UNICO
      -- componente (sus unidades son las del empaque). Puede salir de varios
      -- empaques: valen las unidades de cualquiera de ellos.
      select array_agg(distinct pc.units_per_pack order by pc.units_per_pack) into v_unit_pack_sizes
      from public.product_pack_components pc
      join public.product_pack_conversions c on c.id = pc.conversion_id
      where pc.unit_product_id = v_product_id
        and c.store_id = v_store_id
        and c.is_active = true
        and pc.units_per_pack = c.total_units;

      if v_unit_pack_sizes is not null then
        -- El producto es la UNIDAD del par: entran pack_count x unidades del par.
        if not (v_units_per_pack = any(v_unit_pack_sizes)) then
          raise exception using
            errcode = 'PT400',
            message = format(
              'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
              v_units_per_pack, array_to_string(v_unit_pack_sizes, ', ')
            );
        end if;

        v_quantity := v_pack_count * v_units_per_pack;
      else
        -- PRO-12 — lado empaque: total de unidades de su receta activa (1 a 1 o surtida).
        select c.total_units into v_pair_units
        from public.product_pack_conversions c
        where c.pack_product_id = v_product_id
          and c.store_id = v_store_id
          and c.is_active = true;

        if found then
          if v_units_per_pack <> v_pair_units then
            raise exception using
              errcode = 'PT400',
              message = format(
                'Las unidades por empaque enviadas (%s) no coinciden con la conversion registrada del producto (%s)',
                v_units_per_pack, v_pair_units
              );
          end if;

          -- El producto ES el empaque: su stock se cuenta en empaques. Entran
          -- pack_count empaques al costo del empaque y la linea se guarda en
          -- modo unidad (quantity = empaques), que es lo que leen
          -- receive_purchase y la vista purchases_without_movements.
          v_quantity := v_pack_count;
          v_unit_cost_ref := v_pack_cost_ref;
          v_unit_cost_ves := v_pack_cost_ves;
          v_entry_mode := 'unit';
          v_pack_label := null;
          v_pack_count := null;
          v_units_per_pack := null;
          v_pack_cost_ref := null;
          v_pack_cost_ves := null;
        else
          v_quantity := v_pack_count * v_units_per_pack;
        end if;
      end if;
    else
      v_entry_mode := 'unit';
      v_pack_label := null;
      v_pack_count := null;
      v_units_per_pack := null;
      v_pack_cost_ref := null;
      v_pack_cost_ves := null;
      v_quantity := (v_item ->> 'quantity')::integer;

      if v_quantity is null or v_quantity <= 0 then
        raise exception using errcode = 'PT400', message = 'Cantidad invalida en item de compra';
      end if;
    end if;

    -- Costo unitario final del producto: neto + IVA de esta linea (0% = exento).
    v_cost_with_tax_ref := round(v_unit_cost_ref * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);
    v_cost_with_tax_ves := round(v_unit_cost_ves * (1 + coalesce(v_tax_rate, 0) / 100.0), 2);

    select * into v_product
    from public.products
    where id = v_product_id
      and store_id = v_store_id
    for update;

    if not found then
      raise exception using
        errcode = 'PT404',
        message = format('Producto no encontrado: %s', v_product_id);
    end if;

    insert into public.purchase_items (
      purchase_id,
      product_id,
      quantity,
      unit_cost_ref,
      unit_cost_ves,
      subtotal_ref,
      subtotal_ves,
      entry_mode,
      pack_label,
      pack_count,
      units_per_pack,
      pack_cost_ref,
      pack_cost_ves,
      tax_rate,
      tax_ref,
      tax_ves,
      cost_currency,
      tax_rate_code,
      disassemble_on_receive
    )
    values (
      v_purchase.id,
      v_product_id,
      v_quantity,
      v_unit_cost_ref,
      v_unit_cost_ves,
      v_line_subtotal_ref,
      v_line_subtotal_ves,
      v_entry_mode,
      v_pack_label,
      v_pack_count,
      v_units_per_pack,
      v_pack_cost_ref,
      v_pack_cost_ves,
      v_tax_rate,
      v_line_tax_ref,
      v_line_tax_ves,
      v_cost_currency,
      v_tax_rate_code,
      coalesce((v_item -> 'disassemble_on_receive') = 'true'::jsonb, false)
    );

    -- COM-02 — vinculo proveedor-producto de la linea. El producto ya esta
    -- bloqueado: nadie mas crea, reactiva ni desactiva sus vinculos mientras tanto.
    select id, last_cost_ref, last_cost_ves, is_active
    into v_sp_id, v_old_cost_ref, v_old_cost_ves, v_sp_active
    from public.supplier_products
    where supplier_id = p_supplier_id
      and product_id = v_product_id
      and store_id = v_store_id;

    v_sp_is_new := v_sp_id is null;

    if p_status = 'recibido' then
      update public.products
      set current_cost_ref = v_cost_with_tax_ref
      where id = v_product_id
        and store_id = v_store_id;

      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception using
          errcode = 'PT409',
          message = format('No se pudo actualizar el costo del producto %s', v_product_id);
      end if;

      -- Camino de siempre: crea el vinculo que falte, reactiva el inactivo y
      -- registra el costo de la linea con origen 'compra'.
      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        last_purchased_at,
        store_id
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        now(),
        v_store_id
      )
      on conflict (supplier_id, product_id)
      do update set
        supplier_sku = coalesce(excluded.supplier_sku, public.supplier_products.supplier_sku),
        last_cost_ref = excluded.last_cost_ref,
        last_cost_ves = excluded.last_cost_ves,
        last_purchased_at = excluded.last_purchased_at,
        is_active = true,
        updated_at = now()
      returning id into v_sp_id;

      perform public.append_supplier_product_price_history(
        v_sp_id,
        v_old_cost_ref,
        v_old_cost_ves,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        'compra',
        'Compra ' || v_purchase.purchase_number
      );

      -- Modo estricto: stock_after lo fija stock_movements_apply(), que tambien
      -- actualiza el stock del producto.
      insert into public.stock_movements (
        product_id,
        type,
        quantity_delta,
        purchase_id,
        reason,
        created_by,
        store_id
      )
      values (
        v_product_id,
        'compra',
        v_quantity,
        v_purchase.id,
        'Compra ' || v_purchase.purchase_number,
        auth.uid(),
        v_store_id
      );
    elsif v_sp_is_new then
      -- COM-02 — pedido de un producto que el proveedor no tenia: el vinculo nace
      -- con el costo de la linea (con IVA, como al recibir). Todavia no es una
      -- compra recibida: origen 'vinculacion' y sin fecha de ultima compra;
      -- receive_purchase registrara el costo con origen 'compra'.
      insert into public.supplier_products (
        supplier_id,
        product_id,
        supplier_sku,
        last_cost_ref,
        last_cost_ves,
        store_id
      )
      values (
        p_supplier_id,
        v_product_id,
        v_supplier_sku,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        v_store_id
      )
      returning id into v_sp_id;

      perform public.append_supplier_product_price_history(
        v_sp_id,
        null,
        null,
        v_cost_with_tax_ref,
        v_cost_with_tax_ves,
        'vinculacion',
        'Pedido ' || v_purchase.purchase_number
      );
    elsif not v_sp_active then
      -- COM-02 — pedido sobre un vinculo desactivado: se reactiva (lo mismo que
      -- hace la recepcion) sin tocar su costo ni su historial.
      update public.supplier_products
      set is_active = true,
          updated_at = now()
      where id = v_sp_id
        and store_id = v_store_id;
    end if;

    if v_sp_is_new then
      v_new_sp_ids := v_new_sp_ids || v_sp_id;
    end if;

    -- COM-02 — linea por empaque sobre un vinculo creado en ESTA compra: su
    -- empaque queda en el catalogo del proveedor; el primero es el
    -- predeterminado. Un vinculo que ya existia conserva sus empaques tal cual.
    if v_entry_mode = 'pack'
       and v_sp_id = any(v_new_sp_ids)
       and not exists (
         select 1
         from public.supplier_product_pack_units u
         where u.supplier_product_id = v_sp_id
           and u.units_per_pack = v_units_per_pack
           and lower(u.label) = lower(v_pack_label)
       ) then
      insert into public.supplier_product_pack_units (
        supplier_product_id,
        label,
        units_per_pack,
        is_default
      )
      values (
        v_sp_id,
        v_pack_label,
        v_units_per_pack,
        not exists (
          select 1
          from public.supplier_product_pack_units u
          where u.supplier_product_id = v_sp_id
            and u.is_default
            and u.is_active
        )
      );
    end if;
  end loop;

  v_total_ref := greatest(round(v_subtotal_ref - v_discount_ref + v_tax_ref, 2), 0);
  v_total_ves := greatest(round(v_subtotal_ves - v_discount_ves + v_tax_ves, 2), 0);

  update public.purchases
  set subtotal_ref = v_subtotal_ref,
      subtotal_ves = v_subtotal_ves,
      discount_ves = v_discount_ves,
      tax_ves = v_tax_ves,
      total_ref = v_total_ref,
      total_ves = v_total_ves
  where id = v_purchase.id
  returning * into v_purchase;

  -- COM-14 — la compra nace recibida: los empaques de las lineas marcadas se
  -- abren ahora, en esta misma transaccion, invocando convert_pack_to_units. Si
  -- una apertura falla no queda ni la compra.
  if p_status = 'recibido' and v_disassemble_ids is not null then
    perform public.purchase_disassemble_lines(v_purchase.id, null);
  end if;

  return v_purchase;
exception
  -- R6 — tasa, costos, empaques x unidades o totales que no caben en sus columnas.
  when numeric_value_out_of_range then
    raise exception using
      errcode = 'PT400',
      message = 'Alguna cantidad o monto de la compra esta fuera del rango permitido';
  -- R6 — numero de compra repetido en la tienda. Cualquier otro choque sigue igual.
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'purchases_store_number_unique' then
      raise exception using
        errcode = 'PT409',
        message = format('Ya existe una compra con el numero %s', p_purchase_number);
    end if;
    raise;
end;
$$;

revoke all on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) from public, anon;
grant execute on function public.create_purchase(
  uuid, jsonb, uuid, numeric, numeric, numeric, text, text, public.purchase_status,
  numeric, numeric, numeric, numeric, uuid
) to authenticated, service_role;

-- 8. La purga no borra un escaneo vencido en uso (REP20-06, B-q2005-2, D78(b)) ---------
-- Un escaneo creado hace más de 90 días puede estar en uso hoy: reabierto desde la caché
-- (reserve_invoice_scan, outcome cached, no toca created_at) o reclamado para confirmar
-- (claimed_at). last_used_at anota la reapertura (§3); la lista y el DELETE del cron
-- (BFF) exigen además last_used_at y claimed_at nulos o anteriores al corte.

alter table public.invoice_scans
  add column if not exists last_used_at timestamptz;

-- 19o da la lectura por columnas (todas salvo claim_request_id): la nueva, igual.
grant select (last_used_at) on public.invoice_scans to authenticated;

comment on column public.invoice_scans.last_used_at is
  'Última reapertura desde la caché (reserve_invoice_scan, outcome cached). La purga a 90 días no borra un escaneo con last_used_at o claimed_at posteriores al corte (REP20-06, D78(b)).';

commit;

notify pgrst, 'reload schema';
