-- =============================================================================
-- 20260812d — Cliente POS default ("Consumidor final") por tienda
-- Idempotente. Requiere multitienda (contacts.store_id).
-- =============================================================================

alter table public.contacts
  add column if not exists is_pos_default boolean not null default false;

comment on column public.contacts.is_pos_default is
  'Cliente sistema preseleccionado en POS (uno por tienda).';

create unique index if not exists contacts_store_pos_default_unique
  on public.contacts (store_id)
  where is_pos_default = true;

-- 1) Reutilizar un "Consumidor final" existente si la tienda aun no tiene default.
with candidates as (
  select distinct on (c.store_id)
    c.id
  from public.contacts c
  where c.is_pos_default = false
    and c.type in ('cliente', 'ambos')
    and c.is_active = true
    and lower(trim(c.name)) = 'consumidor final'
    and not exists (
      select 1
      from public.contacts d
      where d.store_id = c.store_id
        and d.is_pos_default = true
    )
  order by c.store_id, c.created_at asc
)
update public.contacts c
set
  is_pos_default = true,
  notes = coalesce(
    nullif(trim(c.notes), ''),
    'Cliente sistema para ventas rapidas en POS. No desactivar.'
  ),
  updated_at = now()
from candidates x
where c.id = x.id;

-- 2) Crear el cliente sistema en tiendas que siguen sin default.
insert into public.contacts (
  store_id,
  type,
  name,
  notes,
  is_active,
  is_pos_default
)
select
  s.id,
  'cliente'::public.contact_type,
  'Consumidor final',
  'Cliente sistema para ventas rapidas en POS. No desactivar.',
  true,
  true
from public.stores s
where not exists (
  select 1
  from public.contacts c
  where c.store_id = s.id
    and c.is_pos_default = true
);

notify pgrst, 'reload schema';
