-- =============================================================================
-- 20260906b — Tabla assistant_queries (asistente IA)
--
-- Registro de cada consulta al asistente: sirve para el limite diario por
-- usuario (ASSISTANT_DAILY_LIMIT) y para revisar que se pregunta y que falla.
--
-- Escritura: solo service role (el BFF). Ningun rol de cliente inserta.
-- Lectura: admin ve las de su tienda, superadmin ve todas.
--
-- Idempotente. Requiere 20260716-multi-store.
-- =============================================================================

begin;

create table if not exists public.assistant_queries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  question text not null,
  tools jsonb not null default '[]'::jsonb,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

-- El contador diario filtra por usuario y ventana de tiempo.
create index if not exists idx_assistant_queries_user_created
  on public.assistant_queries(user_id, created_at desc);

create index if not exists idx_assistant_queries_store_created
  on public.assistant_queries(store_id, created_at desc);

alter table public.assistant_queries enable row level security;

-- Sin policy de insert/update/delete: solo el service role escribe.
drop policy if exists "Admins read own store assistant queries" on public.assistant_queries;
create policy "Admins read own store assistant queries"
  on public.assistant_queries for select to authenticated
  using (
    store_id = public.current_user_store_id()
    and public.current_user_role() = 'admin'
  );

drop policy if exists "Superadmin reads assistant queries" on public.assistant_queries;
create policy "Superadmin reads assistant queries"
  on public.assistant_queries for select to authenticated
  using (public.current_user_is_superadmin());

comment on table public.assistant_queries is
  'Bitacora de consultas al asistente IA. La escribe el BFF con service role; el cliente nunca inserta.';

commit;

notify pgrst, 'reload schema';
