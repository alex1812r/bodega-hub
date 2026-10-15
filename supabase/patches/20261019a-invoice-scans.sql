-- =============================================================================
-- 20261019a — escaneos de factura: tabla invoice_scans y bucket invoice-scans
--             (SCN-03a; plan factura-escaneo-gtm §1, §3 "Idempotencia y cuota",
--             "Trazabilidad", "Permiso", §4)
-- Proyecto: BodegaHub
-- Requiere: 20260716-multi-store (stores, current_user_store_id) y el schema
--           base (profiles, contacts, purchases, current_user_role).
--
-- 1. public.invoice_scans: un escaneo por (tienda, sha256 de la imagen). La
--    unicidad es el cache: la misma foto no vuelve a llamar al modelo. Una fila
--    'failed' se reutiliza al reintentar (el BFF la actualiza en sitio).
--    `extracted` y `matched` llevan default '{}' para poder registrar un fallo
--    antes de tener lectura. `pages` suma para la cuota diaria por tienda.
--    `supplier_id` (columna extra, capa 2 del plan): proveedor confirmado; lo
--    rellena Emparejamiento al confirmar la compra y alimenta los ejemplos
--    few-shot por proveedor (indice parcial invoice_scans_few_shot_idx).
-- 2. RLS por tienda y rol, con los roles que tienen el permiso en
--    packages/core/src/permissions.ts (mismo patron que 20261010c):
--      lectura   purchases.view   -> admin, almacen, contador
--      escritura purchases.create -> admin, almacen (insert y update)
--    Sin delete para authenticated: la purga (90 dias) la hace el service role.
--    Las excepciones por usuario (granted / denied) las aplica el BFF con
--    requireStorePermission antes de tocar la tabla. anon sin privilegios.
-- 3. Bucket Storage `invoice-scans` privado (1 MB, jpeg/png/webp). La ruta de
--    cada objeto empieza por el store_id: `<store_id>/<archivo>`. Lectura e
--    insercion solo en la carpeta de la tienda de la sesion; sin update ni
--    delete para authenticated (el borrado lo hace el cron con service role).
--
-- Idempotente: se puede aplicar varias veces seguidas. No toca stock ni dinero.
-- =============================================================================

begin;

create table if not exists public.invoice_scans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  image_sha256 text not null,
  storage_path text not null,
  pages integer not null default 1 check (pages > 0),
  provider text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  extracted jsonb not null default '{}'::jsonb,
  matched jsonb not null default '{}'::jsonb,
  confirmed jsonb,
  purchase_id uuid references public.purchases(id),
  supplier_id uuid null references public.contacts(id) on delete set null,
  status text not null default 'extracted'
    check (status in ('extracted', 'confirmed', 'discarded', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (store_id, image_sha256)
);

comment on column public.invoice_scans.supplier_id is
  'Proveedor confirmado (capa 2): lo rellena Emparejamiento al confirmar; few-shot por proveedor.';

create index if not exists invoice_scans_store_created_idx
  on public.invoice_scans (store_id, created_at desc);

create index if not exists invoice_scans_few_shot_idx
  on public.invoice_scans (store_id, supplier_id, created_at desc)
  where confirmed is not null and supplier_id is not null;

alter table public.invoice_scans enable row level security;

revoke all on public.invoice_scans from anon;
revoke all on public.invoice_scans from authenticated;
grant select, insert, update on public.invoice_scans to authenticated;
grant all on public.invoice_scans to service_role;

drop policy if exists "Purchase viewers read invoice scans" on public.invoice_scans;
create policy "Purchase viewers read invoice scans"
on public.invoice_scans for select
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen', 'contador')
);

drop policy if exists "Purchase creators insert invoice scans" on public.invoice_scans;
create policy "Purchase creators insert invoice scans"
on public.invoice_scans for insert
to authenticated
with check (
  store_id = public.current_user_store_id()
  and created_by = auth.uid()
  and public.current_user_role() in ('admin', 'almacen')
);

drop policy if exists "Purchase creators update invoice scans" on public.invoice_scans;
create policy "Purchase creators update invoice scans"
on public.invoice_scans for update
to authenticated
using (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
)
with check (
  store_id = public.current_user_store_id()
  and public.current_user_role() in ('admin', 'almacen')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoice-scans',
  'invoice-scans',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Purchase viewers read invoice scan images" on storage.objects;
create policy "Purchase viewers read invoice scan images"
on storage.objects for select
to authenticated
using (
  bucket_id = 'invoice-scans'
  and (storage.foldername(name))[1] = public.current_user_store_id()::text
  and public.current_user_role() in ('admin', 'almacen', 'contador')
);

drop policy if exists "Purchase creators upload invoice scan images" on storage.objects;
create policy "Purchase creators upload invoice scan images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'invoice-scans'
  and (storage.foldername(name))[1] = public.current_user_store_id()::text
  and public.current_user_role() in ('admin', 'almacen')
);

commit;

notify pgrst, 'reload schema';
