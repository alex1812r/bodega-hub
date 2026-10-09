-- =============================================================================
-- 20261015a — umbral de aviso de faltante al cerrar caja, por tienda (CNF-10)
-- Proyecto: BodegaHub (plan ux-mejoras, Ola 2; §4.8 Confirmaciones)
-- Requiere: 20260716-multi-store.sql (app_settings es una fila por tienda) y
--           20261006i (funcion public.reject_non_finite_numeric).
--
--   1. app_settings (una fila por tienda, columnas; NO clave-valor):
--        * cash_close_diff_alert_ves numeric(14,2) not null default 0
--            Faltante en Bs (contado - teorico < 0) a partir del cual el modal
--            de cierre de caja pide una confirmacion explicita. Se confirma
--            cuando |faltante| SUPERA el umbral: con 0 (el default) confirma
--            cualquier faltante. Las tiendas que ya existen reciben 0 por el
--            default de la columna: no se migra nada.
--      Check app_settings_cash_close_diff_alert_check:
--            0 <= umbral <= 999999999999.99
--   2. NaN / Infinity: Infinity no cabe en numeric(14,2) (22003) y el check ya
--      rechaza NaN (compara mayor que todo: no pasa el tope). Ademas se
--      regeneran los dos triggers trg_zz_reject_non_finite_numeric_* de
--      app_settings (20261006i los crea desde el catalogo: una columna numeric
--      nueva no entra sola), para que responda PT400 "Valor numerico invalido
--      en <columna>" tambien aqui. Mismo generador que 20261006i y 20261009b,
--      acotado a esta tabla.
--
--   Seguridad: no cambia politicas ni grants. La columna queda bajo las
--   politicas de fila que ya existen (lectura de la propia tienda, escritura
--   solo admin de la tienda) y bajo los grants de tabla vigentes.
--
-- Es SOLO un aviso de la interfaz: no toca caja, baul, pagos, cierres ni
-- ninguna RPC. close_cash_session y record_cash_close_difference no leen esta
-- columna y siguen asentando la diferencia igual (docs/cuadre-baul.md).
-- Idempotente, una sola transaccion.
-- OJO: tras reaplicar 20261006i o 20261009b no hace falta reaplicar este (sus
-- barridos ya incluyen la columna nueva).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. app_settings: umbral de aviso de faltante al cerrar caja.
-- -----------------------------------------------------------------------------

alter table public.app_settings
  add column if not exists cash_close_diff_alert_ves numeric(14,2) not null default 0;

comment on column public.app_settings.cash_close_diff_alert_ves is
  'Cierre de caja: faltante en Bs a partir del cual se pide confirmacion explicita (se confirma si |faltante| supera este valor; 0 = cualquier faltante). Solo aviso de interfaz.';

alter table public.app_settings drop constraint if exists app_settings_cash_close_diff_alert_check;
alter table public.app_settings
  add constraint app_settings_cash_close_diff_alert_check
  check (
    cash_close_diff_alert_ves >= 0
    and cash_close_diff_alert_ves <= 999999999999.99
  );

-- -----------------------------------------------------------------------------
-- 2. Triggers de 20261006i (NaN / Infinity -> PT400) regenerados para
--    app_settings con la columna numeric nueva. Mismo generador, acotado a ella.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select
      c.oid::regclass as tbl,
      string_agg(format('(new.%1$I - new.%1$I) <> 0', a.attname), ' or ' order by a.attnum) as insert_when,
      string_agg(
        format('((new.%1$I - new.%1$I) <> 0 and new.%1$I is distinct from old.%1$I)', a.attname),
        ' or ' order by a.attnum
      ) as update_when,
      string_agg(quote_literal(a.attname), ', ' order by a.attnum) as args
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid
    where c.oid = 'public.app_settings'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.atttypid = 'numeric'::regtype
    group by c.oid
  loop
    execute format('drop trigger if exists trg_zz_reject_non_finite_numeric_ins on %s', r.tbl);
    execute format('drop trigger if exists trg_zz_reject_non_finite_numeric_upd on %s', r.tbl);

    execute format(
      'create trigger trg_zz_reject_non_finite_numeric_ins before insert on %s for each row when (%s) '
      || 'execute function public.reject_non_finite_numeric(%s)',
      r.tbl, r.insert_when, r.args
    );
    execute format(
      'create trigger trg_zz_reject_non_finite_numeric_upd before update on %s for each row when (%s) '
      || 'execute function public.reject_non_finite_numeric(%s)',
      r.tbl, r.update_when, r.args
    );
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
