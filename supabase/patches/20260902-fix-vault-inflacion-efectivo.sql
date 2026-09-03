-- =============================================================================
-- 20260902 — Corrección: revertir la inflación de efectivo VES en el baúl
--   y marcar como transferidos los cierres que ya cubrieron los backfills.
--
-- DIAGNÓSTICO (ver docs/cuadre-baul.md §2.3 y §6)
--
--   Efectivo VES realmente generado por caja (solo `sale_in`), acumulado:
--     hasta 20-ago fin ............................. 11 288,78
--     hasta 24-ago 00:35 ........................... 29 828,25
--     hasta 01-sep 13:00 (corte de los backfills) .. 49 919,69
--
--   Depositado al baúl como efectivo proveniente de caja:
--     20260821  BACKFILL_VAULT_CASH_SALES_THRU_20260820 .... 9 049,83
--     20260821  BACKFILL_VAULT_TRANSFER:0e06be09 ........... 2 238,95
--     20260824  BACKFILL_VAULT_CASH_THRU_20260824T0435 .... 24 405,19
--     20260901c BACKFILL_VAULT_EFECTIVO_CAJA_20260901C .... 55 785,41
--                                                  TOTAL ... 91 479,38
--
--   INFLACIÓN = 91 479,38 − 49 919,69 = 41 559,69 Bs
--
--   Dos causas, ambas documentadas:
--   a) 5 865,72 Bs de movimientos `opening` contados como ingreso. Son fondo
--      reciclado, comprobado: el cierre de 2145c5f9 (86,95) es el fondo de
--      dd0895b4, y el cierre de dd0895b4 (5 778,77) es el fondo de cab7b096.
--   b) 35 693,97 Bs ya depositados en agosto que 20260901c volvió a depositar,
--      porque se escribió con el total acumulado hardcodeado en vez del delta
--      (20260901 y 20260901b sí calculaban el delta y por eso no aplicaron).
--
-- ⚠ AL REVERTIR, EL SALDO DE EFECTIVO QUEDA NEGATIVO EN 4 380,58 Bs.
--   Las compras pagadas en efectivo (10 945,67 + 25 000,00 + 18 606,30 =
--   54 551,97) superan el efectivo realmente ingresado (49 919,69 de caja +
--   251,70 de un depósito suelto = 50 171,39). Ese faltante salió de dinero
--   que nunca se registró como entrada al baúl.
--
--   Antes de aplicar este parche hay que decidir de dónde salió y anotarlo en
--   v_aporte_no_registrado. Si se deja en NULL el parche aborta sin tocar nada.
--
-- Idempotente: FIX_VAULT_INFLACION_20260902
-- =============================================================================

do $$
declare
  v_store_id uuid := '7c11edd5-a569-435e-9c4f-6f0e9e84cace';
  v_marker text := 'FIX_VAULT_INFLACION_20260902';
  v_cutoff timestamptz := '2026-09-01T17:00:00+00'::timestamptz;
  v_user_id uuid := 'bf491e2d-d32f-4c99-9238-cb66da708409';  -- admin conocido

  -- ⇩⇩⇩ COMPLETAR ANTES DE EJECUTAR ⇩⇩⇩
  -- Efectivo que entró al baúl sin registrarse y con el que se pagaron compras.
  -- Ponlo en 0 solo si estás seguro de que no hubo tal aporte (el parche
  -- fallará por el check de saldo no negativo si hace falta y no lo cubres).
  v_aporte_no_registrado numeric(14,2) := null;
  -- ⇧⇧⇧ COMPLETAR ANTES DE EJECUTAR ⇧⇧⇧

  v_vault public.store_vaults%rowtype;
  v_caja_real numeric(14,2);
  v_depositado numeric(14,2);
  v_inflacion numeric(14,2);
  v_saldo_final numeric(14,2);
  v_marcados integer;
begin
  if exists (
    select 1 from public.vault_movements
    where store_id = v_store_id and notes like v_marker || '%'
  ) then
    raise notice 'Corrección % ya aplicada; no se repite.', v_marker;
    return;
  end if;

  -- 1. Efectivo VES realmente generado por caja hasta el corte (sin `opening`).
  select coalesce(sum(case
           when type in ('sale_in', 'adjustment') then amount_ves
           when type in ('transfer_out', 'refund_out') then -amount_ves
           else 0 end), 0)
  into v_caja_real
  from public.cash_movements
  where store_id = v_store_id and created_at < v_cutoff;

  -- 2. Efectivo depositado al baúl que se atribuyó a caja.
  select coalesce(sum(amount_ves), 0)
  into v_depositado
  from public.vault_movements
  where store_id = v_store_id
    and bucket = 'efectivo'
    and type in ('deposit', 'transfer_in')
    and (
      notes like 'BACKFILL_VAULT_CASH_SALES_THRU_20260820%'
      or notes like 'BACKFILL_VAULT_TRANSFER:%'
      or notes like 'BACKFILL_VAULT_CASH_THRU_20260824T0435%'
      or notes like 'BACKFILL_VAULT_EFECTIVO_CAJA_20260901C%'
    );

  v_inflacion := round(v_depositado - v_caja_real, 2);

  raise notice 'Caja real hasta el corte: Bs %', v_caja_real;
  raise notice 'Depositado al baul desde caja: Bs %', v_depositado;
  raise notice 'Inflacion a revertir: Bs %', v_inflacion;

  if v_inflacion <= 0 then
    raise notice 'No hay inflacion que revertir.';
    return;
  end if;

  perform public.ensure_store_vault(v_store_id);
  select * into v_vault from public.store_vaults where store_id = v_store_id for update;

  v_saldo_final := round(
    v_vault.balance_efectivo_ves - v_inflacion + coalesce(v_aporte_no_registrado, 0), 2);

  if v_saldo_final < 0 then
    raise exception
      'El saldo de efectivo quedaria en % Bs. Define v_aporte_no_registrado (faltan % Bs) antes de aplicar.',
      v_saldo_final, abs(v_saldo_final);
  end if;

  -- 3. Reversar la inflación.
  insert into public.vault_movements (
    store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by
  ) values (
    v_store_id, v_vault.id, 'withdrawal', 'efectivo', v_inflacion, 0,
    v_marker || ' reversa de efectivo VES inflado por los backfills 20260824 y 20260901c '
      || '(fondos opening reciclados + redeposito de lo ya transferido)',
    v_user_id
  );

  update public.store_vaults
  set balance_efectivo_ves = balance_efectivo_ves - v_inflacion, updated_at = now()
  where id = v_vault.id;

  -- 4. Registrar el efectivo que entró sin documentar, si se declaró.
  if coalesce(v_aporte_no_registrado, 0) > 0 then
    insert into public.vault_movements (
      store_id, vault_id, type, bucket, amount_ves, amount_ref, notes, created_by
    ) values (
      v_store_id, v_vault.id, 'deposit', 'efectivo', v_aporte_no_registrado, 0,
      v_marker || ' aporte de efectivo no registrado que cubrio compras en efectivo',
      v_user_id
    );

    update public.store_vaults
    set balance_efectivo_ves = balance_efectivo_ves + v_aporte_no_registrado, updated_at = now()
    where id = v_vault.id;
  end if;

  -- 5. Marcar como transferidos los cierres cuyo efectivo ya cubrieron los
  --    backfills, para que "cierres pendientes" solo muestre lo que sigue en
  --    el cajón (el cierre de 56e8d753 del 01-sep).
  update public.cash_sessions
  set vault_transferred_at = v_cutoff
  where store_id = v_store_id
    and status = 'closed'
    and closed_at < v_cutoff
    and vault_transferred_at is null;
  get diagnostics v_marcados = row_count;

  raise notice 'OK: revertidos % Bs, aporte %, cierres marcados como transferidos: %',
    v_inflacion, coalesce(v_aporte_no_registrado, 0), v_marcados;
end;
$$;

-- Verificación posterior:
--   \i supabase/patches/20260901-query-vault-balance-calc.sql
--   select count(*) from public.cash_sessions
--   where store_id = '7c11edd5-a569-435e-9c4f-6f0e9e84cace'
--     and status = 'closed' and vault_transferred_at is null;  -- esperado: 1
