-- =============================================================================
-- 20261019m — escaneo de factura: liberación v3 al anular la compra
--             (REP3-03d; auditoría p4 B14 / B17 y su extensión de B2; caos p3 N10)
-- Proyecto: BodegaHub
-- Requiere: 20261019b (claim/release_invoice_scan_claim, columnas del reclamo) y
--           20261019k (discard_invoice_scan). Se aplica DESPUÉS de los dos.
--
-- B14: un escaneo LIGADO por CIE-06 (extracted con el reclamo de una clave que ya
-- creó su compra, pero sin confirm: corte o fallo entre create_purchase y
-- confirm) seguía bloqueado para siempre aunque esa compra se anulara: la regla
-- CIE-06 de claim / release / discard no miraba purchases.status.
-- B17: reenviar la petición ORIGINAL (la clave de la compra anulada) liberaba el
-- escaneo en el UPDATE del claim (confirmed, purchase_id y learned_at a null)
-- aunque create_purchase respondiera después PT409 (purchase_idempotent_replay
-- rechaza siempre una clave cuya compra está cancelado o devuelto) y no creara
-- nada; release no lo restauraba.
-- N10: ese mismo reenvío a menos de 1 s de crear la compra dejaba el escaneo en
-- limbo: liberado, con el reclamo de la clave original ligado por CIE-06 a la
-- compra anulada (claim_started_at - 1 s <= created_at), sin que release lo
-- soltara ni otra clave lo pudiera reclamar.
-- B17-ext (B2): claim_invoice_scan solo miraba el rol; un almacén con
-- purchases.create denegado (BFF 403) reclamaba por PostgREST.
--
-- 1. claim_invoice_scan(p_scan_id, p_client_request_id): misma firma, retorno y
--    mensajes que 19b, más:
--      - PT403 'No autorizado para confirmar escaneos de facturas' si el rol es
--        almacen y profiles.denied_permissions contiene 'purchases.create'. Es
--        el mismo cálculo que getEffectivePermissions (@bodega/core/permissions):
--        al almacén la denegación le quita el permiso aunque esté concedido; el
--        admin ignora las excepciones por usuario, así que no se le aplica.
--      - extracted con el reclamo ligado (CIE-06) a una compra 'cancelado' →
--        se reclama para la nueva clave aunque el reclamo no haya caducado (B14).
--      - confirmed con su compra 'cancelado' se libera SOLO si la clave del
--        reclamo no es la de esa compra. Con la misma clave no hay UPDATE: cae en
--        el 'replay' de siempre, create_purchase responde PT409 y el escaneo
--        sigue confirmed con su compra y su confirmed intactos (B17, N10).
-- 2. release_invoice_scan_claim(p_scan_id, p_client_request_id): un reclamo
--    ligado a una compra 'cancelado' sí se suelta (B14: el reintento de la clave
--    original, rechazado con PT409, deja el escaneo libre).
-- 3. discard_invoice_scan(p_store_id, p_id): misma firma y mensajes que 19k; el
--    reclamo ligado a una compra 'cancelado' no bloquea el descarte (ni el PT409
--    de CIE-06 ni el del reclamo vigente de 5 min).
-- 'devuelto' sigue bloqueando en todos los casos. confirm_invoice_scan y
-- reserve_invoice_scan no cambian.
--
-- Reaplicación: si se reaplica 20261019b o 20261019k (o la cadena 19a → 19g →
-- 19i → 19k), hay que reaplicar este parche después.
--
-- Idempotente (create or replace): se puede aplicar varias veces seguidas. No
-- toca stock ni dinero.
-- =============================================================================

begin;

-- 1. claim_invoice_scan -----------------------------------------------------------------

create or replace function public.claim_invoice_scan(
  p_scan_id uuid,
  p_client_request_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_scan public.invoice_scans;
  v_rows integer;
begin
  v_store_id := public.assert_store_context();

  if coalesce(public.current_user_role()::text, '') not in ('admin', 'almacen') then
    raise exception using errcode = 'PT403', message = 'No autorizado para confirmar escaneos de facturas';
  end if;

  -- REP3-03d (B17-ext): al almacén la denegación por usuario le quita
  -- purchases.create (getEffectivePermissions); el admin la ignora.
  if public.current_user_role()::text = 'almacen' and exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and pr.denied_permissions ? 'purchases.create'
  ) then
    raise exception using errcode = 'PT403', message = 'No autorizado para confirmar escaneos de facturas';
  end if;

  if p_client_request_id is null then
    raise exception using errcode = 'PT400', message = 'Falta la clave del intento de compra';
  end if;

  update public.invoice_scans s
  set claim_request_id = p_client_request_id,
      -- INT-01 (caos-5 B4): cada reclamo, también el re-reclamo de la misma clave,
      -- renueva la caducidad de 5 min; un reintento pasado ese plazo vuelve a
      -- quedar protegido frente al descarte (19k) y a otra clave.
      claimed_at = now(),
      -- SCN-06-F3: el mismo intento conserva el momento de su primer reclamo, que es
      -- contra el que confirm compara la compra.
      claim_started_at = case
        when s.claim_request_id = p_client_request_id and s.claim_started_at is not null then s.claim_started_at
        else now()
      end,
      -- REP2-03c (D25-c): un escaneo confirmado en una compra ANULADA se libera
      -- en este mismo UPDATE (vuelve a extracted sin compra ni confirmacion).
      status = 'extracted',
      purchase_id = case when s.status = 'confirmed' then null else s.purchase_id end,
      confirmed = case when s.status = 'confirmed' then null else s.confirmed end,
      confirmed_at = case when s.status = 'confirmed' then null else s.confirmed_at end,
      learned_at = case when s.status = 'confirmed' then null else s.learned_at end
  where s.id = p_scan_id
    and s.store_id = v_store_id
    and (
      (
        s.status = 'extracted'
        and (
          s.claim_request_id is null
          or s.claim_request_id = p_client_request_id
          or (
            (s.claimed_at is null or s.claimed_at < now() - interval '5 minutes')
            -- CIE-06: el reclamo cuya clave ya creo su compra no caduca nunca.
            and not exists (
              select 1
              from public.purchases p
              where p.store_id = s.store_id
                and p.client_request_id = s.claim_request_id
                and s.claim_started_at is not null
                and p.created_at >= s.claim_started_at - interval '1 second'
            )
          )
          -- REP3-03d (B14): la compra de la clave del reclamo esta anulada; el
          -- escaneo ya no es de nadie, aunque el reclamo no haya caducado.
          or exists (
            select 1
            from public.purchases p
            where p.store_id = s.store_id
              and p.client_request_id = s.claim_request_id
              and s.claim_started_at is not null
              and p.created_at >= s.claim_started_at - interval '1 second'
              and p.status = 'cancelado'
          )
        )
      )
      -- REP2-03c: solo 'cancelado' (terminal); 'devuelto' sigue bloqueando.
      or (
        s.status = 'confirmed'
        and exists (
          select 1
          from public.purchases p
          where p.id = s.purchase_id
            and p.store_id = s.store_id
            and p.status = 'cancelado'
            -- REP3-03d (B17, N10): la clave de la compra anulada no puede crear otra
            -- (create_purchase da PT409); no se libera y cae en el replay.
            and p.client_request_id is distinct from p_client_request_id
        )
      )
    );

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return 'claimed';
  end if;

  select s.*
  into v_scan
  from public.invoice_scans s
  where s.id = p_scan_id
    and s.store_id = v_store_id;

  if v_scan.id is null then
    raise exception using errcode = 'PT404', message = 'Escaneo no encontrado';
  end if;

  if v_scan.status = 'confirmed' then
    -- Replay: la compra que esta tienda ya creo con la misma clave.
    if exists (
      select 1
      from public.purchases p
      where p.id = v_scan.purchase_id
        and p.store_id = v_store_id
        and p.client_request_id = p_client_request_id
    ) then
      return 'replay';
    end if;
    raise exception using errcode = 'PT409', message = 'El escaneo ya fue confirmado';
  end if;

  if v_scan.status <> 'extracted' then
    raise exception using errcode = 'PT409', message = 'El escaneo no está disponible';
  end if;

  -- CIE-06: la clave del reclamo ya creo su compra; el escaneo es de esa compra.
  if exists (
    select 1
    from public.purchases p
    where p.store_id = v_store_id
      and p.client_request_id = v_scan.claim_request_id
      and v_scan.claim_started_at is not null
      and p.created_at >= v_scan.claim_started_at - interval '1 second'
  ) then
    raise exception using errcode = 'PT409', message = 'Esta factura ya se registró en otra compra';
  end if;

  raise exception using errcode = 'PT409', message = 'El escaneo se está confirmando en otra compra';
end;
$$;

revoke all on function public.claim_invoice_scan(uuid, uuid) from public, anon;
grant execute on function public.claim_invoice_scan(uuid, uuid) to authenticated, service_role;

-- 2. release_invoice_scan_claim ---------------------------------------------------------

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

-- 3. discard_invoice_scan ---------------------------------------------------------------

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
  v_claim_purchase_cancelled boolean;
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

  -- REP3-03d (B14): la compra de la clave del reclamo está anulada; el reclamo ya
  -- no protege nada.
  v_claim_purchase_cancelled :=
    v_fields->>'claim_request_id' is not null
    and v_fields->>'claim_started_at' is not null
    and exists (
      select 1
      from public.purchases p
      where p.store_id = v_row.store_id
        and p.client_request_id = (v_fields->>'claim_request_id')::uuid
        and p.created_at >= (v_fields->>'claim_started_at')::timestamptz - interval '1 second'
        and p.status = 'cancelado'
    );

  -- CIE-06: la clave del reclamo ya creo su compra (viva); el escaneo es de esa compra.
  if v_fields->>'claim_request_id' is not null
     and v_fields->>'claim_started_at' is not null
     and exists (
       select 1
       from public.purchases p
       where p.store_id = v_row.store_id
         and p.client_request_id = (v_fields->>'claim_request_id')::uuid
         and p.created_at >= (v_fields->>'claim_started_at')::timestamptz - interval '1 second'
         and p.status <> 'cancelado'
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
       and not v_claim_purchase_cancelled
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
  'Descarta un escaneo extracted (o confirmed con su compra cancelado, REP2-03c) de la tienda; PT409 con mensaje por estado, o si hay un reclamo activo de Emparejamiento, purchase_id, confirmed o la clave del reclamo ya creó su compra viva; un reclamo ligado a una compra cancelado no bloquea (REP3-03d); solo service_role (SCN-03l, SCN-03n, SCN-03o, CIE-06).';

revoke all on function public.discard_invoice_scan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_invoice_scan(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
