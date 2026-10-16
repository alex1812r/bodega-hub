-- =============================================================================
-- 20261019e — reserva atómica del escaneo de factura (SCN-03h; plan
--             factura-escaneo-gtm §3 "Idempotencia y cuota")
-- Proyecto: BodegaHub
-- Requiere: 20261019a-invoice-scans (tabla invoice_scans) y 20260716-multi-store
--           (current_user_store_id, current_user_role).
--
-- Antes, el BFF hacía findScanByHash → getDailyUsage → modelo → insertScan sin
-- bloqueo: 5 POST simultáneos con la misma foto hacían 5 llamadas al modelo, la
-- cuota se rebasaba con ráfagas y un reintento de un `failed` no cobraba.
--
-- 1. Status 'processing': la fila existe desde antes de llamar al modelo.
--    El check se recrea con nombre estable (invoice_scans_status_check).
-- 2. usage_pages: páginas cobradas hoy por esa fila. Cada intento suma sus
--    páginas (un reintento de un failed o un reescaneo tras descartar cobra).
--    La cuota diaria es sum(usage_pages) de las filas con created_at de hoy en
--    Caracas. Al crear la columna, las filas existentes heredan `pages`.
-- 3. public.reserve_invoice_scan(...) → jsonb. Con pg_advisory_xact_lock por
--    tienda, en una sola transacción:
--      a) misma foto en extracted o confirmed     → {outcome:'cached', id}
--      b) misma foto en processing de < 2 minutos → {outcome:'in_progress', id}
--      c) uso + p_pages > p_limit                 → {outcome:'quota', used, limit}
--      d) si no, upsert en 'processing'           → {outcome:'reserved', id, used, limit}
--    En d) una fila failed, discarded o processing caducada se reutiliza:
--    created_at pasa a now() (abre la ventana de 2 minutos) y usage_pages suma
--    p_pages si la fila ya era de hoy; si era de otro día, vale p_pages.
--    Tienda = current_user_store_id(); solo admin y almacen (si no, 42501).
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

alter table public.invoice_scans drop constraint if exists invoice_scans_status_check;
alter table public.invoice_scans add constraint invoice_scans_status_check
  check (status in ('processing', 'extracted', 'confirmed', 'discarded', 'failed'));

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice_scans' and column_name = 'usage_pages'
  ) then
    alter table public.invoice_scans add column usage_pages integer not null default 0;
    update public.invoice_scans set usage_pages = pages;
  end if;
end;
$$;

comment on column public.invoice_scans.usage_pages is
  'Páginas cobradas hoy por la fila (cada intento suma); la cuota diaria es su suma por tienda (SCN-03h).';

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
     or coalesce(p_storage_path, '') = '' then
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

  if v_exists and v_row.status = 'processing' and v_row.created_at > now() - interval '2 minutes' then
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
  'Reserva atómica (lock por tienda) de un escaneo de factura: caché, en curso, cuota o reserva (SCN-03h).';

revoke all on function public.reserve_invoice_scan(text, text, integer, integer, text, text) from public;
revoke all on function public.reserve_invoice_scan(text, text, integer, integer, text, text) from anon;
grant execute on function public.reserve_invoice_scan(text, text, integer, integer, text, text) to authenticated;
grant execute on function public.reserve_invoice_scan(text, text, integer, integer, text, text) to service_role;

commit;

notify pgrst, 'reload schema';
