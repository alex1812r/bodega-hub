-- =============================================================================
-- 20261019o — escaneo de factura: release con la denegación por usuario de
--             purchases.create y clave del reclamo fuera de PostgREST
--             (REP4-02b; auditoría p5 B19, resto de B17-ext)
-- Proyecto: BodegaHub
-- Requiere: 20261019a (invoice_scans), 20261019b (columnas del reclamo y
--           release_invoice_scan_claim) y 20261019m (release v3). Se aplica
--           DESPUÉS de 19m.
--
-- B19: 20261019m puso en claim_invoice_scan el PT403 para el almacén con
-- 'purchases.create' en profiles.denied_permissions, pero no en
-- release_invoice_scan_claim; y la RLS de lectura de invoice_scans (admin,
-- almacén y contador de la tienda) exponía claim_request_id. Un almacén con la
-- denegación (que no puede reclamar, comprar ni descartar) leía la clave del
-- reclamo en curso de otro usuario y lo soltaba (204): otra clave podía reclamar
-- a mitad del intento y la compra original quedaba sin escaneo.
--
-- 1. release_invoice_scan_claim(p_scan_id, p_client_request_id): misma firma,
--    retorno, grants y cuerpo que 19m, más el mismo PT403 que claim: rol almacen
--    con 'purchases.create' en denied_permissions. El admin ignora las
--    excepciones por usuario (getEffectivePermissions), igual que en claim.
-- 2. invoice_scans.claim_request_id deja de ser legible por authenticated/anon:
--    se revoca el SELECT de tabla y se concede SELECT por columna a authenticated
--    sobre todas las demás columnas (lista dinámica de pg_attribute). La RLS de
--    lectura no cambia. Ningún código con el JWT del usuario lee esa columna (el
--    BFF selecciona columnas explícitas; las RPC del reclamo son SECURITY
--    DEFINER y service_role conserva todo). Efecto colateral: `select=*` por
--    PostgREST con el JWT del usuario da 42501; hay que nombrar las columnas.
--    Una columna que se añada más adelante a invoice_scans NO será legible por
--    authenticated hasta que se conceda (o se reaplique este parche).
--
-- Reaplicación: si se reaplica 20261019b o 20261019m (release sin la
-- denegación) o 20261019a / 20261019g / el fallback de 19b (vuelven a dar SELECT
-- de tabla a authenticated), hay que reaplicar este parche después.
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

-- 1. release_invoice_scan_claim ---------------------------------------------------------

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

  -- REP4-02b (B19): la misma denegación que claim_invoice_scan (19m); el admin la ignora.
  if public.current_user_role()::text = 'almacen' and exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.denied_permissions ? 'purchases.create'
  ) then
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

-- 2. claim_request_id fuera de la lectura directa ---------------------------------------

revoke select on public.invoice_scans from public, anon, authenticated;
revoke select (claim_request_id) on public.invoice_scans from public, anon, authenticated;

do $$
declare
  v_columns text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
  into v_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.invoice_scans'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'claim_request_id';

  execute format('grant select (%s) on public.invoice_scans to authenticated', v_columns);
end;
$$;

commit;

notify pgrst, 'reload schema';
