-- =============================================================================
-- 20261019g — escaneo de factura: escrituras solo por RPC, ruta ligada a la
--             tienda y cuota no negativa (SCN-03l; caos-2 N1, N2, N6, N7, N8, N9)
-- Proyecto: BodegaHub
-- Requiere: 20261019a-invoice-scans (tabla y RLS), 20261019e-invoice-scan-reserve
--           (status 'processing', usage_pages, reserve_invoice_scan) y
--           20260716-multi-store (current_user_store_id, current_user_role).
--
-- Antes, la política de update de 20261019a dejaba a admin/almacen cambiar por
-- PostgREST cualquier columna de las filas de su tienda: un storage_path de
-- otra tienda (el BFF firmaba esa imagen con service role y la purga borraría
-- objetos ajenos), usage_pages=-1000 (cuota sin límite) o created_at. Además
-- reserve_invoice_scan guardaba p_storage_path sin validarlo.
--
-- 1. authenticated pierde insert, update y delete directos sobre
--    public.invoice_scans y se borran las políticas de insert y update. Se
--    conserva el select (lo usan el BFF y Emparejamiento). Todas las escrituras
--    pasan por RPCs security definer: reserve/complete/fail/discard de este
--    parche y 20261019e, y claim/release/confirm/learn de Emparejamiento
--    (20261019b), que no dependen de los grants directos.
-- 2. Checks de tabla (se crean `not valid` y se validan si las filas existentes
--    cumplen; si alguna no cumple queda un NOTICE y el check solo rige para las
--    escrituras nuevas):
--      invoice_scans_storage_path_scope: storage_path es exactamente
--        store_id || '/' || image_sha256 || '/p1.' || (jpg|png|webp);
--      invoice_scans_usage_pages_nonnegative: usage_pages >= 0.
-- 3. reserve_invoice_scan:
--      - valida p_storage_path con la misma regla del check (22023);
--      - la ventana de una fila 'processing' viva pasa de 2 minutos a
--        50 s por página + 60 s, con las pages de la fila existente: las
--        páginas se leen en serie con hasta 45 s cada una.
--    N9 (aceptado por el supervisor): al reutilizar una fila de otro día,
--    created_at pasa a hoy y usage_pages vale solo el intento nuevo, así que el
--    consumo de aquel día pierde esas páginas. La cuota de hoy es correcta y el
--    consumo de días pasados no se usa para nada; no hay tabla de uso aparte.
-- 4. RPCs nuevas, security definer, search_path vacío, tienda =
--    current_user_store_id(), rol admin o almacen (si no, 42501), execute solo
--    para authenticated y service_role:
--      complete_invoice_scan(p_id, p_extracted, p_matched, p_input_tokens,
--        p_output_tokens, p_duration_ms) → setof invoice_scans
--        processing → extracted; sin filas si ya no está processing.
--      fail_invoice_scan(p_id, p_error, p_refund_pages default false) → void
--        processing → failed con el código (^[A-Z_]{1,40}$, nunca contenido).
--        Con p_refund_pages resta las páginas del intento de usage_pages sin
--        bajar de 0: lo usa el BFF cuando el fallo es anterior al modelo.
--      discard_invoice_scan(p_id) → setof invoice_scans
--        extracted → discarded; sin filas si no es de la tienda (404); en otro
--        estado, PT409 con el mensaje en español de ese estado.
--
-- Reaplicación: si se reaplica 20261019a (vuelve a dar insert/update y a crear
-- las políticas) o 20261019e (vuelve la ventana de 2 minutos y la ruta sin
-- validar), hay que reaplicar este parche después.
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

-- 1. Sin escrituras directas de authenticated -----------------------------------

revoke insert, update, delete on public.invoice_scans from authenticated;
grant select on public.invoice_scans to authenticated;

drop policy if exists "Purchase creators insert invoice scans" on public.invoice_scans;
drop policy if exists "Purchase creators update invoice scans" on public.invoice_scans;

-- 2. Checks de tabla ---------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_scans'::regclass
      and conname = 'invoice_scans_storage_path_scope'
  ) then
    alter table public.invoice_scans
      add constraint invoice_scans_storage_path_scope
      check (
        storage_path in (
          store_id::text || '/' || image_sha256 || '/p1.jpg',
          store_id::text || '/' || image_sha256 || '/p1.png',
          store_id::text || '/' || image_sha256 || '/p1.webp'
        )
      ) not valid;
  end if;

  if exists (
    select 1 from public.invoice_scans s
    where s.storage_path not in (
      s.store_id::text || '/' || s.image_sha256 || '/p1.jpg',
      s.store_id::text || '/' || s.image_sha256 || '/p1.png',
      s.store_id::text || '/' || s.image_sha256 || '/p1.webp'
    )
  ) then
    raise notice 'invoice_scans_storage_path_scope queda NOT VALID: hay filas con storage_path fuera de su tienda o hash.';
  else
    alter table public.invoice_scans validate constraint invoice_scans_storage_path_scope;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_scans'::regclass
      and conname = 'invoice_scans_usage_pages_nonnegative'
  ) then
    alter table public.invoice_scans
      add constraint invoice_scans_usage_pages_nonnegative
      check (usage_pages >= 0) not valid;
  end if;

  if exists (select 1 from public.invoice_scans s where s.usage_pages < 0) then
    raise notice 'invoice_scans_usage_pages_nonnegative queda NOT VALID: hay filas con usage_pages negativo.';
  else
    alter table public.invoice_scans validate constraint invoice_scans_usage_pages_nonnegative;
  end if;
end;
$$;

-- 3. reserve_invoice_scan: ruta validada y ventana por páginas ----------------------

create or replace function public.reserve_invoice_scan(
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
  v_store_id uuid := public.current_user_store_id();
  v_user_id uuid := auth.uid();
  v_day_start timestamptz :=
    date_trunc('day', now() at time zone 'America/Caracas') at time zone 'America/Caracas';
  v_day_end timestamptz;
  v_row public.invoice_scans%rowtype;
  v_exists boolean;
  v_used integer;
  v_id uuid;
begin
  v_day_end := v_day_start + interval '1 day';

  if v_store_id is null or v_user_id is null
     or coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception 'No tienes permiso para escanear facturas.' using errcode = '42501';
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_pages is null or p_pages < 1 or p_limit is null or p_limit < 0
     or p_storage_path is null
     or p_storage_path not in (
       v_store_id::text || '/' || p_sha256 || '/p1.jpg',
       v_store_id::text || '/' || p_sha256 || '/p1.png',
       v_store_id::text || '/' || p_sha256 || '/p1.webp'
     ) then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice_scan:' || v_store_id::text));

  select * into v_row
  from public.invoice_scans s
  where s.store_id = v_store_id and s.image_sha256 = p_sha256
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
  where s.store_id = v_store_id
    and s.created_at >= v_day_start
    and s.created_at < v_day_end;

  if v_used + p_pages > p_limit then
    return jsonb_build_object('outcome', 'quota', 'used', v_used, 'limit', p_limit);
  end if;

  if v_exists then
    -- N9: una fila de otro día pasa a hoy con solo este intento (ver cabecera).
    update public.invoice_scans s
    set status = 'processing',
        storage_path = p_storage_path,
        pages = p_pages,
        provider = p_provider,
        model = p_model,
        created_by = v_user_id,
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
      extracted, matched, status, usage_pages
    )
    values (
      v_store_id, v_user_id, p_sha256, p_storage_path, p_pages, p_provider, p_model,
      '{}'::jsonb, '{}'::jsonb, 'processing', p_pages
    )
    returning id into v_id;
  end if;

  return jsonb_build_object('outcome', 'reserved', 'id', v_id, 'used', v_used + p_pages, 'limit', p_limit);
end;
$$;

comment on function public.reserve_invoice_scan(text, text, integer, integer, text, text) is
  'Reserva atómica (lock por tienda) de un escaneo de factura: caché, en curso (50 s/página + 60 s), cuota o reserva; ruta <tienda>/<sha>/p1.<ext> (SCN-03h, SCN-03l).';

revoke all on function public.reserve_invoice_scan(text, text, integer, integer, text, text) from public;
revoke all on function public.reserve_invoice_scan(text, text, integer, integer, text, text) from anon;
grant execute on function public.reserve_invoice_scan(text, text, integer, integer, text, text) to authenticated;
grant execute on function public.reserve_invoice_scan(text, text, integer, integer, text, text) to service_role;

-- 4. complete / fail / discard ---------------------------------------------------------

create or replace function public.complete_invoice_scan(
  p_id uuid,
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
  v_store_id uuid := public.current_user_store_id();
begin
  if v_store_id is null or auth.uid() is null
     or coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception 'No tienes permiso para escanear facturas.' using errcode = '42501';
  end if;

  if p_id is null
     or jsonb_typeof(p_extracted) is distinct from 'object'
     or jsonb_typeof(p_matched) is distinct from 'object'
     or p_input_tokens < 0 or p_output_tokens < 0
     or p_duration_ms is null or p_duration_ms < 0 then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
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
    where s.id = p_id and s.store_id = v_store_id and s.status = 'processing'
    returning s.*
  )
  select * from done;
end;
$$;

comment on function public.complete_invoice_scan(uuid, jsonb, jsonb, integer, integer, integer) is
  'Cierra una reserva de escaneo con la lectura (processing → extracted); sin filas si ya no está processing (SCN-03l).';

create or replace function public.fail_invoice_scan(
  p_id uuid,
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
  v_store_id uuid := public.current_user_store_id();
begin
  if v_store_id is null or auth.uid() is null
     or coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception 'No tienes permiso para escanear facturas.' using errcode = '42501';
  end if;

  if p_id is null or p_error is null or p_error !~ '^[A-Z_]{1,40}$' or p_refund_pages is null then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  update public.invoice_scans s
  set status = 'failed',
      error = p_error,
      extracted = '{}'::jsonb,
      matched = '{}'::jsonb,
      usage_pages = case when p_refund_pages then greatest(0, s.usage_pages - s.pages) else s.usage_pages end
  where s.id = p_id and s.store_id = v_store_id and s.status = 'processing';
end;
$$;

comment on function public.fail_invoice_scan(uuid, text, boolean) is
  'Cierra una reserva de escaneo sin lectura (processing → failed) con el código; p_refund_pages devuelve las páginas si el modelo no llegó a llamarse (SCN-03l).';

create or replace function public.discard_invoice_scan(p_id uuid)
returns setof public.invoice_scans
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_store_id uuid := public.current_user_store_id();
  v_status text;
begin
  if v_store_id is null or auth.uid() is null
     or coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception 'No tienes permiso para escanear facturas.' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Datos de escaneo no válidos.' using errcode = '22023';
  end if;

  select s.status into v_status
  from public.invoice_scans s
  where s.id = p_id and s.store_id = v_store_id
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
    where s.id = p_id and s.store_id = v_store_id and s.status = 'extracted'
    returning s.*
  )
  select * from done;
end;
$$;

comment on function public.discard_invoice_scan(uuid) is
  'Descarta un escaneo extracted de la tienda; PT409 con mensaje por estado en otro caso (SCN-03l).';

revoke all on function public.complete_invoice_scan(uuid, jsonb, jsonb, integer, integer, integer) from public;
revoke all on function public.complete_invoice_scan(uuid, jsonb, jsonb, integer, integer, integer) from anon;
grant execute on function public.complete_invoice_scan(uuid, jsonb, jsonb, integer, integer, integer) to authenticated;
grant execute on function public.complete_invoice_scan(uuid, jsonb, jsonb, integer, integer, integer) to service_role;

revoke all on function public.fail_invoice_scan(uuid, text, boolean) from public;
revoke all on function public.fail_invoice_scan(uuid, text, boolean) from anon;
grant execute on function public.fail_invoice_scan(uuid, text, boolean) to authenticated;
grant execute on function public.fail_invoice_scan(uuid, text, boolean) to service_role;

revoke all on function public.discard_invoice_scan(uuid) from public;
revoke all on function public.discard_invoice_scan(uuid) from anon;
grant execute on function public.discard_invoice_scan(uuid) to authenticated;
grant execute on function public.discard_invoice_scan(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
