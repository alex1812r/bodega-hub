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
--   barre "todo lo que tenga diff". Al terminar, en cada producto listado
--   current_stock = suma(quantity_delta) del libro.
--
--   Cada fila de la lista DECLARA su accion (columna action). El script ejecuta
--   la accion declarada; NO la deduce de los numeros ni del signo del libro. La
--   accion sale de la CAUSA diagnosticada del descuadre, y solo hay dos:
--
--     * stock_from_ledger  El libro manda. Los movimientos estan completos y lo
--                          que quedo mal es products.current_stock (se escribio
--                          fuera del libro). current_stock := suma del libro.
--                          No se inserta ningun movimiento. Solo SUBE el stock.
--     * ledger_from_stock  El stock manda. current_stock es el correcto (la
--                          mercancia esta contada) y al libro le falta un
--                          asiento. Se asienta UN movimiento inventario_inicial
--                          por la diferencia (current_stock - libro, siempre
--                          > 0) y current_stock queda como estaba.
--
-- Productos (informe read-only de produccion del 2026-10-06,
-- scripts/stock-lab/runs/prod-20261006/reconcile.json; tienda Bodega Las Luces
-- 7c11edd5-a569-435e-9c4f-6f0e9e84cace):
--
--   1. 17a73919-bfa7-4f69-8a27-710b2c4805f5  caja-ciga-luck-stri-ecli
--      "Caja Cigarro Lucky Strike Eclipse" — 9 movimientos
--      accion: stock_from_ledger
--        antes:   current_stock  2 | libro 12 | diff -10
--        despues: current_stock 12 | libro 12 | diff   0   (sin movimiento nuevo)
--      Origen: el 2026-09-19 un ajuste_entrada +10 (movimiento
--      ac30eb3c-4269-4c90-85fc-c5fd5b0e181a) dejo stock_after 10 cuando la
--      cadena esperaba 20. El libro tiene el +10; el stock no lo recibio.
--
--   2. 52f7ea71-9ddc-4f5d-890f-33b1f96dd3b2  glup-uva-400-ml
--      "Glup Uva 400 ml" — 1 movimiento
--      accion: ledger_from_stock
--        antes:   current_stock 0 | libro -1 | diff +1
--        despues: current_stock 0 | libro  0 | diff  0   (+1 inventario_inicial)
--      Origen: alta del 2026-10-04 con stock escrito fuera del libro (sin
--      inventario_inicial) y una venta de 1. La unidad existio y se vendio; lo
--      que falta es su asiento de entrada.
--
-- ADVERTENCIA (producto 1, diff -10): antes de aplicar, CONTAR FISICAMENTE las
-- cajas de Lucky Strike Eclipse. El libro dice 12 y el sistema 2. Este parche
-- solo es correcto si el conteo da 12. Si el conteo da otra cosa, lo correcto
-- NO es este parche sino un ajuste de inventario por la app despues de
-- desplegar (o quitar el producto de la lista y ajustar por la app).
--
-- Orden de aplicacion
--   1. Aplicar 20260909-create-sale-with-payments.sql,
--      20261005-stock-integrity-views.sql y 20261006a ... 20261006i
--      (este parche aborta, sin tocar nada y diciendo que parche falta, si:
--      el trigger stock_movements_apply no existe o esta deshabilitado, o
--      falta seq [a]; el libro no esta en modo estricto o los triggers de
--      guarda de products no estan habilitados [e]; o faltan las vistas de
--      integridad v2 [d]. Los demas parches de la serie NO se comprueban aqui:
--      correr verify-patches.sql antes).
--   2. Volver a correr
--        npm run stock-lab:reconcile -- --target production --read-only
--      Las guardas abortan sin tocar nada si current_stock, la suma del libro
--      o el numero de movimientos de un producto listado no coinciden
--      EXACTAMENTE con la lista. Ver "Si los numeros cambiaron".
--   3. Conteo fisico del producto 1 (ver ADVERTENCIA).
--   4. Ejecutar este archivo completo, una vez, como postgres.
--
-- Si los numeros cambiaron desde el informe (o el parche aborto por ellos)
--   * Actualizar en la fila SOLO expected_current_stock, expected_ledger_stock
--     y expected_movements. La columna action NO se cambia para que "pase": la
--     causa del descuadre es la misma aunque el producto se haya movido.
--     Ejemplo: Glup Uva recibe una compra de 5 antes de aplicar -> stock 5,
--     libro 4, 2 movimientos. La fila pasa a (..., 'ledger_from_stock', 5, 4, 2)
--     y el parche asienta +1 (libro 5) dejando current_stock en 5. Declararla
--     stock_from_ledger "porque el libro ya no es negativo" descontaria una
--     unidad que existe: el parche lo rechaza (ver guardas).
--   * Si la diferencia (current_stock - libro) de un producto ya no es la del
--     informe (Lucky -10, Glup +1), el diagnostico de arriba ya no explica ese
--     producto: quitarlo de la lista y revisarlo (ajuste por la app), no
--     reutilizar la fila.
--   * Si un producto ledger_from_stock ya cuadra sin el marcador de este
--     parche (alguien lo ajusto), quitarlo de la lista. Uno stock_from_ledger
--     que ya cuadra no hace falta quitarlo: se salta solo (ver Idempotencia).
--   * Si aparecio OTRO producto con diff, no se anade aqui sin diagnosticar su
--     causa y elegir su accion.
--
-- Guardas de la lista (abortan sin tocar nada)
--   * action distinta de stock_from_ledger / ledger_from_stock;
--   * el sku declarado no es products.sku del id (id mal copiado);
--   * store_id, current_stock, suma del libro o numero de movimientos distintos
--     de los declarados;
--   * ledger_from_stock con current_stock = libro y sin marcador (ya cuadra y
--     no lo asento este parche: no hay nada que corregir);
--   * stock_from_ledger con libro < 0 (nunca se escribe stock negativo);
--   * stock_from_ledger con current_stock > libro (BAJARIA el stock sin
--     movimiento: si el stock es el correcto la accion es ledger_from_stock; si
--     de verdad sobra stock, es un ajuste de salida por la app);
--   * ledger_from_stock con current_stock < libro (habria que asentar un
--     movimiento negativo "de arreglo": eso es un ajuste por la app).
--
-- Compatibilidad con el modo estricto (20261006e) y R11 (20261006g)
--   No deshabilita ningun trigger. Usa el pase previsto para one-shots:
--   products_stock_guard y stock_movements_append_only dejan pasar a
--   session_user postgres / supabase_admin. El parche aborta al empezar si se
--   ejecuta con otro session_user (p. ej. por PostgREST) o con
--   session_replication_role = replica (en ese modo los triggers normales no
--   disparan aunque figuren habilitados: ni el del libro ni las guardas).
--
-- Accion ledger_from_stock (Glup Uva): secuencia exacta y por que
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
--   en el propio asiento del parche, que se explica solo por su reason. El
--   unico movimiento que este parche actualiza es el que el mismo inserta.
--   Alternativa descartada: reescribir seq para colocar el asiento antes de la
--   venta (cadena perfecta): seq es el orden real de insercion que usa C16 y no
--   se falsea a mano.
--
-- Accion stock_from_ledger (Lucky Strike): la cadena NO queda coherente
--   El parche solo escribe products.current_stock. No toca ningun stock_after:
--   los movimientos de Lucky son historia y no se reescriben. Desde el salto
--   del 2026-09-19 todos sus stock_after van 10 por debajo del libro, asi que
--   tras el parche current_stock = 12 y el ultimo stock_after por seq sigue en
--   su valor historico: 2, igual al current_stock de antes, si ese salto es el
--   unico de la cadena (es lo que dice el informe; el valor exacto no se
--   consulto en produccion. Con otro valor L, donde abajo pone 2 lease L y
--   donde pone +10, 12 - L).
--   No hay forma de cerrar esa distancia dentro de las reglas del libro:
--     - un asiento "marcador" con delta 0 (como el de Glup) no existe: check
--       stock_movements.quantity_delta <> 0;
--     - un ajuste con delta <> 0 cambiaria la suma del libro, que es justo lo
--       que este producto tiene bien;
--     - corregir los stock_after posteriores al salto es reescribir historia.
--   Consecuencia (ver "Vistas de integridad"): la marca aparece DIFERIDA, en el
--   siguiente movimiento real del producto.
--
-- Vistas de integridad despues de aplicarlo
--   * stock_reconciliation: los dos productos dejan de aparecer.
--   * stock_chain_breaks, fila 1 (inmediata, permanente, esperada): el
--     inventario_inicial de Glup Uva asentado aqui (reason
--     'ONE_SHOT:20261006z-stock-resync ...'), con expected_stock_after 1 y
--     stock_after 0. Conceptualmente es el movimiento inicial, pero por seq
--     queda al final de la cadena (detras de la venta, cuyo stock_after es 0).
--   * stock_chain_breaks, fila 2 (DIFERIDA, permanente, esperada): el PRIMER
--     movimiento real de Lucky Strike posterior al parche, sea cual sea (venta,
--     compra, ajuste). El trigger lo calcula desde current_stock (12) y la
--     vista lo compara con el stock_after anterior (2): con delta d sale
--     stock_after = 12 + d frente a expected_stock_after = 2 + d (una venta de
--     1: 11 frente a 1). La diferencia stock_after - expected_stock_after es
--     siempre +10, lo que corrigio el parche: es la compensacion del salto de
--     -10 del movimiento ac30eb3c... No es un fallo del trigger ni de esa venta
--     o compra. Solo ese primer movimiento: desde el siguiente la cadena de
--     Lucky vuelve a ser coherente.
--     Entre la aplicacion y ese movimiento, una comprobacion del tipo
--     "current_stock <> ultimo stock_after por seq" marca a Lucky (12 frente a
--     2): tambien esperado.
--   * NO corrige (siguen apareciendo igual que en el informe): las 3 cadenas
--     rotas historicas de stock_chain_breaks — incluida la de Lucky Strike,
--     movimiento ac30eb3c..., porque no se reescribe ningun stock_after
--     historico —, el movimiento sin linea de documento
--     (movements_without_document) y la reversion sobre venta viva
--     (reversal_mismatches).
--
-- Idempotencia
--   Es POR PRODUCTO. Cada producto listado se salta por separado si ya esta
--   aplicado; los demas se procesan con todas sus guardas. Asi se puede aplicar
--   primero la lista con un solo producto (p. ej. sin Lucky, a la espera del
--   conteo) y despues el archivo completo. El parche solo es un no-op total
--   cuando todos los listados se saltan. "Ya aplicado" se evalua ANTES que las
--   guardas de numeros (tras la primera ejecucion ya no coinciden con el
--   informe) y depende de la accion:
--     * ledger_from_stock: marcador de texto en la fila que el parche crea, como
--       los demas one-shots del repo (no hay tabla de marcadores; p. ej.
--       20260812 'BACKFILL_VAULT:...'). Es el reason del movimiento asentado:
--       'ONE_SHOT:20261006z-stock-resync'. Si el producto ya tiene un movimiento
--       con ese marcador, se salta, aunque despues se haya movido.
--     * stock_from_ledger: NO deja marca; su propia condicion hace de marca. Si
--       current_stock = suma del libro, la accion (current_stock := libro) no
--       tiene nada que escribir y el producto se salta, valga lo que valga hoy
--       (pudo venderse despues de aplicarlo).
--       Por que no se marca: esta accion no crea ninguna fila. Marcarla en el
--       libro exigiria un movimiento, y con delta 0 no existe
--       (quantity_delta <> 0), con delta <> 0 cambiaria la suma del libro (lo
--       que este producto tiene bien) y moveria el stock por el trigger, y
--       escribir el marcador en el reason de un movimiento historico es
--       reescribir historia (append-only, 20261006g). Fuera del libro no hay
--       donde: el repo no tiene tabla de marcadores y crear una para un
--       one-shot es esquema nuevo. La condicion, ademas, no puede mentir: se
--       lee con el producto bloqueado y es exactamente lo que la accion deja.
--       Lo que NO distingue es "lo aplico este parche" de "lo ajusto otro":
--       en los dos casos no queda nada que hacer.
--   Un producto ledger_from_stock que ya cuadra SIN marcador no se da por
--   aplicado (no lo asento este parche): aborta por sus guardas, salvo que
--   todos los listados cuadren ya, que es un no-op.
--
-- Ensayo: scripts/stock-lab/regression/one-shot-resync-guard.test.ts ejecuta
--   ESTE archivo en el laboratorio dentro de una transaccion con rollback,
--   sustituyendo por texto solo las filas de la lista y el begin; / commit;.
--   Si se cambia la forma de la lista hay que mantener ese test.
--
-- Una sola transaccion: cualquier excepcion deja la base como estaba.
-- =============================================================================

begin;

-- Lista explicita de productos a corregir (numeros del informe del 2026-10-06).
-- action: 'stock_from_ledger' | 'ledger_from_stock' (ver cabecera). Se declara
-- por la causa del descuadre; no se cambia para acomodar numeros nuevos.
create temporary table _stock_resync_targets (
  product_id uuid primary key,
  store_id uuid not null,
  sku text not null,
  action text not null,
  expected_current_stock integer not null,
  expected_ledger_stock integer not null,
  expected_movements bigint not null
) on commit drop;

insert into _stock_resync_targets
  (product_id, store_id, sku, action, expected_current_stock, expected_ledger_stock, expected_movements)
values
  ('17a73919-bfa7-4f69-8a27-710b2c4805f5', '7c11edd5-a569-435e-9c4f-6f0e9e84cace', 'caja-ciga-luck-stri-ecli', 'stock_from_ledger', 2, 12, 9),
  ('52f7ea71-9ddc-4f5d-890f-33b1f96dd3b2', '7c11edd5-a569-435e-9c4f-6f0e9e84cace', 'glup-uva-400-ml', 'ledger_from_stock', 0, -1, 1);

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
  v_missing text;
  v_skipped uuid[] := '{}';
  v_processed integer := 0;
begin
  -- 0. Solo por conexion directa: es el pase que dan products_stock_guard
  --    (20261006e) y stock_movements_append_only (20261006g).
  if session_user not in ('postgres', 'supabase_admin') then
    raise exception
      'One-shot 20261006z: debe ejecutarse en una conexion directa como postgres (session_user actual: %)',
      session_user;
  end if;

  -- 0b. En replica los triggers normales (tgenabled 'O') no disparan aunque
  --     figuren habilitados: ni el del libro ni las guardas de products.
  if current_setting('session_replication_role') = 'replica' then
    raise exception
      'One-shot 20261006z: la sesion esta en session_replication_role = replica: los triggers del libro mayor no disparan. Ejecutar en una sesion normal (set session_replication_role = origin). No se toca nada.';
  end if;

  -- 1. Prerrequisitos: libro mayor con trigger y seq.
  if not exists (
       select 1
       from pg_trigger t
       join pg_proc f on f.oid = t.tgfoid
       where t.tgrelid = 'public.stock_movements'::regclass
         and not t.tgisinternal
         and t.tgenabled in ('O', 'A')
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

  -- 1b. Modo estricto del libro (20261006e): sin el, el trigger sigue en modo
  --     legado y este parche no se comporta como esta documentado.
  v_missing := concat_ws('; ',
    case when not exists (
      select 1
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'stock_movements_apply'
        and p.prosrc not ilike '%stock_after is null%'
        and p.prosrc not ilike '%stock_after is not null%'
        and p.prosrc ilike '%new.stock_after := v_current_stock + new.quantity_delta%'
    ) then 'stock_movements_apply() conserva la rama legada (se fia del stock_after recibido)' end,
    case when not exists (
      select 1
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'products_stock_guard'
        and p.prosrc not ilike '%current_user%'
        and p.prosrc ilike '%app.stock_writer%'
    ) then 'products_stock_guard() conserva el pase transitorio por current_user' end,
    case when not exists (
      select 1
      from pg_trigger t
      join pg_proc f on f.oid = t.tgfoid
      where t.tgrelid = 'public.products'::regclass
        and not t.tgisinternal
        and t.tgenabled in ('O', 'A')
        and f.proname = 'products_stock_guard'
        and (t.tgtype & 16) <> 0
    ) then 'el trigger de guarda de UPDATE de products (products_stock_guard) no existe o esta deshabilitado' end,
    case when not exists (
      select 1
      from pg_trigger t
      join pg_proc f on f.oid = t.tgfoid
      where t.tgrelid = 'public.products'::regclass
        and not t.tgisinternal
        and t.tgenabled in ('O', 'A')
        and f.proname = 'products_stock_guard'
        and (t.tgtype & 4) <> 0
    ) then 'el trigger de guarda de INSERT de products (products_stock_guard) no existe o esta deshabilitado' end
  );

  if v_missing <> '' then
    raise exception
      'One-shot 20261006z: falta el modo estricto del libro mayor: %. Aplicar antes 20261006e-stock-ledger-strict.sql (y habilitar los triggers si estan deshabilitados). No se toca nada.',
      v_missing;
  end if;

  -- 1c. Vistas de integridad v2 (20261006d): son el oraculo para verificar el
  --     resultado (stock_chain_breaks ordenada por seq).
  v_missing := concat_ws('; ',
    case when not exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'stock_chain_breaks'
             and column_name = 'seq'
         )
         or not coalesce(
           pg_get_viewdef(to_regclass('public.stock_chain_breaks')) ilike '%order by m.seq%', false)
      then 'stock_chain_breaks no existe o no ordena la cadena por seq' end,
    case when not coalesce(
           pg_get_viewdef(to_regclass('public.movements_without_document')) ilike '%missing_document_line%', false)
      then 'movements_without_document no existe o no detecta missing_document_line' end,
    case when not coalesce(
           pg_get_viewdef(to_regclass('public.reversal_mismatches')) ilike '%reversal_on_live_document%', false)
      then 'reversal_mismatches no existe o no detecta reversal_on_live_document' end,
    case when not exists (
           select 1
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'conversion_mismatches'
             and column_name = 'current_units_per_pack'
         )
      then 'conversion_mismatches no existe o no tiene current_units_per_pack' end
  );

  if v_missing <> '' then
    raise exception
      'One-shot 20261006z: faltan las vistas de integridad v2: %. Aplicar antes 20261006d-stock-integrity-views-v2.sql. No se toca nada.',
      v_missing;
  end if;

  -- 1d. Forma de la lista: la accion de cada fila es una de las dos previstas.
  --     No depende de los datos, asi que va antes que todo lo demas.
  for v_target in
    select * from _stock_resync_targets
    where action not in ('stock_from_ledger', 'ledger_from_stock')
    order by product_id
  loop
    raise exception
      'One-shot 20261006z: producto % (%): accion "%" desconocida. Acciones validas: stock_from_ledger, ledger_from_stock. No se toca nada.',
      v_target.product_id, v_target.sku, v_target.action;
  end loop;

  -- 2. Bloqueo de los productos listados (orden estable). Va antes de la
  --    idempotencia porque la de stock_from_ledger lee current_stock y el libro.
  perform 1
  from public.products p
  join _stock_resync_targets t on t.product_id = p.id
  order by p.id
  for update of p;

  -- 3. Idempotencia POR PRODUCTO (antes de las guardas de datos; ver cabecera).
  --    Los que entran en v_skipped no se tocan ni se comprueban mas.
  for v_target in select * from _stock_resync_targets order by product_id loop
    if exists (
      select 1
      from public.stock_movements m
      where m.product_id = v_target.product_id
        and m.reason like v_marker || '%'
    ) then
      v_skipped := v_skipped || v_target.product_id;
      raise notice 'One-shot 20261006z: % ya aplicado (marcador % en stock_movements). Se salta.',
        v_target.sku, v_marker;
    elsif v_target.action = 'stock_from_ledger'
      and exists (
        select 1
        from public.products p
        where p.id = v_target.product_id
          and p.sku = v_target.sku
          and p.store_id = v_target.store_id
          and p.current_stock = coalesce(
                (select sum(m.quantity_delta) from public.stock_movements m where m.product_id = p.id), 0)
      ) then
      v_skipped := v_skipped || v_target.product_id;
      raise notice 'One-shot 20261006z: % [stock_from_ledger] ya aplicado (current_stock = libro). Se salta.',
        v_target.sku;
    end if;
  end loop;

  if not exists (select 1 from _stock_resync_targets t where t.product_id <> all(v_skipped)) then
    raise notice 'One-shot 20261006z ya aplicado en todos los productos listados. Nada que hacer.';
    return;
  end if;

  -- 4. Guardas de los productos pendientes.

  -- Ningun pendiente descuadrado (solo quedan ledger_from_stock que cuadran sin marcador): no-op.
  select count(*) into v_pending
  from _stock_resync_targets t
  left join public.products p on p.id = t.product_id
  where t.product_id <> all(v_skipped)
    and (p.id is null
     or p.current_stock <> coalesce(
          (select sum(m.quantity_delta) from public.stock_movements m where m.product_id = t.product_id), 0));

  if v_pending = 0 then
    raise notice 'One-shot 20261006z: los productos listados pendientes ya cuadran con el libro. Nada que hacer.';
    return;
  end if;

  for v_target in
    select * from _stock_resync_targets where product_id <> all(v_skipped) order by product_id
  loop
    select p.id, p.store_id, p.sku, p.current_stock
    into v_product
    from public.products p
    where p.id = v_target.product_id;

    if not found then
      raise exception 'One-shot 20261006z: producto % (%) no encontrado',
        v_target.product_id, v_target.sku;
    end if;

    if v_product.sku is distinct from v_target.sku then
      raise exception 'One-shot 20261006z: producto %: sku declarado "%", sku en products "%". No se toca nada: revisar el id y el sku de la lista.',
        v_target.product_id, v_target.sku, v_product.sku;
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
      raise exception 'One-shot 20261006z: producto % (%): current_stock esperado %, encontrado %. No se toca nada: volver a correr el reconcile y actualizar los numeros de la lista (no la accion; ver cabecera).',
        v_target.product_id, v_target.sku, v_target.expected_current_stock, v_product.current_stock;
    end if;

    if v_ledger <> v_target.expected_ledger_stock then
      raise exception 'One-shot 20261006z: producto % (%): suma del libro esperada %, encontrada %. No se toca nada: volver a correr el reconcile y actualizar los numeros de la lista (no la accion; ver cabecera).',
        v_target.product_id, v_target.sku, v_target.expected_ledger_stock, v_ledger;
    end if;

    if v_movements <> v_target.expected_movements then
      raise exception 'One-shot 20261006z: producto % (%): movimientos esperados %, encontrados %. No se toca nada: volver a correr el reconcile y actualizar los numeros de la lista (no la accion; ver cabecera).',
        v_target.product_id, v_target.sku, v_target.expected_movements, v_movements;
    end if;

    -- La accion declarada tiene que ser aplicable al estado real (que, pasadas
    -- las guardas de arriba, es exactamente el declarado).
    if v_product.current_stock = v_ledger then
      raise exception 'One-shot 20261006z: producto % (%): ya cuadra (current_stock = libro = %). No se toca nada: quitarlo de la lista.',
        v_target.product_id, v_target.sku, v_ledger;
    end if;

    if v_target.action = 'stock_from_ledger' then
      if v_ledger < 0 then
        raise exception 'One-shot 20261006z: producto % (%): accion stock_from_ledger con libro negativo (%): nunca se escribe stock negativo. No se toca nada: si al libro le falta un asiento la accion es ledger_from_stock.',
          v_target.product_id, v_target.sku, v_ledger;
      end if;

      if v_product.current_stock > v_ledger then
        raise exception 'One-shot 20261006z: producto % (%): accion stock_from_ledger bajaria current_stock de % a % sin movimiento (descontaria unidades que el sistema cuenta). No se toca nada: si el stock es el correcto la accion es ledger_from_stock; si sobra stock, es un ajuste de salida por la app.',
          v_target.product_id, v_target.sku, v_product.current_stock, v_ledger;
      end if;
    else
      -- ledger_from_stock (1d ya descarto cualquier otra accion).
      if v_product.current_stock < v_ledger then
        raise exception 'One-shot 20261006z: producto % (%): accion ledger_from_stock exige current_stock > libro; la diferencia a asentar seria % (current_stock %, libro %). No se asientan movimientos negativos de arreglo: eso es un ajuste por la app. No se toca nada.',
          v_target.product_id, v_target.sku, v_product.current_stock - v_ledger, v_product.current_stock, v_ledger;
      end if;
    end if;
  end loop;

  -- 5. Correccion (todas las guardas pasaron): se ejecuta la accion DECLARADA.
  for v_target in
    select * from _stock_resync_targets where product_id <> all(v_skipped) order by product_id
  loop
    v_processed := v_processed + 1;

    if v_target.action = 'stock_from_ledger' then
      -- El libro manda: el stock toma el valor del libro. Sin movimiento.
      -- Guardas: libro >= 0 y current_stock < libro (solo sube).
      update public.products
      set current_stock = v_target.expected_ledger_stock
      where id = v_target.product_id;

      raise notice 'One-shot 20261006z: % [stock_from_ledger] current_stock % -> % (libro %), sin movimiento',
        v_target.sku, v_target.expected_current_stock, v_target.expected_ledger_stock,
        v_target.expected_ledger_stock;
    elsif v_target.action = 'ledger_from_stock' then
      -- El stock manda: asentar el movimiento que falta; el stock no cambia.
      -- Guarda: current_stock > libro => v_delta > 0.
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

      -- b) Las unidades ya estaban en current_stock: se devuelve al valor previo
      --    para no aplicar el delta dos veces.
      update public.products
      set current_stock = v_target.expected_current_stock
      where id = v_target.product_id;

      -- c) El ultimo stock_after de la cadena = stock real tras el asiento.
      --    Es el movimiento que este parche acaba de insertar; ningun otro se toca.
      update public.stock_movements
      set stock_after = v_target.expected_current_stock
      where id = v_movement_id;

      raise notice 'One-shot 20261006z: % [ledger_from_stock] asentado inventario_inicial +% (movimiento %); current_stock sigue en %',
        v_target.sku, v_delta, v_movement_id, v_target.expected_current_stock;
    else
      raise exception 'One-shot 20261006z: producto % (%): accion "%" sin implementar. Se revierte todo.',
        v_target.product_id, v_target.sku, v_target.action;
    end if;
  end loop;

  -- 6. Verificacion final: stock = libro y >= 0 en cada producto corregido.
  for v_target in
    select * from _stock_resync_targets where product_id <> all(v_skipped) order by product_id
  loop
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

  raise notice 'One-shot 20261006z aplicado: % productos corregidos, % saltados por estar ya aplicados.',
    v_processed, coalesce(cardinality(v_skipped), 0);
end;
$$;

commit;
