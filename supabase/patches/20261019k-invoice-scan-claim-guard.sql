-- =============================================================================
-- 20261019k — escaneo de factura: el descarte respeta el reclamo de
--             Emparejamiento, el reescaneo no lo hereda y la reserva exige
--             que el usuario sea de la tienda (SCN-03o; caos-4 M1 y B2)
-- Proyecto: BodegaHub
-- Requiere: 20261019a, 20261019e, 20261019g y 20261019i. Opcional: 20261019b
--           (Emparejamiento: columnas claim_request_id, claimed_at, learned_at
--           y claim/confirm/release_invoice_scan_claim). En despliegue 19b va
--           entre 19a y 19c; este parche funciona con y sin 19b.
--
-- caos-4 M1: discard_invoice_scan solo miraba status. Con el reclamo de
-- Emparejamiento vigente (claim_invoice_scan → create_purchase →
-- confirm_invoice_scan), otro usuario podía descartar el escaneo entre la
-- creación de la compra y la confirmación: confirm fallaba, la compra quedaba
-- con stock y costo y la misma foto se podía reescanear y confirmar en OTRA
-- compra (se salta la guarda de 6.14). Además reserve_invoice_scan, al reusar
-- la fila discarded/failed, no limpiaba el reclamo: el reescaneo lo heredaba
-- (bloqueo de 5 min al nuevo, y el intento viejo se quedaba la lectura nueva).
-- caos-4 B2: reserve_invoice_scan no comprobaba que p_user_id fuera de
-- p_store_id.
--
-- 1. discard_invoice_scan(p_store_id, p_id): misma firma y mensajes por estado
--    que 19i. Sobre un extracted, PT409 "Esta factura se está confirmando en
--    una compra; espera a que termine." si:
--      - hay un reclamo activo: claim_request_id y claimed_at no nulos y
--        claimed_at de hace menos de 5 minutos (la misma caducidad que usa
--        claim_invoice_scan de 19b), o
--      - purchase_id o confirmed no son nulos.
--    Las columnas del reclamo se leen con to_jsonb(fila)->>'…': sin 19b dan
--    null y la guarda solo mira purchase_id/confirmed. El FOR UPDATE serializa
--    con el UPDATE de claim_invoice_scan: o reclama antes (y el descarte da
--    PT409) o ve la fila discarded (y el reclamo da su PT409).
-- 2. reserve_invoice_scan(...): misma firma y comportamiento que 19i, más:
--      - 42501 "El usuario no pertenece a esta tienda." si p_user_id no es un
--        perfil activo de p_store_id (profiles.store_id, is_active) (B2);
--      - al reusar una fila (discarded, failed o processing caducada) pone a
--        null claim_request_id, claimed_at y learned_at con un UPDATE dinámico
--        solo de las columnas que existen (pg_attribute): sin 19b no hace nada.
-- 3. Execute: revoke de public, anon y authenticated; grant solo a
--    service_role (igual que 19i).
--
-- CIE-06 (auditoria pasada 1, M1): discard_invoice_scan tambien da PT409
-- "Esta factura ya tiene una compra registrada y no se puede descartar." si la
-- clave del reclamo ya creo su compra (purchases.client_request_id =
-- claim_request_id y created_at >= claim_started_at - 1 s; misma regla que
-- claim_invoice_scan de 19b), aunque el reclamo haya caducado: si no, el
-- descarte y el reescaneo (reserve limpia el reclamo) dejaban confirmar la misma
-- factura en otra compra. Sin 19b las columnas son null y no aplica.
--
-- REP2-03c (caos N5, D25-c): un escaneo confirmed cuya compra ligada está
-- 'cancelado' (terminal) deja de bloquear la factura: reserve_invoice_scan (el
-- reescaneo) lo devuelve a extracted y discard_invoice_scan lo descarta, en ambos
-- casos con purchase_id, confirmed y confirmed_at a null (reserve también
-- learned_at si existe). Misma regla que claim_invoice_scan de 19b. 'devuelto'
-- sigue bloqueando; los alias aprendidos con la compra anulada no se tocan.
--
-- No toca complete/fail_invoice_scan ni las RPC de Emparejamiento.
--
-- Reaplicación: si se reaplica 20261019i (o la cadena 19a → 19g → 19i), hay
-- que reaplicar este parche después: 19i vuelve a definir reserve y discard
-- sin estas guardas.
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

-- 1. reserve_invoice_scan --------------------------------------------------------------

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
  'Reserva atómica (lock por tienda) de un escaneo de factura con intento nuevo; páginas 1..10, límite 0..10000; 42501 si el usuario no es de la tienda; al reusar la fila limpia el reclamo de Emparejamiento; libera el confirmed con compra cancelado (REP2-03c); solo service_role (SCN-03h, SCN-03l, SCN-03n, SCN-03o).';

-- 2. discard_invoice_scan ---------------------------------------------------------------

create or replace function public.discard_invoice_scan(p_store_id uuid, p_id uuid)
returns setof public.invoice_scans
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.invoice_scans%rowtype;
  v_fields jsonb;
begin
  if p_store_id is null or p_id is null then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  select * into v_row
  from public.invoice_scans s
  where s.id = p_id and s.store_id = p_store_id
  for update;

  if not found then
    return;
  end if;

  -- REP2-03c (D25-c): confirmado en una compra anulada → se descarta liberándolo
  -- (sin compra ni confirmación). 'devuelto' sigue en PT409.
  if v_row.status = 'confirmed' and exists (
    select 1 from public.purchases p
    where p.id = v_row.purchase_id and p.store_id = v_row.store_id and p.status = 'cancelado'
  ) then
    return query
    with done as (
      update public.invoice_scans s
      set status = 'discarded', purchase_id = null, confirmed = null, confirmed_at = null
      where s.id = p_id and s.store_id = p_store_id and s.status = 'confirmed'
      returning s.*
    )
    select * from done;
    return;
  end if;

  if v_row.status = 'processing' then
    raise exception 'Este escaneo todavía se está leyendo; espera a que termine para descartarlo.'
      using errcode = 'PT409';
  elsif v_row.status = 'confirmed' then
    raise exception 'Este escaneo ya se confirmó en una compra y no se puede descartar.'
      using errcode = 'PT409';
  elsif v_row.status = 'discarded' then
    raise exception 'Este escaneo ya estaba descartado.' using errcode = 'PT409';
  elsif v_row.status = 'failed' then
    raise exception 'La lectura de este escaneo falló y no hay nada que descartar. Vuelve a escanear la factura.'
      using errcode = 'PT409';
  end if;

  -- M1 (SCN-03o): reclamo activo de Emparejamiento (19b; sin 19b son null) o
  -- compra ya enlazada.
  v_fields := to_jsonb(v_row);

  -- CIE-06: la clave del reclamo ya creo su compra; el escaneo es de esa compra.
  if v_fields->>'claim_request_id' is not null
     and v_fields->>'claim_started_at' is not null
     and exists (
       select 1
       from public.purchases p
       where p.store_id = v_row.store_id
         and p.client_request_id = (v_fields->>'claim_request_id')::uuid
         and p.created_at >= (v_fields->>'claim_started_at')::timestamptz - interval '1 second'
     ) then
    raise exception 'Esta factura ya tiene una compra registrada y no se puede descartar.'
      using errcode = 'PT409';
  end if;

  if v_row.purchase_id is not null
     or v_row.confirmed is not null
     or (
       v_fields->>'claim_request_id' is not null
       and v_fields->>'claimed_at' is not null
       and (v_fields->>'claimed_at')::timestamptz >= now() - interval '5 minutes'
     ) then
    raise exception 'Esta factura se está confirmando en una compra; espera a que termine.'
      using errcode = 'PT409';
  end if;

  return query
  with done as (
    update public.invoice_scans s
    set status = 'discarded'
    where s.id = p_id and s.store_id = p_store_id and s.status = 'extracted'
    returning s.*
  )
  select * from done;
end;
$$;

comment on function public.discard_invoice_scan(uuid, uuid) is
  'Descarta un escaneo extracted (o confirmed con su compra cancelado, REP2-03c) de la tienda; PT409 con mensaje por estado, o si hay un reclamo activo de Emparejamiento, purchase_id, confirmed o la clave del reclamo ya creó su compra; solo service_role (SCN-03l, SCN-03n, SCN-03o, CIE-06).';

-- 3. Solo service_role ------------------------------------------------------------------

revoke all on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) to service_role;

revoke all on function public.discard_invoice_scan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_invoice_scan(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
