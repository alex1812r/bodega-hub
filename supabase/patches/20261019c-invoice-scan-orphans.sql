-- =============================================================================
-- 20261019c — purga de imágenes de factura sin fila (SCN-03g; plan
--             factura-escaneo-gtm §1.4 "las imágenes se borran a los 90 días")
-- Proyecto: BodegaHub
-- Requiere: 20261019a-invoice-scans (tabla invoice_scans y bucket invoice-scans).
--
-- El flujo `GET upload-url` sube las páginas al bucket ANTES de que exista la
-- fila en invoice_scans. Si el POST acaba en 400 o 429, o nunca se envía, el
-- objeto queda sin fila y la purga por filas (cron) no lo ve nunca.
--
-- public.list_expired_invoice_scan_objects(p_before, p_limit) devuelve los
-- `name` de storage.objects del bucket invoice-scans con created_at < p_before,
-- los más antiguos primero y como mucho p_limit. Excluye los objetos de un
-- escaneo vivo: los que están en la carpeta `<store_id>/<sha256>/` de una fila
-- de invoice_scans con created_at >= p_before (un reintento de una fila failed
-- le renueva created_at, y su imagen subida antes no se debe borrar).
--
-- No borra nada: el cron (service role) borra por la API de Storage.
-- Solo service_role puede ejecutarla (lee storage.objects de todas las tiendas).
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

create or replace function public.list_expired_invoice_scan_objects(
  p_before timestamptz,
  p_limit integer
)
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'invoice-scans'
    and o.created_at < p_before
    and not exists (
      select 1
      from public.invoice_scans s
      where s.created_at >= p_before
        and s.store_id::text = split_part(o.name, '/', 1)
        and s.image_sha256 = split_part(o.name, '/', 2)
    )
  order by o.created_at asc
  limit greatest(coalesce(p_limit, 0), 0);
$$;

comment on function public.list_expired_invoice_scan_objects(timestamptz, integer) is
  'Objetos del bucket invoice-scans anteriores a p_before sin escaneo vivo (cron de purga, service role).';

revoke all on function public.list_expired_invoice_scan_objects(timestamptz, integer) from public;
revoke all on function public.list_expired_invoice_scan_objects(timestamptz, integer) from anon;
revoke all on function public.list_expired_invoice_scan_objects(timestamptz, integer) from authenticated;
grant execute on function public.list_expired_invoice_scan_objects(timestamptz, integer) to service_role;

commit;

notify pgrst, 'reload schema';
