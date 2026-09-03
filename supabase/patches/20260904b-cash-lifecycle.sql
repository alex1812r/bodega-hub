-- =============================================================================
-- 20260904b — Ciclo de vida caja ↔ baúl (plan de docs/cuadre-baul.md §4, items 1-5)
-- Idempotente y re-ejecutable. NO migra datos históricos: solo cambia el
-- comportamiento de aquí en adelante.
--
-- POR QUÉ
-- -------
-- El efectivo se fugaba por tres huecos, todos reproducidos por QA contra la API:
--
--   * Fuga del fondo (§4 item 2). Abrir con Bs 50.000 de fondo, vender Bs 1.001,
--     cerrar y transferir subía el baúl +Bs 51.001 cuando el ingreso real fue
--     Bs 1.001. El fondo se deposita en cada cierre y nunca se retira al abrir:
--     el baúl sobreestima un fondo por turno, acumulativo (§3 bis: 5.865,72 Bs
--     de `opening` contados como ingreso).
--
--   * Fuga de la absorción + autocierre (§4 items 1 y 3). Cerrar un turno con
--     Bs 8.511 sin transferir y reabrir la misma caja marcaba el cierre con
--     `absorbed_by_session_id`; `transfer_cash_closures_to_vault` lo rechazaba
--     para siempre ("El cierre ya fue absorbido…") y el fondo de la sesión nueva
--     era Bs 500. Los Bs 8.511 desaparecían de AMBOS libros. Con el cron de
--     `auto_close_stale_cash_sessions` (20260819) esto ocurría cada madrugada,
--     sin nadie mirando.
--
--   * Fuga de la diferencia (§4 item 4). Una sesión con teórico real Bs −3.505
--     se cerró con `closingVes = 50000` y los Bs 50.000 completos entraron al
--     baúl. Los Bs 53.505 de descuadre no quedaban registrados en ningún lado.
--
-- QUÉ HACE
-- --------
-- 1. `auto_close_stale_cash_sessions` transfiere al baúl en la MISMA transacción
--    (`vault_movements` `transfer_in` cubeta `efectivo` con `from_session_id`,
--    saldos `balance_efectivo_ves` / `balance_ref`, sello `vault_transferred_at`).
--    El cierre manual NO transfiere solo: el flujo del producto es que un admin
--    revise y transfiera desde `/vault` → "Transferir cierres", y esa revisión
--    humana se conserva. Lo que se arregla es que el camino desatendido (el cron)
--    ya no pueda dejar dinero varado.
--
-- 2. `open_cash_session` retira el fondo del baúl: `withdrawal` cubeta `efectivo`
--    por `opening_ves` / `opening_ref`, con `from_session_id` apuntando a la
--    sesión nueva, y falla en español si el baúl no alcanza. El baúl pasa a ser
--    el dueño único del efectivo entre jornadas (§4, objetivo).
--
-- 3. Se elimina la absorción: `open_cash_session` ya no escribe
--    `absorbed_by_session_id` y `transfer_cash_closures_to_vault` ya no rechaza
--    los cierres absorbidos. La columna se conserva como marca histórica y el
--    índice de cierres pendientes deja de filtrar por ella.
--
--    ATENCIÓN (histórico): en `Bodega Las Luces` hay 17 cierres absorbidos sin
--    transferir (~54.000 Bs) cuyo efectivo YA fue depositado al baúl por los
--    one-shots 20260821b/c, 20260824 y 20260901c (§2 y §3 bis). Al levantar el
--    rechazo esos cierres vuelven a aparecer como transferibles: transferirlos
--    sería volver a inflar el baúl. No se tocan aquí (el owner prohibió más
--    backfills); la app los marca como "histórico" y el saneamiento definitivo
--    es 20260902-fix-vault-inflacion-efectivo.sql, que decide el owner.
--
-- 4. `close_cash_session` (y el autocierre) asientan la diferencia entre contado
--    y teórico con `record_cash_close_difference`:
--      - sobrante (contado > teórico) → `cash_movements` `adjustment`;
--      - faltante (contado < teórico) → `cash_movements` `transfer_out`.
--    `adjustment` suma y `transfer_out` resta en la fórmula del teórico (y en
--    `computeCashSessionTotals`), así que tras el asiento la suma de movimientos
--    de la sesión iguala exactamente lo contado y lo que se transfiere al baúl es
--    reconciliable contra el libro de caja. No se usa `refund_out` (devolución a
--    un cliente) ni `change_out` (vuelto de un cobro) porque mienten sobre el
--    motivo; `transfer_out` es justamente "salió efectivo de la gaveta sin
--    operación registrada", el tipo que §3 señalaba como huérfano. Un `adjustment`
--    negativo no es opción: `cash_movements` exige montos >= 0.
--    `theoretical_closing_*` sigue guardando el teórico ANTES del asiento, para
--    que la columna "Diferencia" de la app siga mostrando el descuadre.
--
-- 5. Vista `vault_balance_check`: esperado por cubeta desde `vault_movements`
--    contra `store_vaults` (§4 item 5), para verificar sin SQL a mano.
--
-- NO HACE
-- -------
-- - No corrige ni migra ninguna fila histórica.
-- - No toca `register_payment`, `cancel_payment`, `create_sale` ni `cancel_sale`.
-- - §4 items 6 (RPC de ajustes auditados) y 7 (`cancel_payment` sobre sesiones ya
--   transferidas) quedan pendientes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Índice de cierres pendientes sin el filtro de absorción
-- -----------------------------------------------------------------------------

drop index if exists public.cash_sessions_pending_vault_transfer_idx;
create index if not exists cash_sessions_pending_vault_transfer_idx
  on public.cash_sessions (store_id, closed_at desc)
  where status = 'closed' and vault_transferred_at is null;

-- -----------------------------------------------------------------------------
-- 2. El trigger de sesión vencida deja pasar los asientos de cuadre
--    El sobrante/faltante se inserta mientras la sesión sigue abierta pero ya
--    vencida (el autocierre corre justo después del deadline). No es actividad
--    nueva de la jornada, así que `adjustment` y `transfer_out` quedan exentos
--    del tope horario; el resto de los tipos (ventas, cobros, vuelto) siguen
--    bloqueados igual que en 20260819.
-- -----------------------------------------------------------------------------

create or replace function public.prevent_movements_on_expired_cash_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
begin
  select * into v_session from public.cash_sessions where id = new.session_id;
  if not found then
    raise exception 'Sesión de caja no encontrada';
  end if;
  if v_session.status <> 'open' then
    raise exception 'La sesión de caja ya está cerrada';
  end if;
  if new.type in ('adjustment', 'transfer_out') then
    return new;
  end if;
  if public.cash_session_deadline(v_session.opened_at) <= now() then
    raise exception 'La jornada de caja venció. Cierra y abre de nuevo para registrar cobros.';
  end if;
  return new;
end;
$$;

drop trigger if exists cash_movements_prevent_expired_session on public.cash_movements;
create trigger cash_movements_prevent_expired_session
before insert on public.cash_movements
for each row
execute procedure public.prevent_movements_on_expired_cash_session();

-- -----------------------------------------------------------------------------
-- 3. Asiento de la diferencia de cierre (§4 item 4)
--    Se llama SIEMPRE antes de marcar la sesión como cerrada (el trigger exige
--    que siga abierta). `p_actor` no puede ser null: en el cierre manual es
--    auth.uid() y en el autocierre (service_role, sin auth.uid()) es quien abrió.
-- -----------------------------------------------------------------------------

create or replace function public.record_cash_close_difference(
  p_store_id uuid,
  p_session_id uuid,
  p_counted_ves numeric,
  p_counted_ref numeric,
  p_theoretical_ves numeric,
  p_theoretical_ref numeric,
  p_actor uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_over_ves numeric(14,2) := greatest(round(coalesce(p_counted_ves, 0) - coalesce(p_theoretical_ves, 0), 2), 0);
  v_over_ref numeric(14,2) := greatest(round(coalesce(p_counted_ref, 0) - coalesce(p_theoretical_ref, 0), 2), 0);
  v_short_ves numeric(14,2) := greatest(round(coalesce(p_theoretical_ves, 0) - coalesce(p_counted_ves, 0), 2), 0);
  v_short_ref numeric(14,2) := greatest(round(coalesce(p_theoretical_ref, 0) - coalesce(p_counted_ref, 0), 2), 0);
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Cuadre de cierre de caja');
begin
  if p_actor is null then
    raise exception 'No se puede asentar la diferencia de cierre sin un responsable';
  end if;

  -- Sobrante: en la gaveta hay más de lo que explican los movimientos.
  if v_over_ves > 0 or v_over_ref > 0 then
    insert into public.cash_movements (
      store_id, session_id, type, amount_ves, amount_ref, notes, created_by
    ) values (
      p_store_id, p_session_id, 'adjustment', v_over_ves, v_over_ref,
      v_reason || format(' — sobrante: lo contado supera el teórico en Bs %s / REF %s', v_over_ves, v_over_ref),
      p_actor
    );
  end if;

  -- Faltante: salió efectivo de la gaveta sin operación registrada.
  if v_short_ves > 0 or v_short_ref > 0 then
    insert into public.cash_movements (
      store_id, session_id, type, amount_ves, amount_ref, notes, created_by
    ) values (
      p_store_id, p_session_id, 'transfer_out', v_short_ves, v_short_ref,
      v_reason || format(' — faltante: lo contado queda por debajo del teórico en Bs %s / REF %s', v_short_ves, v_short_ref),
      p_actor
    );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. close_cash_session — asienta la diferencia (copia de 20260903 + §4 item 4)
--    El cierre manual sigue SIN transferir al baúl: lo hace el admin desde
--    /vault, que es donde revisa y confirma. Lo que ya no queda suelto es la
--    diferencia entre lo contado y el teórico.
-- -----------------------------------------------------------------------------

create or replace function public.close_cash_session(
  p_session_id uuid, p_closing_ves numeric, p_closing_ref numeric
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_session public.cash_sessions;
  v_ves numeric(14,2); v_ref numeric(14,2);
  v_counted_ves numeric(14,2); v_counted_ref numeric(14,2);
begin
  v_store_id := public.assert_store_context();
  if p_closing_ves is null or p_closing_ref is null or p_closing_ves < 0 or p_closing_ref < 0 then
    raise exception 'Los montos de cierre deben ser válidos y no negativos';
  end if;
  select * into v_session from public.cash_sessions where id = p_session_id and store_id = v_store_id for update;
  if not found then raise exception 'Sesión de caja no encontrada'; end if;
  if v_session.status <> 'open' then raise exception 'La sesión de caja ya está cerrada'; end if;
  if public.current_user_role() <> 'admin' and v_session.opened_by is distinct from auth.uid() then
    raise exception 'Solo quien abrió la caja o un administrador puede cerrarla';
  end if;

  select round(v_session.opening_ves + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ves
           when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
         round(v_session.opening_ref + coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ref
           when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
  into v_ves, v_ref
  from public.cash_movements where session_id = v_session.id;

  v_counted_ves := round(p_closing_ves, 2);
  v_counted_ref := round(p_closing_ref, 2);

  -- Sobrante / faltante como movimiento auditable, antes de cerrar la sesión.
  perform public.record_cash_close_difference(
    v_store_id, v_session.id, v_counted_ves, v_counted_ref, v_ves, v_ref,
    coalesce(auth.uid(), v_session.opened_by), 'Cuadre de cierre manual'
  );

  update public.cash_sessions set status = 'closed', closing_ves = v_counted_ves,
    closing_ref = v_counted_ref, theoretical_closing_ves = v_ves,
    theoretical_closing_ref = v_ref, closed_by = auth.uid(), closed_at = now(),
    closed_reason = 'manual'
  where id = v_session.id returning * into v_session;
  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. auto_close_stale_cash_sessions — cierra Y transfiere al baúl (§4 item 1)
--    El teórico puede quedar negativo (vuelto que supera lo cobrado en efectivo)
--    y `cash_sessions.closing_ves` exige >= 0: se cierra en 0 y la diferencia
--    queda asentada como `adjustment`, en vez de reventar el cron entero.
-- -----------------------------------------------------------------------------

create or replace function public.auto_close_stale_cash_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions;
  v_vault public.store_vaults;
  v_theoretical_ves numeric(14,2);
  v_theoretical_ref numeric(14,2);
  v_ves numeric(14,2);
  v_ref numeric(14,2);
  v_actor uuid;
  v_reason text;
  v_ids uuid[] := '{}';
  v_transferred_ids uuid[] := '{}';
  v_total_ves numeric(14,2) := 0;
  v_total_ref numeric(14,2) := 0;
  v_now timestamptz := now();
begin
  for v_session in
    select * from public.cash_sessions
    where status = 'open'
      and public.cash_session_deadline(opened_at) <= v_now
    for update
  loop
    select round(v_session.opening_ves + coalesce(sum(case
             when type in ('sale_in', 'adjustment') then amount_ves
             when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ves else 0 end), 0), 2),
           round(v_session.opening_ref + coalesce(sum(case
             when type in ('sale_in', 'adjustment') then amount_ref
             when type in ('transfer_out', 'refund_out', 'change_out') then -amount_ref else 0 end), 0), 2)
    into v_theoretical_ves, v_theoretical_ref
    from public.cash_movements where session_id = v_session.id;

    -- El autocierre cuenta el teórico, acotado a cero (no existe gaveta negativa).
    v_ves := greatest(v_theoretical_ves, 0);
    v_ref := greatest(v_theoretical_ref, 0);
    v_actor := v_session.opened_by;
    v_reason := public.cash_session_auto_close_reason(v_session.opened_at);

    if v_ves <> v_theoretical_ves or v_ref <> v_theoretical_ref then
      perform public.record_cash_close_difference(
        v_session.store_id, v_session.id, v_ves, v_ref,
        v_theoretical_ves, v_theoretical_ref, v_actor,
        'Cuadre de cierre automático (teórico negativo)'
      );
    end if;

    update public.cash_sessions
    set status = 'closed',
        closing_ves = v_ves,
        closing_ref = v_ref,
        theoretical_closing_ves = v_theoretical_ves,
        theoretical_closing_ref = v_theoretical_ref,
        closed_by = v_actor,
        closed_at = v_now,
        closed_reason = v_reason
    where id = v_session.id;

    v_ids := array_append(v_ids, v_session.id);

    -- §4 item 1: el efectivo entra al baúl aquí mismo. Si esto falla, falla
    -- también el cierre: preferimos reintentar el cron a dejar dinero varado.
    if v_ves > 0 or v_ref > 0 then
      perform public.ensure_store_vault(v_session.store_id);
      select * into v_vault from public.store_vaults
      where store_id = v_session.store_id for update;

      insert into public.vault_movements (
        store_id, vault_id, type, bucket, amount_ves, amount_ref, from_session_id, notes, created_by
      ) values (
        v_session.store_id, v_vault.id, 'transfer_in', 'efectivo', v_ves, v_ref, v_session.id,
        'Transferencia automática del cierre de caja (' || v_reason || ')', v_actor
      );

      update public.store_vaults
      set balance_efectivo_ves = balance_efectivo_ves + v_ves,
          balance_ref = balance_ref + v_ref
      where id = v_vault.id;

      update public.cash_sessions
      set vault_transferred_at = v_now
      where id = v_session.id;

      v_transferred_ids := array_append(v_transferred_ids, v_session.id);
      v_total_ves := v_total_ves + v_ves;
      v_total_ref := v_total_ref + v_ref;
    end if;
  end loop;

  return jsonb_build_object(
    'closedCount', coalesce(cardinality(v_ids), 0),
    'sessionIds', to_jsonb(coalesce(v_ids, '{}'::uuid[])),
    'transferredCount', coalesce(cardinality(v_transferred_ids), 0),
    'transferredSessionIds', to_jsonb(coalesce(v_transferred_ids, '{}'::uuid[])),
    'transferredVes', v_total_ves,
    'transferredRef', v_total_ref
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. open_cash_session — el fondo sale del baúl y ya no se absorbe nada
--    (§4 items 2 y 3)
-- -----------------------------------------------------------------------------

create or replace function public.open_cash_session(
  p_register_id uuid, p_opening_ves numeric default 0, p_opening_ref numeric default 0
) returns public.cash_sessions language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid; v_role public.user_role;
  v_register public.cash_registers; v_session public.cash_sessions;
  v_vault public.store_vaults;
begin
  v_store_id := public.assert_store_context(); v_role := public.current_user_role();
  if v_role not in ('admin', 'vendedor') then raise exception 'No autorizado para abrir una caja'; end if;
  if coalesce(p_opening_ves, 0) < 0 or coalesce(p_opening_ref, 0) < 0 then
    raise exception 'Los montos de apertura no pueden ser negativos';
  end if;
  select * into v_register from public.cash_registers
  where id = p_register_id and store_id = v_store_id for update;
  if not found then raise exception 'Caja registradora no encontrada'; end if;
  if not v_register.is_active then raise exception 'La caja registradora está inactiva'; end if;
  if v_role = 'vendedor' and v_register.assigned_user_id is distinct from auth.uid() then
    raise exception 'La caja no está asignada al vendedor actual';
  end if;
  if exists (select 1 from public.cash_sessions where register_id = v_register.id and status = 'open') then
    raise exception 'La caja ya tiene una sesión abierta';
  end if;

  insert into public.cash_sessions (store_id, register_id, opened_by, opening_ves, opening_ref)
  values (v_store_id, v_register.id, auth.uid(), round(coalesce(p_opening_ves, 0), 2), round(coalesce(p_opening_ref, 0), 2))
  returning * into v_session;

  -- Ya NO se marca absorbed_by_session_id: los cierres pendientes siguen siendo
  -- transferibles al baúl (docs/cuadre-baul.md §4 item 3).

  if v_session.opening_ves > 0 or v_session.opening_ref > 0 then
    insert into public.cash_movements (store_id, session_id, type, amount_ves, amount_ref, notes, created_by)
    values (v_store_id, v_session.id, 'opening', v_session.opening_ves, v_session.opening_ref,
            'Monto de apertura de caja', auth.uid());

    -- §4 item 2: el fondo sale del baúl. Antes se depositaba en cada cierre y
    -- nunca se retiraba, así que el baúl sobreestimaba un fondo por turno.
    perform public.ensure_store_vault(v_store_id);
    select * into v_vault from public.store_vaults where store_id = v_store_id for update;
    if v_vault.balance_efectivo_ves < v_session.opening_ves
       or v_vault.balance_ref < v_session.opening_ref then
      raise exception 'El baúl no tiene efectivo suficiente para el fondo de apertura. Disponible: Bs %, REF %. Solicitado: Bs %, REF %. Transfiere los cierres pendientes al baúl o abre con un fondo menor.',
        v_vault.balance_efectivo_ves, v_vault.balance_ref,
        v_session.opening_ves, v_session.opening_ref;
    end if;

    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves - v_session.opening_ves,
        balance_ref = balance_ref - v_session.opening_ref
    where id = v_vault.id;

    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, from_session_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'withdrawal', 'efectivo',
      v_session.opening_ves, v_session.opening_ref, v_session.id,
      'Fondo de apertura de caja (' || v_register.name || ')', auth.uid()
    );
  end if;

  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. transfer_cash_closures_to_vault — sin el rechazo por absorción
--    (copia de 20260812c sin esa validación). Ver la ADVERTENCIA de la cabecera:
--    los cierres absorbidos históricos vuelven a ser elegibles y su efectivo ya
--    fue depositado por los one-shots de agosto/septiembre.
-- -----------------------------------------------------------------------------

create or replace function public.transfer_cash_closures_to_vault(
  p_session_ids uuid[],
  p_notes text default null
) returns public.store_vaults language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_session public.cash_sessions;
  v_vault public.store_vaults;
  v_session_id uuid;
  v_amount_ves numeric(14,2);
  v_amount_ref numeric(14,2);
  v_notes text;
  v_transferred int := 0;
begin
  v_store_id := public.assert_store_context();
  if public.current_user_role() <> 'admin' then
    raise exception 'Solo un administrador puede transferir efectivo al baúl';
  end if;
  if p_session_ids is null or cardinality(p_session_ids) = 0 then
    raise exception 'Selecciona al menos un cierre de caja para transferir';
  end if;

  v_notes := nullif(trim(p_notes), '');
  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  foreach v_session_id in array p_session_ids loop
    select * into v_session
    from public.cash_sessions
    where id = v_session_id and store_id = v_store_id
    for update;

    if not found then raise exception 'Sesión de caja no encontrada'; end if;
    if v_session.status <> 'closed' then
      raise exception 'Solo se pueden transferir cierres. La caja sigue en circulación hasta que registres un cierre';
    end if;
    if v_session.vault_transferred_at is not null then
      raise exception 'El cierre seleccionado ya fue transferido al baúl';
    end if;

    v_amount_ves := round(coalesce(v_session.closing_ves, 0), 2);
    v_amount_ref := round(coalesce(v_session.closing_ref, 0), 2);
    if v_amount_ves <= 0 and v_amount_ref <= 0 then
      raise exception 'El cierre no tiene monto para transferir';
    end if;

    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, from_session_id, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'transfer_in', 'efectivo',
      v_amount_ves, v_amount_ref, v_session.id, v_notes, auth.uid()
    );

    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves + v_amount_ves,
        balance_ref = balance_ref + v_amount_ref
    where id = v_vault.id
    returning * into v_vault;

    update public.cash_sessions
    set vault_transferred_at = now()
    where id = v_session.id;

    v_transferred := v_transferred + 1;
  end loop;

  if v_transferred = 0 then
    raise exception 'Selecciona al menos un cierre de caja para transferir';
  end if;

  return v_vault;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. vault_balance_check — esperado por cubeta vs saldos denormalizados
--    (§4 item 5). `security_invoker` para que respete el RLS de quien consulta.
-- -----------------------------------------------------------------------------

drop view if exists public.vault_balance_check;
create view public.vault_balance_check
with (security_invoker = true)
as
with expected as (
  select
    store_id,
    sum(case when bucket = 'efectivo' then case
      when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ves
      when type in ('purchase_out', 'withdrawal') then -amount_ves else 0 end else 0 end) as efectivo_ves,
    sum(case when bucket = 'efectivo' then case
      when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ref
      when type in ('purchase_out', 'withdrawal') then -amount_ref else 0 end else 0 end) as efectivo_ref,
    sum(case when bucket = 'cuenta' then case
      when type in ('deposit', 'sale_in', 'transfer_in', 'adjustment') then amount_ves
      when type in ('purchase_out', 'withdrawal') then -amount_ves else 0 end else 0 end) as cuenta_ves
  from public.vault_movements
  group by store_id
)
select
  v.store_id,
  s.name as store_name,
  x.concepto,
  round(x.esperado, 2) as esperado,
  round(x.actual, 2) as actual,
  round(x.esperado - x.actual, 2) as diferencia
from public.store_vaults v
join public.stores s on s.id = v.store_id
left join expected e on e.store_id = v.store_id
cross join lateral (values
  ('EFECTIVO VES', coalesce(e.efectivo_ves, 0), v.balance_efectivo_ves),
  ('EFECTIVO REF', coalesce(e.efectivo_ref, 0), v.balance_ref),
  ('CUENTA VES', coalesce(e.cuenta_ves, 0), v.balance_ves)
) as x(concepto, esperado, actual);

comment on view public.vault_balance_check is
  'Saldo esperado por cubeta (calculado desde vault_movements) contra store_vaults. docs/cuadre-baul.md §4 item 5.';

-- -----------------------------------------------------------------------------
-- 9. Permisos
-- -----------------------------------------------------------------------------

revoke all on function public.record_cash_close_difference(uuid, uuid, numeric, numeric, numeric, numeric, uuid, text) from public;
revoke all on function public.prevent_movements_on_expired_cash_session() from public;
revoke all on function public.auto_close_stale_cash_sessions() from public;
revoke all on function public.open_cash_session(uuid, numeric, numeric) from public;
revoke all on function public.close_cash_session(uuid, numeric, numeric) from public;
revoke all on function public.transfer_cash_closures_to_vault(uuid[], text) from public;

grant execute on function public.auto_close_stale_cash_sessions() to service_role;
grant execute on function public.open_cash_session(uuid, numeric, numeric) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, numeric) to authenticated;
grant execute on function public.transfer_cash_closures_to_vault(uuid[], text) to authenticated;

revoke all on public.vault_balance_check from public;
grant select on public.vault_balance_check to authenticated, service_role;

notify pgrst, 'reload schema';
