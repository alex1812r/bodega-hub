-- =============================================================================
-- 20261006z — One-shot: resincroniza products.current_stock con el libro mayor
-- (stock_movements) para DOS productos de Bodega Las Luces.
-- Proyecto: BodegaHub (plan stock-integrity, fase 7, STK-702)
--
-- >>> NO ESTA APLICADO en ninguna base. Es un one-shot de datos de produccion:
-- >>> queda fuera del pipeline del laboratorio (scripts/stock-lab/pipeline.ts
-- >>> excluye /one-shot/), de apply-all-pending.sql y de verify-patches.sql.
-- >>> Se aplica a mano, una vez, en una conexion directa (SQL Editor / psql como
-- >>> postgres), siguiendo el orden de mas abajo.
--
-- Que hace
--   Corrige SOLO los productos listados en _stock_resync_targets (por id). No
--   barre "todo lo que tenga diff". Fuente de verdad: el libro mayor.
--
--   Regla codificada por producto listado:
--     * Libro >= 0  -> current_stock := suma(quantity_delta). No inserta nada.
--     * Libro <  0  -> NUNCA se escribe stock negativo. Falta un movimiento en
--                      el libro: se asienta (inventario_inicial) por la
--                      diferencia y current_stock queda como estaba.
--
-- Productos (informe read-only de produccion del 2026-10-06,
-- scripts/stock-lab/runs/prod-20261006/reconcile.json; tienda Bodega Las Luces
-- 7c11edd5-a569-435e-9c4f-6f0e9e84cace):
--
--   1. 17a73919-bfa7-4f69-8a27-710b2c4805f5  caja-ciga-luck-stri-ecli
--      "Caja Cigarro Lucky Strike Eclipse" — 9 movimientos
--        antes:   current_stock  2 | libro 12 | diff -10
--        despues: current_stock 12 | libro 12 | diff   0   (sin movimiento nuevo)
--      Origen: el 2026-09-19 un ajuste_entrada +10 (movimiento
--      ac30eb3c-4269-4c90-85fc-c5fd5b0e181a) dejo stock_after 10 cuando la
--      cadena esperaba 20.
--
--   2. 52f7ea71-9ddc-4f5d-890f-33b1f96dd3b2  glup-uva-400-ml
--      "Glup Uva 400 ml" — 1 movimiento
--        antes:   current_stock 0 | libro -1 | diff +1
--        despues: current_stock 0 | libro  0 | diff  0   (+1 inventario_inicial)
--      Origen: alta del 2026-10-04 con stock escrito fuera del libro (sin
--      inventario_inicial) y una venta de 1.
--
-- ADVERTENCIA (producto 1, diff -10): antes de aplicar, CONTAR FISICAMENTE las
-- cajas de Lucky Strike Eclipse. El libro dice 12 y el sistema 2. Este parche
-- solo es correcto si el conteo da 12. Si el conteo da otra cosa, lo correcto
-- NO es este parche sino un ajuste de inventario por la app despues de
-- desplegar (o quitar el producto de la lista y ajustar por la app).
--
-- Orden de aplicacion
--   1. Aplicar 20260909-create-sale-with-payments.sql y 20261006a ... 20261006i
--      (este parche aborta si falta el trigger stock_movements_apply o seq).
--   2. Volver a correr
--        npm run stock-lab:reconcile -- --target production --read-only
--      Si current_stock, la suma del libro o el numero de movimientos de alguno
--      de los dos productos cambio (o aparecio otro producto con diff),
--      ACTUALIZAR la lista de abajo antes de aplicar. Las guardas abortan sin
--      tocar nada si los numeros no coinciden exactamente con la lista.
--   3. Conteo fisico del producto 1 (ver ADVERTENCIA).
--   4. Ejecutar este archivo completo, una vez, como postgres.
--
-- Compatibilidad con el modo estricto (20261006e) y R11 (20261006g)
--   No deshabilita ningun trigger. Usa el pase previsto para one-shots:
--   products_stock_guard y stock_movements_append_only dejan pasar a
--   session_user postgres / supabase_admin. El parche aborta al empezar si se
--   ejecuta con otro session_user (p. ej. por PostgREST).
--
-- Rama "libro < 0" (Glup Uva): secuencia exacta y por que
--   El trigger BEFORE INSERT stock_movements_apply() SIEMPRE suma el delta a
--   current_stock y fija stock_after = stock + delta. Aqui la unidad ya esta
--   contada en current_stock (lo que falta es el asiento, no la mercancia), asi
--   que dejar actuar al trigger sin mas subiria el stock a 1. Tampoco se puede
--   bajar antes el stock a -1 para compensar (check current_stock >= 0). Por eso:
--     a) insert inventario_inicial +1  -> el trigger asigna seq y deja
--        stock_after = 1 y current_stock = 1;
--     b) update products set current_stock = 0 (valor previo; pase postgres del
--        guard)                         -> el delta no queda aplicado dos veces;
--     c) update del movimiento nuevo: stock_after = 0 (pase postgres de R11)
--        -> el ultimo stock_after de la cadena coincide con current_stock.
--   Resultado: current_stock 0 = libro 0.
--   Por que (c): si se dejara stock_after = 1, la vista no marcaria nada hoy,
--   pero el PROXIMO movimiento real del producto (calculado desde
--   current_stock = 0) apareceria como cadena rota. Se prefiere dejar la marca
--   en el propio asiento del parche, que se explica solo por su reason.
--   Alternativa descartada: reescribir seq para colocar el asiento antes de la
--   venta (cadena perfecta): seq es el orden real de insercion que usa C16 y no
--   se falsea a mano.
--
-- Vistas de integridad despues de aplicarlo
--   * stock_reconciliation: los dos productos dejan de aparecer.
--   * stock_chain_breaks: aparece UNA fila nueva, permanente y esperada: el
--     inventario_inicial de Glup Uva asentado aqui (reason
--     'ONE_SHOT:20261006z-stock-resync ...'), con expected_stock_after 1 y
--     stock_after 0. Conceptualmente es el movimiento inicial, pero por seq
--     queda al final de la cadena (detras de la venta, cuyo stock_after es 0).
--   * NO corrige (siguen apareciendo igual que en el informe): las 3 cadenas
--     rotas historicas de stock_chain_breaks — incluida la de Lucky Strike,
--     movimiento ac30eb3c..., porque no se reescribe ningun stock_after
--     historico —, el movimiento sin linea de documento
--     (movements_without_document) y la reversion sobre venta viva
--     (reversal_mismatches).
--
-- Idempotencia
--   El repo no tiene tabla de marcadores: los one-shots dejan un marcador de
--   texto en una fila que crean (p. ej. 20260812 'BACKFILL_VAULT:...'). Aqui el
--   marcador es el reason del movimiento asentado:
--   'ONE_SHOT:20261006z-stock-resync'. Si ya existe un movimiento con ese
--   marcador para un producto listado, la segunda ejecucion es un no-op con
--   notice (se evalua ANTES que las guardas, porque tras la primera ejecucion
--   los numeros ya no coinciden con el informe). Si la lista se editara y no
--   quedara ningun producto de la rama "libro < 0" (sin movimiento que marque),
--   tambien es no-op cuando todos los listados ya cuadran.
--
-- Una sola transaccion: cualquier excepcion deja la base como estaba.
-- =============================================================================

begin;

-- Lista explicita de productos a corregir (numeros del informe del 2026-10-06).
create temporary table _stock_resync_targets (
  product_id uuid primary key,
  store_id uuid not null,
  sku text not null,
  expected_current_stock integer not null,
  expected_ledger_stock integer not null,
  expected_movements bigint not null
) on commit drop;

insert into _stock_resync_targets
  (product_id, store_id, sku, expected_current_stock, expected_ledger_stock, expected_movements)
values
  ('17a73919-bfa7-4f69-8a27-710b2c4805f5', '7c11edd5-a569-435e-9c4f-6f0e9e84cace', 'caja-ciga-luck-stri-ecli', 2, 12, 9),
  ('52f7ea71-9ddc-4f5d-890f-33b1f96dd3b2', '7c11edd5-a569-435e-9c4f-6f0e9e84cace', 'glup-uva-400-ml', 0, -1, 1);

do $$
declare
  v_marker constant text := 'ONE_SHOT:20261006z-stock-resync';
  v_target record;
  v_product record;
  v_ledger integer;
  v_movements bigint;
  v_delta integer;
  v_movement_id uuid;
  v_final_stock integer;
  v_pending integer;
begin
  -- 0. Solo por conexion directa: es el pase que dan products_stock_guard
  --    (20261006e) y stock_movements_append_only (20261006g).
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception
      'One-shot 20261006z: debe ejecutarse en una conexion directa como postgres (session_user actual: %)',
      session_user;
  end if;

  -- 1. Prerrequisitos: libro mayor con trigger y seq.
  if not exists (
       select 1
       from pg_trigger t
       join pg_proc f on f.oid = t.tgfoid
       where t.tgrelid = 'public.stock_movements'::regclass
         and not t.tgisinternal
         and t.tgenabled <> 'D'
         and f.proname = 'stock_movements_apply'
     )
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'stock_movements'
         and column_name = 'seq'
     ) then
    raise exception
      'One-shot 20261006z: faltan prerrequisitos (trigger stock_movements_apply activo y columna stock_movements.seq). Aplicar antes 20260909-create-sale-with-payments.sql y 20261006a ... 20261006i';
  end if;

  -- 2. Marcador de idempotencia (antes de las guardas).
  if exists (
    select 1
    from public.stock_movements m
    join _stock_resync_targets t on t.product_id = m.product_id
    where m.reason like v_marker || '%'
  ) then
    raise notice 'One-shot 20261006z ya aplicado (marcador % en stock_movements). Nada que hacer.', v_marker;
    return;
  end if;

  -- 3. Bloqueo de los productos listados (orden estable) y guardas.
  perform 1
  from public.products p
  join _stock_resync_targets t on t.product_id = p.id
  order by p.id
  for update of p;

  -- Sin movimiento que marque (lista sin rama "libro < 0"): no-op si todo cuadra ya.
  select count(*) into v_pending
  from _stock_resync_targets t
  left join public.products p on p.id = t.product_id
  where p.id is null
     or p.current_stock <> coalesce(
          (select sum(m.quantity_delta) from public.stock_movements m where m.product_id = t.product_id), 0);

  if v_pending = 0 then
    raise notice 'One-shot 20261006z: los productos listados ya cuadran con el libro. Nada que hacer.';
    return;
  end if;

  for v_target in select * from _stock_resync_targets order by product_id loop
    select p.id, p.store_id, p.current_stock
    into v_product
    from public.products p
    where p.id = v_target.product_id;

    if not found then
      raise exception 'One-shot 20261006z: producto % (%) no encontrado',
        v_target.product_id, v_target.sku;
    end if;

    select coalesce(sum(m.quantity_delta), 0)::integer, count(*)
    into v_ledger, v_movements
    from public.stock_movements m
    where m.product_id = v_target.product_id;

    if v_product.store_id <> v_target.store_id then
      raise exception 'One-shot 20261006z: producto % (%): store_id esperado %, encontrado %. No se toca nada.',
        v_target.product_id, v_target.sku, v_target.store_id, v_product.store_id;
    end if;

    if v_product.current_stock <> v_target.expected_current_stock then
      raise exception 'One-shot 20261006z: producto % (%): current_stock esperado %, encontrado %. No se toca nada: volver a correr el reconcile y actualizar la lista.',
        v_target.product_id, v_target.sku, v_target.expected_current_stock, v_product.current_stock;
    end if;

    if v_ledger <> v_target.expected_ledger_stock then
      raise exception 'One-shot 20261006z: producto % (%): suma del libro esperada %, encontrada %. No se toca nada: volver a correr el reconcile y actualizar la lista.',
        v_target.product_id, v_target.sku, v_target.expected_ledger_stock, v_ledger;
    end if;

    if v_movements <> v_target.expected_movements then
      raise exception 'One-shot 20261006z: producto % (%): movimientos esperados %, encontrados %. No se toca nada: volver a correr el reconcile y actualizar la lista.',
        v_target.product_id, v_target.sku, v_target.expected_movements, v_movements;
    end if;
  end loop;

  -- 4. Correccion (todas las guardas pasaron).
  for v_target in select * from _stock_resync_targets order by product_id loop
    if v_target.expected_ledger_stock >= 0 then
      -- Rama "libro >= 0": el stock toma el valor del libro. Sin movimiento.
      update public.products
      set current_stock = v_target.expected_ledger_stock
      where id = v_target.product_id;

      raise notice 'One-shot 20261006z: % current_stock % -> % (libro %), sin movimiento',
        v_target.sku, v_target.expected_current_stock, v_target.expected_ledger_stock,
        v_target.expected_ledger_stock;
    else
      -- Rama "libro < 0": asentar el movimiento que falta; el stock no cambia.
      -- current_stock >= 0 (check de products) y libro < 0 => v_delta > 0.
      v_delta := v_target.expected_current_stock - v_target.expected_ledger_stock;

      -- a) El trigger asigna seq, pone stock_after = stock + delta y sube el stock.
      insert into public.stock_movements (
        product_id, store_id, type, quantity_delta, reason
      )
      values (
        v_target.product_id,
        v_target.store_id,
        'inventario_inicial',
        v_delta,
        v_marker || ' asiento faltante: stock escrito fuera del libro al crear el producto (parche 20261006z-one-shot-stock-resync.sql)'
      )
      returning id into v_movement_id;

      -- b) La unidad ya estaba en current_stock: se devuelve al valor previo
      --    para no aplicar el delta dos veces.
      update public.products
      set current_stock = v_target.expected_current_stock
      where id = v_target.product_id;

      -- c) El ultimo stock_after de la cadena = stock real tras el asiento.
      update public.stock_movements
      set stock_after = v_target.expected_current_stock
      where id = v_movement_id;

      raise notice 'One-shot 20261006z: % asentado inventario_inicial +% (movimiento %); current_stock sigue en %',
        v_target.sku, v_delta, v_movement_id, v_target.expected_current_stock;
    end if;
  end loop;

  -- 5. Verificacion final: stock = libro y >= 0 en cada producto listado.
  for v_target in select * from _stock_resync_targets order by product_id loop
    select p.current_stock into v_final_stock
    from public.products p
    where p.id = v_target.product_id;

    select coalesce(sum(m.quantity_delta), 0)::integer into v_ledger
    from public.stock_movements m
    where m.product_id = v_target.product_id;

    if v_final_stock is null or v_final_stock < 0 or v_final_stock <> v_ledger then
      raise exception 'One-shot 20261006z: verificacion final fallida en % (%): current_stock %, libro %. Se revierte todo.',
        v_target.product_id, v_target.sku, v_final_stock, v_ledger;
    end if;
  end loop;

  raise notice 'One-shot 20261006z aplicado: % productos cuadran con el libro.',
    (select count(*) from _stock_resync_targets);
end;
$$;

commit;
