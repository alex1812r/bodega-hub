-- =============================================================================
-- 20261006i — las columnas numeric no aceptan NaN / Infinity (STK-625)
-- Proyecto: BodegaHub (plan stock-integrity, fase 6, reparacion tras la pasada 2)
-- Requiere: 20261006h (mismo texto de error que assert_finite_numeric). No
--           depende de ninguna RPC ni redefine ninguna.
-- Origen: .notes/stock-integrity-gtm/qa/pass-2/23-rpc-review.txt (M1, residuo de
--         N4; baja B4).
--
--   M1   20261006h rechaza NaN / Infinity en los PARAMETROS de las RPC, pero un
--        admin / almacen de la tienda podia dejar 'NaN' directamente en una
--        columna por PostgREST (PATCH /rest/v1/products {sale_price_ref:'NaN'}):
--        'NaN'::numeric cumple los check ">= 0" / "> 0" (compara mayor que todo)
--        y cabe en numeric(12,2). create_sale tomaba ese precio de lista y
--        sacaba totales NaN (los efectos de N4: venta que nunca queda pagada,
--        cobros sin tope, sumas en NaN); products.current_cost_ref NaN
--        contaminaba costo y utilidad; exchange_rates.rate_ves NaN hacia que
--        TODAS las ventas de la tienda se rechazaran por "tasa fuera de rango".
--
-- Cierre en el origen, generico: dos triggers por tabla (insert / update) que
-- rechazan con PT400 ("Valor numerico invalido en <columna>: debe ser un numero
-- finito") cualquier columna numeric que ENTRE como NaN o +-Infinity.
--
--   * Alcance: todas las tablas ordinarias de public con al menos una columna
--     numeric no generada (barrido de catalogo, seccion 2). Incluye las que
--     authenticated escribe directo (products, exchange_rates,
--     supplier_products, categories, app_settings, los dos historiales de
--     precio y las de nomina) y, como red de seguridad, las que solo escriben
--     las RPC security definer (sales, sale_items, purchases, purchase_items,
--     payments, cash_sessions, cash_movements, vault_movements, store_vaults):
--     si un NaN llegara a una RPC por un camino no previsto, no se guarda.
--   * Coste: la comprobacion vive en la clausula WHEN del trigger (la evalua el
--     ejecutor, sin entrar en plpgsql); la funcion solo se ejecuta con la fila
--     ya invalida, para nombrar la columna.
--   * (x - x) <> 0 es verdadero solo para NaN e +-Infinity (NaN - NaN = NaN,
--     Infinity - Infinity = NaN y NaN es distinto de 0), falso para un finito y
--     NULL para NULL (no dispara). No usa el literal 'Infinity'::numeric, que
--     solo existe desde PostgreSQL 14 (B4): el parche se aplica y funciona
--     igual en PostgreSQL 13.
--   * UPDATE: solo se rechaza la columna que CAMBIA a un valor no finito. Una
--     fila que ya tuviera NaN de antes del parche sigue siendo editable y
--     corregible (no se anaden constraints ni se tocan filas existentes), pero
--     ese NaN ya no puede copiarse a otra tabla: el insert de destino lo corta.
--   * El nombre trg_zz_… hace que se disparen los ultimos entre los BEFORE de
--     cada tabla (orden alfabetico): ven la fila tal como va a guardarse.
--
-- Idempotente, una sola transaccion. Ejecutar en SQL Editor o via db-up.
-- OJO: una columna usada en el WHEN de un trigger no se puede borrar ni cambiar
-- de tipo sin soltar antes los dos triggers trg_zz_reject_non_finite_numeric_*
-- de su tabla; tras el cambio (y tras anadir cualquier columna numeric nueva)
-- volver a aplicar este parche, que los regenera desde el catalogo.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Funcion de trigger unica. Recibe en tg_argv las columnas numeric de la
--    tabla y nombra la primera que entra como NaN / +-Infinity. Compara el
--    texto del valor (to_jsonb escribe NaN e Infinity como cadenas): no depende
--    de la version de Postgres. Solo se llega aqui con la fila ya rechazada por
--    el WHEN, asi que to_jsonb no pesa en el camino normal. Security invoker:
--    no lee ni escribe nada. Interna: no ejecutable por los roles de PostgREST.
-- -----------------------------------------------------------------------------

create or replace function public.reject_non_finite_numeric()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_column text;
  v_value text;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  for i in 0 .. tg_nargs - 1 loop
    v_column := tg_argv[i];
    v_value := v_new ->> v_column;

    if v_value in ('NaN', 'Infinity', '-Infinity')
       and (tg_op <> 'UPDATE' or v_value is distinct from (v_old ->> v_column)) then
      raise exception using
        errcode = 'PT400',
        message = format('Valor numerico invalido en %s: debe ser un numero finito', v_column);
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.reject_non_finite_numeric() from public, anon, authenticated;
grant execute on function public.reject_non_finite_numeric() to service_role;

-- -----------------------------------------------------------------------------
-- 2. Dos triggers por cada tabla ordinaria de public con columnas numeric no
--    generadas (las generadas se calculan despues de los BEFORE a partir de
--    columnas ya comprobadas). Se excluyen las tablas que pertenecen a una
--    extension. No se tocan filas: crear el trigger no reescribe la tabla.
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
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.atttypid = 'numeric'::regtype
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
      )
    group by c.oid
    order by c.oid::regclass::text
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
