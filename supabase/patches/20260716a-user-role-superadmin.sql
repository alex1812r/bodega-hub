-- Patch 20260716a: agregar enum user_role.superadmin
-- EJECUTAR SOLO este archivo primero y confirmar OK.
-- Luego ejecutar 20260716-multi-store.sql
--
-- Motivo: PostgreSQL no permite USAR un valor nuevo de enum en la misma
-- transaccion donde se agrego (error 55P04).

do $$ begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'superadmin'
  ) then
    alter type public.user_role add value 'superadmin';
  end if;
end $$;
