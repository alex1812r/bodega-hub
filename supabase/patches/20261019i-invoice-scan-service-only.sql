-- =============================================================================
-- 20261019i — escaneo de factura: RPCs de escritura solo para service_role,
--             intento vigente (attempt_id), páginas/límite acotados y tope de
--             tamaño de la lectura (SCN-03n; caos-3 C1, C2, C3, C7)
-- Proyecto: BodegaHub
-- Requiere: 20261019a-invoice-scans, 20261019e-invoice-scan-reserve y
--           20261019g-invoice-scan-writes-lockdown.
--
-- Antes, reserve/complete/fail/discard_invoice_scan se concedían a
-- authenticated y sacaban la tienda del JWT. Un almacén podía llamarlas por
-- PostgREST sin pasar por el BFF:
--   C1: reserve + complete con extracted/matched inventados (sin modelo ni
--       imagen), también sobre la lectura viva de otro usuario; el compañero
--       recibía después esa lectura como cached:true;
--   C2: fail(p_refund_pages=true) durante una lectura viva devolvía la cuota y
--       liberaba la fila para una segunda lectura en paralelo;
--   C3: p_pages y p_limit eran del llamador (429 para toda la tienda, ventanas
--       de 3400 años, 22003 por desbordamiento de int);
--   C7: p_extracted de 7,7 MB se aceptaba sin tope.
--
-- 1. Columna invoice_scans.attempt_id uuid (null en las filas existentes):
--    reserve la renueva con gen_random_uuid() en cada reserva y la devuelve
--    como `attemptId`. complete y fail exigen p_attempt_id: si la fila no está
--    processing, el intento no es el vigente o la reservó otro usuario →
--    PT409 "Esta lectura ya no está vigente." Así una lectura vieja (o la de
--    un tercero) no pisa la nueva ni devuelve su cuota.
-- 2. Check invoice_scans_payload_size: octet_length(extracted::text) y
--    octet_length(matched::text) ≤ 524288 (512 KB). Se crea `not valid` y se
--    valida si las filas existentes cumplen; si no, NOTICE y solo rige para
--    las escrituras nuevas.
-- 3. Firmas nuevas, security definer, search_path vacío; ya no usan auth.uid()
--    ni current_user_store_id(): la tienda y el usuario los pasa el BFF desde
--    la sesión, después de requireStorePermission (purchases.create):
--      reserve_invoice_scan(p_store_id, p_user_id, p_sha256, p_storage_path,
--        p_pages, p_limit, p_provider, p_model) → jsonb
--        p_pages 1..10 y p_limit 0..10000, si no 22023; resto igual que 19g.
--      complete_invoice_scan(p_store_id, p_user_id, p_id, p_attempt_id,
--        p_extracted, p_matched, p_input_tokens, p_output_tokens,
--        p_duration_ms) → setof invoice_scans (sin filas si no es de la tienda)
--      fail_invoice_scan(p_store_id, p_user_id, p_id, p_attempt_id, p_error,
--        p_refund_pages default false) → void (nada si no es de la tienda)
--      discard_invoice_scan(p_store_id, p_id) → setof invoice_scans
--        sin p_user_id: cualquier usuario con purchases.create de la tienda
--        puede descartar un extracted (como en 19g) y no hay columna de autor
--        del descarte.
--    Las firmas viejas se eliminan (drop function if exists) para que no
--    quede ninguna sobrecarga invocable por authenticated.
-- 4. Execute: revoke de public, anon y authenticated; grant solo a service_role.
--
-- No toca las RPCs de Emparejamiento (claim/confirm/release/learn) ni el
-- select de authenticated sobre invoice_scans.
--
-- Reaplicación: si se reaplica 20261019e o 20261019g, vuelven las firmas
-- viejas concedidas a authenticated; hay que reaplicar este parche después.
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

-- 1. attempt_id ---------------------------------------------------------------------

alter table public.invoice_scans add column if not exists attempt_id uuid;

comment on column public.invoice_scans.attempt_id is
  'Intento vigente de la reserva: lo renueva reserve_invoice_scan y lo exigen complete/fail (SCN-03n).';

-- 2. Tope de tamaño de la lectura ---------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_scans'::regclass
      and conname = 'invoice_scans_payload_size'
  ) then
    alter table public.invoice_scans
      add constraint invoice_scans_payload_size
      check (
        octet_length(extracted::text) <= 524288
        and octet_length(matched::text) <= 524288
      ) not valid;
  end if;

  if exists (
    select 1 from public.invoice_scans s
    where octet_length(s.extracted::text) > 524288 or octet_length(s.matched::text) > 524288
  ) then
    raise notice 'invoice_scans_payload_size queda NOT VALID: hay filas con extracted o matched de más de 512 KB.';
  else
    alter table public.invoice_scans validate constraint invoice_scans_payload_size;
  end if;
end;
$$;

-- 3. Firmas viejas fuera -------------------------------------------------------------

drop function if exists public.reserve_invoice_scan(text, text, integer, integer, text, text);
drop function if exists public.complete_invoice_scan(uuid, jsonb, jsonb, integer, integer, integer);
drop function if exists public.fail_invoice_scan(uuid, text, boolean);
drop function if exists public.discard_invoice_scan(uuid);

-- 4. reserve_invoice_scan --------------------------------------------------------------

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

  perform pg_advisory_xact_lock(hashtext('invoice_scan:' || p_store_id::text));

  select * into v_row
  from public.invoice_scans s
  where s.store_id = p_store_id and s.image_sha256 = p_sha256
  for update;
  v_exists := found;

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
  'Reserva atómica (lock por tienda) de un escaneo de factura con intento nuevo; páginas 1..10, límite 0..10000; solo service_role (SCN-03h, SCN-03l, SCN-03n).';

-- 5. complete_invoice_scan --------------------------------------------------------------

create or replace function public.complete_invoice_scan(
  p_store_id uuid,
  p_user_id uuid,
  p_id uuid,
  p_attempt_id uuid,
  p_extracted jsonb,
  p_matched jsonb,
  p_input_tokens integer,
  p_output_tokens integer,
  p_duration_ms integer
)
returns setof public.invoice_scans
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.invoice_scans%rowtype;
begin
  if p_store_id is null or p_user_id is null or p_id is null or p_attempt_id is null
     or jsonb_typeof(p_extracted) is distinct from 'object'
     or jsonb_typeof(p_matched) is distinct from 'object'
     or p_input_tokens < 0 or p_output_tokens < 0
     or p_duration_ms is null or p_duration_ms < 0 then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  select * into v_row
  from public.invoice_scans s
  where s.id = p_id and s.store_id = p_store_id
  for update;

  if not found then
    return;
  end if;

  if v_row.status <> 'processing'
     or v_row.attempt_id is distinct from p_attempt_id
     or v_row.created_by is distinct from p_user_id then
    raise exception 'Esta lectura ya no está vigente.' using errcode = 'PT409';
  end if;

  return query
  with done as (
    update public.invoice_scans s
    set status = 'extracted',
        extracted = p_extracted,
        matched = p_matched,
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        duration_ms = p_duration_ms,
        error = null
    where s.id = p_id
    returning s.*
  )
  select * from done;
end;
$$;

comment on function public.complete_invoice_scan(uuid, uuid, uuid, uuid, jsonb, jsonb, integer, integer, integer) is
  'Cierra el intento vigente de una reserva con la lectura (processing → extracted); PT409 si el intento no es el vigente; solo service_role (SCN-03l, SCN-03n).';

-- 6. fail_invoice_scan ------------------------------------------------------------------

create or replace function public.fail_invoice_scan(
  p_store_id uuid,
  p_user_id uuid,
  p_id uuid,
  p_attempt_id uuid,
  p_error text,
  p_refund_pages boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.invoice_scans%rowtype;
begin
  if p_store_id is null or p_user_id is null or p_id is null or p_attempt_id is null
     or p_error is null or p_error !~ '^[A-Z_]{1,40}$' or p_refund_pages is null then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  select * into v_row
  from public.invoice_scans s
  where s.id = p_id and s.store_id = p_store_id
  for update;

  if not found then
    return;
  end if;

  if v_row.status <> 'processing'
     or v_row.attempt_id is distinct from p_attempt_id
     or v_row.created_by is distinct from p_user_id then
    raise exception 'Esta lectura ya no está vigente.' using errcode = 'PT409';
  end if;

  update public.invoice_scans s
  set status = 'failed',
      error = p_error,
      extracted = '{}'::jsonb,
      matched = '{}'::jsonb,
      usage_pages = case when p_refund_pages then greatest(0, s.usage_pages - s.pages) else s.usage_pages end
  where s.id = p_id;
end;
$$;

comment on function public.fail_invoice_scan(uuid, uuid, uuid, uuid, text, boolean) is
  'Cierra el intento vigente sin lectura (processing → failed) con el código; p_refund_pages devuelve las páginas del intento; PT409 si no es el vigente; solo service_role (SCN-03l, SCN-03n).';

-- 7. discard_invoice_scan ---------------------------------------------------------------

create or replace function public.discard_invoice_scan(p_store_id uuid, p_id uuid)
returns setof public.invoice_scans
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_store_id is null or p_id is null then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  select s.status into v_status
  from public.invoice_scans s
  where s.id = p_id and s.store_id = p_store_id
  for update;

  if not found then
    return;
  end if;

  if v_status = 'processing' then
    raise exception 'Este escaneo todavía se está leyendo; espera a que termine para descartarlo.'
      using errcode = 'PT409';
  elsif v_status = 'confirmed' then
    raise exception 'Este escaneo ya se confirmó en una compra y no se puede descartar.'
      using errcode = 'PT409';
  elsif v_status = 'discarded' then
    raise exception 'Este escaneo ya estaba descartado.' using errcode = 'PT409';
  elsif v_status = 'failed' then
    raise exception 'La lectura de este escaneo falló y no hay nada que descartar. Vuelve a escanear la factura.'
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
  'Descarta un escaneo extracted de la tienda; PT409 con mensaje por estado en otro caso; solo service_role (SCN-03l, SCN-03n).';

-- 8. Solo service_role ------------------------------------------------------------------

revoke all on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.reserve_invoice_scan(uuid, uuid, text, text, integer, integer, text, text) to service_role;

revoke all on function public.complete_invoice_scan(uuid, uuid, uuid, uuid, jsonb, jsonb, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.complete_invoice_scan(uuid, uuid, uuid, uuid, jsonb, jsonb, integer, integer, integer) to service_role;

revoke all on function public.fail_invoice_scan(uuid, uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_invoice_scan(uuid, uuid, uuid, uuid, text, boolean) to service_role;

revoke all on function public.discard_invoice_scan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_invoice_scan(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
