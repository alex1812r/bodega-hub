/** @jest-environment node */
/**
 * STK-650 · guarda de prerrequisitos del one-shot 20261006z (resync de stock).
 *
 * La cabecera del one-shot exige los parches 20261006a…i, pero su guarda solo
 * comprobaba el parche a (trigger `stock_movements_apply` + columna `seq`). Sobre
 * una base con a pero sin el modo estricto (e) o sin las vistas v2 (d) seguía
 * adelante. Cada test enuncia el comportamiento SANO: aborta antes de tocar nada
 * y dice qué parche falta.
 *
 * El one-shot se ejecuta TAL CUAL está en el archivo (solo se le quitan por texto
 * el `begin;` y el `commit;` exteriores) dentro de una transacción que SIEMPRE
 * hace rollback. Los "sin e" / "sin d" se simulan dentro de esa transacción.
 * En la base lab no existen los dos productos de producción: con a–i aplicados
 * el archivo llega a la guarda de datos y aborta ahí ("no encontrado").
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/one-shot-resync-guard.test.ts
 *
 * STK-656 · camino que ESCRIBE y acción explícita por producto. Dentro de la
 * misma transacción con rollback se crean una tienda y productos de prueba que
 * reproducen las dos situaciones de producción (stock por debajo del libro;
 * venta sin `inventario_inicial`) y se ejecuta el archivo REAL sustituyendo por
 * texto solo las filas de `_stock_resync_targets`. Lo escrito se lee DENTRO de
 * la transacción, antes de deshacer.
 *
 * Un fallo de preparación lanza un error que empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";

import { resolveStockLabDbUrl, tryConnect, withRollback } from "../db-test-utils";
import { extractViewQueries } from "../integrity-views";

const PATCHES = resolve(__dirname, "..", "..", "..", "supabase", "patches");
const ONE_SHOT = "20261006z-one-shot-stock-resync.sql";

const MSG_DATA_GUARD = /One-shot 20261006z: producto .* no encontrado/;
const MSG_PATCH_A = /faltan prerrequisitos \(trigger stock_movements_apply activo/;
const MSG_PATCH_E = /falta el modo estricto del libro mayor/;
const FILE_PATCH_E = /20261006e-stock-ledger-strict\.sql/;
const MSG_PATCH_D = /faltan las vistas de integridad v2/;
const FILE_PATCH_D = /20261006d-stock-integrity-views-v2\.sql/;

interface Snapshot {
  products: number;
  products_hash: string;
  movements: number;
  movements_hash: string;
}

interface Attempt {
  /** Mensaje de la excepción del one-shot, o null si terminó sin error. */
  error: string | null;
  /** `products` / `stock_movements` justo antes de ejecutar, dentro de la transacción. */
  before: Snapshot;
  /**
   * Lo que el one-shot dejó escrito, leído ANTES de deshacer el savepoint. null si
   * abortó: PostgreSQL no deja leer en una transacción abortada y la revierte entera.
   */
  written: Snapshot | null;
  /** Después de `rollback to savepoint` (solo comprueba que el arnés deshace). */
  restored: Snapshot;
}

let client: Client;
let baseline: Snapshot;

function readPatch(name: string): string {
  return readFileSync(resolve(PATCHES, name), "utf8").replace(/\r\n/g, "\n");
}

/** El archivo real sin su `begin;` / `commit;` exteriores (exactamente uno de cada). */
function oneShotBody(): string {
  const sql = readPatch(ONE_SHOT);
  const begins = sql.match(/^begin;$/gm) ?? [];
  const commits = sql.match(/^commit;$/gm) ?? [];
  if (begins.length !== 1 || commits.length !== 1) {
    throw new Error(`SETUP · ${ONE_SHOT}: se esperaba un begin; y un commit; exteriores (${begins.length}/${commits.length})`);
  }
  return sql.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
}

/** `create or replace function public.<name>() … $$;` tal cual está en el parche. */
function functionFromPatch(patch: string, name: string): string {
  const match = new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\n\\$\\$;`).exec(readPatch(patch));
  if (!match) throw new Error(`SETUP · ${patch}: no se encontró la función ${name}()`);
  return match[0];
}

async function snapshot(tx: Client): Promise<Snapshot> {
  const result = await tx.query<Snapshot>(
    `select
       (select count(*)::int from public.products) as products,
       (select md5(coalesce(string_agg(p.id::text || ':' || p.current_stock, ',' order by p.id), ''))
          from public.products p) as products_hash,
       (select count(*)::int from public.stock_movements) as movements,
       (select md5(coalesce(string_agg(m.id::text || ':' || m.quantity_delta || ':' || m.stock_after, ',' order by m.id), ''))
          from public.stock_movements m) as movements_hash`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("SETUP · snapshot: sin fila");
  return row;
}

/** Simula el estado, ejecuta el one-shot real y deshace TODO (savepoint + rollback). */
async function attempt(simulate?: (tx: Client) => Promise<void>): Promise<Attempt> {
  const body = oneShotBody();
  return withRollback(client, async (tx) => {
    if (simulate) {
      try {
        await simulate(tx);
      } catch (error) {
        throw new Error(`SETUP · simulación: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const before = await snapshot(tx);
    await tx.query("savepoint one_shot_attempt");
    let error: string | null = null;
    let written: Snapshot | null = null;
    try {
      await tx.query(body);
      written = await snapshot(tx);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    await tx.query("rollback to savepoint one_shot_attempt");
    const restored = await snapshot(tx);
    return { error, before, written, restored };
  });
}

/**
 * "Aborta sin tocar nada": o el one-shot lanzó (la excepción revierte todo lo que
 * hubiera escrito) o terminó sin error y lo que se lee ANTES de deshacer es
 * idéntico a lo que había. Un one-shot que escriba y termine sin error falla aquí.
 */
function expectNothingWritten(result: Attempt): void {
  if (result.error === null) {
    expect(result.written).toEqual(result.before);
  } else {
    expect(result.written).toBeNull();
  }
  expect(result.restored).toEqual(result.before);
}

beforeAll(async () => {
  const connected = await tryConnect(resolveStockLabDbUrl(), 10_000);
  if (!connected) throw new Error("SETUP · la base lab no responde (npm run stock-lab:db-up)");
  client = connected;
  baseline = await snapshot(client);
});

// El arnés nunca deja nada en la base (un `commit;` colado en el archivo se vería aquí).
afterEach(async () => {
  expect(await snapshot(client)).toEqual(baseline);
});

afterAll(async () => {
  await client?.end();
});

describe("STK-650 · one-shot 20261006z: guarda de prerrequisitos", () => {
  it("con a–i aplicados la guarda de prerrequisitos pasa y aborta la guarda de datos (productos de producción ausentes en lab)", async () => {
    const result = await attempt();

    expect(result.error).toMatch(MSG_DATA_GUARD);
    expect(result.error).not.toMatch(MSG_PATCH_A);
    expect(result.error).not.toMatch(MSG_PATCH_E);
    expect(result.error).not.toMatch(MSG_PATCH_D);
    expectNothingWritten(result);
  });

  it("sin e (stock_movements_apply con la rama legada del parche a) aborta nombrando el parche e", async () => {
    const legacy = functionFromPatch("20261006a-stock-ledger-guards.sql", "stock_movements_apply");
    expect(legacy).toMatch(/stock_after is null/);

    const result = await attempt(async (tx) => {
      await tx.query(legacy);
    });

    expect(result.error).toMatch(MSG_PATCH_E);
    expect(result.error).toMatch(FILE_PATCH_E);
    expect(result.error).toMatch(/stock_movements_apply/);
    expectNothingWritten(result);
  });

  it("sin e (products_stock_guard con el pase current_user del parche a) aborta nombrando el parche e", async () => {
    const legacy = functionFromPatch("20261006a-stock-ledger-guards.sql", "products_stock_guard");
    expect(legacy).toMatch(/current_user = 'postgres'/);

    const result = await attempt(async (tx) => {
      await tx.query(legacy);
    });

    expect(result.error).toMatch(MSG_PATCH_E);
    expect(result.error).toMatch(FILE_PATCH_E);
    expect(result.error).toMatch(/products_stock_guard/);
    expectNothingWritten(result);
  });

  it.each(["trg_products_stock_guard_update", "trg_products_stock_guard_insert"])(
    "con el trigger de guarda %s de products deshabilitado aborta nombrando el parche e",
    async (trigger) => {
      const result = await attempt(async (tx) => {
        await tx.query(`alter table public.products disable trigger ${trigger}`);
      });

      expect(result.error).toMatch(MSG_PATCH_E);
      expect(result.error).toMatch(FILE_PATCH_E);
      expectNothingWritten(result);
    },
  );

  it("sin d (falta la vista stock_chain_breaks) aborta nombrando el parche d", async () => {
    const result = await attempt(async (tx) => {
      await tx.query("drop view public.stock_chain_breaks");
    });

    expect(result.error).toMatch(MSG_PATCH_D);
    expect(result.error).toMatch(FILE_PATCH_D);
    expectNothingWritten(result);
  });

  it("sin d (stock_chain_breaks en su forma v1: orden por created_at, sin columna seq) aborta nombrando el parche d", async () => {
    const v1 = extractViewQueries(readPatch("20261005-stock-integrity-views.sql")).stock_chain_breaks;
    expect(v1).toMatch(/order by m\.created_at/);

    const result = await attempt(async (tx) => {
      await tx.query("drop view public.stock_chain_breaks");
      await tx.query(`create view public.stock_chain_breaks with (security_invoker = true) as\n${v1}`);
    });

    expect(result.error).toMatch(MSG_PATCH_D);
    expect(result.error).toMatch(FILE_PATCH_D);
    expect(result.error).toMatch(/stock_chain_breaks/);
    expectNothingWritten(result);
  });

  it("con el trigger stock_movements_apply deshabilitado (existe pero no dispara) aborta en la guarda del parche a", async () => {
    const result = await attempt(async (tx) => {
      await tx.query("alter table public.stock_movements disable trigger trg_stock_movements_apply");
    });

    expect(result.error).toMatch(MSG_PATCH_A);
    expectNothingWritten(result);
  });

  it("con el trigger stock_movements_apply en modo replica (no dispara en una sesión normal) aborta en la guarda del parche a", async () => {
    const result = await attempt(async (tx) => {
      await tx.query("alter table public.stock_movements enable replica trigger trg_stock_movements_apply");
    });

    expect(result.error).toMatch(MSG_PATCH_A);
    expectNothingWritten(result);
  });
});

// ---------------------------------------------------------------------------
// STK-656 · camino que escribe + acción explícita por producto
// ---------------------------------------------------------------------------

const MARKER = "ONE_SHOT:20261006z-stock-resync";

const MSG_UNKNOWN_ACTION = /accion "borrar_todo" desconocida/;
const MSG_SKU_MISMATCH = /sku declarado ".*", sku en products ".*"/;
const MSG_NEGATIVE_LEDGER = /accion stock_from_ledger con libro negativo \(-1\)/;
const MSG_WOULD_LOWER = /accion stock_from_ledger bajaria current_stock de 5 a 4 sin movimiento/;
const MSG_NOTHING_TO_POST = /accion ledger_from_stock exige current_stock > libro/;
const MSG_STALE_NUMBERS = /current_stock esperado 0, encontrado 5/;

type Action = "stock_from_ledger" | "ledger_from_stock";

interface Product {
  id: string;
  sku: string;
}

interface Fixture {
  storeId: string;
  /** Como Lucky Strike: salto histórico de −10 en la cadena. current_stock 2, libro 12, 3 movimientos. */
  lucky: Product;
  /** Como Glup Uva: alta con stock fuera del libro y una venta. current_stock 0, libro −1, 1 movimiento. */
  glup: Product;
  /** Descuadrado y NO listado: current_stock 7, libro 5. El one-shot no barre "todo lo que tenga diff". */
  bystander: Product;
}

interface ProductState {
  current_stock: number;
  ledger: number;
  movements: number;
  /** Filas del producto en `stock_reconciliation` (0 = cuadra). */
  reconciliation: number;
}

interface MarkerMovement {
  id: string;
  type: string;
  quantity_delta: number;
  stock_after: number;
}

interface ChainBreak {
  movement_id: string;
  expected_stock_after: number;
  stock_after: number;
}

async function one<T extends object>(tx: Client, what: string, sql: string, params: unknown[]): Promise<T> {
  let rows: T[];
  try {
    rows = (await tx.query<T>(sql, params)).rows;
  } catch (error) {
    throw new Error(`SETUP · ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const row = rows[0];
  if (!row) throw new Error(`SETUP · ${what}: sin fila`);
  return row;
}

async function insertProduct(tx: Client, storeId: string, sku: string): Promise<Product> {
  const row = await one<{ id: string }>(
    tx,
    `producto ${sku}`,
    "insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock) values ($1, $2, $3, 1.5, 1, 0) returning id",
    [storeId, sku, `Producto ${sku}`],
  );
  return { id: row.id, sku };
}

/** Movimiento por el trigger del libro (asigna seq y stock_after y mueve el stock). Devuelve su id. */
async function move(tx: Client, storeId: string, product: Product, type: string, delta: number): Promise<string> {
  const row = await one<{ id: string }>(
    tx,
    `movimiento ${type} ${delta} de ${product.sku}`,
    "insert into public.stock_movements (product_id, store_id, type, quantity_delta, reason) values ($1, $2, $3, $4, 'R656 fixture') returning id",
    [product.id, storeId, type, delta],
  );
  return row.id;
}

/** Escritura directa como postgres (pase de `products_stock_guard`): así nacieron los dos descuadres. */
async function writeStockOffLedger(tx: Client, product: Product, stock: number): Promise<void> {
  await one(tx, `stock fuera del libro de ${product.sku}`, "update public.products set current_stock = $2 where id = $1 returning id", [
    product.id,
    stock,
  ]);
}

async function buildFixture(tx: Client): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const store = await one<{ id: string }>(tx, "tienda", "insert into public.stores (name, slug) values ($1, $2) returning id", [
    `R656 ${suffix}`,
    `r656-${suffix}`,
  ]);
  const storeId = store.id;

  // Lucky: +10, +10 (queda en 20) y el salto del 2026-09-19: ese ajuste "dejó stock_after 10
  // cuando la cadena esperaba 20". Desde ahí todo va 10 por debajo; luego se venden 8.
  const lucky = await insertProduct(tx, storeId, `R656-LUCKY-${suffix}`);
  await move(tx, storeId, lucky, "inventario_inicial", 10);
  const jump = await move(tx, storeId, lucky, "ajuste_entrada", 10);
  await one(tx, "salto histórico de Lucky", "update public.stock_movements set stock_after = 10 where id = $1 returning id", [jump]);
  await writeStockOffLedger(tx, lucky, 10);
  await move(tx, storeId, lucky, "venta", -8);

  // Glup: alta con 1 unidad escrita fuera del libro (sin inventario_inicial) y una venta de 1.
  const glup = await insertProduct(tx, storeId, `R656-GLUP-${suffix}`);
  await writeStockOffLedger(tx, glup, 1);
  await move(tx, storeId, glup, "venta", -1);

  const bystander = await insertProduct(tx, storeId, `R656-OTRO-${suffix}`);
  await move(tx, storeId, bystander, "inventario_inicial", 5);
  await writeStockOffLedger(tx, bystander, 7);

  return { storeId, lucky, glup, bystander };
}

function targetRow(
  fx: Fixture,
  product: Product,
  action: string,
  expected: { stock: number; ledger: number; movements: number },
  sku = product.sku,
): string {
  return `('${product.id}', '${fx.storeId}', '${sku}', '${action}', ${expected.stock}, ${expected.ledger}, ${expected.movements})`;
}

/** El archivo real con SOLO las filas de `_stock_resync_targets` sustituidas (y sin begin; / commit;). */
function oneShotWithTargets(rows: string[]): string {
  const body = oneShotBody();
  const pattern = /(insert into _stock_resync_targets\n\s*\([^)]*\)\nvalues\n)[\s\S]*?;\n/g;
  if ((body.match(pattern) ?? []).length !== 1) {
    throw new Error(`SETUP · ${ONE_SHOT}: no se encontró (una sola vez) la lista de _stock_resync_targets`);
  }
  return body.replace(pattern, (_all, head: string) => `${head}  ${rows.join(",\n  ")};\n`);
}

/**
 * Ejecuta el one-shot con esas filas dentro de la transacción abierta. Si aborta,
 * deshace hasta el savepoint (el fixture sigue ahí) y devuelve el mensaje. Si
 * termina, deja lo escrito a la vista y suelta la tabla temporal, que es lo que
 * haría el `commit;` del archivo (`on commit drop`).
 */
async function apply(tx: Client, rows: string[]): Promise<string | null> {
  const sql = oneShotWithTargets(rows);
  await tx.query("savepoint one_shot_run");
  try {
    await tx.query(sql);
  } catch (caught) {
    await tx.query("rollback to savepoint one_shot_run");
    return caught instanceof Error ? caught.message : String(caught);
  }
  await tx.query("drop table _stock_resync_targets");
  await tx.query("release savepoint one_shot_run");
  return null;
}

async function stateOf(tx: Client, product: Product): Promise<ProductState> {
  return one<ProductState>(
    tx,
    `estado de ${product.sku}`,
    `select p.current_stock,
            (select coalesce(sum(m.quantity_delta), 0)::int from public.stock_movements m where m.product_id = p.id) as ledger,
            (select count(*)::int from public.stock_movements m where m.product_id = p.id) as movements,
            (select count(*)::int from public.stock_reconciliation r where r.product_id = p.id) as reconciliation
     from public.products p
     where p.id = $1`,
    [product.id],
  );
}

async function markerMovements(tx: Client, product: Product): Promise<MarkerMovement[]> {
  const result = await tx.query<MarkerMovement>(
    `select m.id, m.type::text as type, m.quantity_delta, m.stock_after
     from public.stock_movements m
     where m.product_id = $1 and starts_with(coalesce(m.reason, ''), $2)
     order by m.seq`,
    [product.id, MARKER],
  );
  return result.rows;
}

async function chainBreaks(tx: Client, product: Product): Promise<ChainBreak[]> {
  const result = await tx.query<ChainBreak>(
    "select b.movement_id, b.expected_stock_after, b.stock_after from public.stock_chain_breaks b where b.product_id = $1 order by b.seq",
    [product.id],
  );
  return result.rows;
}

/** Todo `products` / `stock_movements` salvo los productos indicados. */
async function snapshotExcept(tx: Client, products: Product[]): Promise<{ products: string; movements: string }> {
  return one<{ products: string; movements: string }>(
    tx,
    "snapshot del resto",
    `select
       (select count(*) || ':' || md5(coalesce(string_agg(p.id::text || ':' || p.current_stock, ',' order by p.id), ''))
          from public.products p where p.id <> all($1::uuid[])) as products,
       (select count(*) || ':' || md5(coalesce(string_agg(m.id::text || ':' || m.quantity_delta || ':' || m.stock_after, ',' order by m.id), ''))
          from public.stock_movements m where m.product_id <> all($1::uuid[])) as movements`,
    [products.map((product) => product.id)],
  );
}

/** Fixture + cuerpo del test, todo dentro de una transacción que SIEMPRE hace rollback. */
function scenario<T>(fn: (tx: Client, fx: Fixture) => Promise<T>): Promise<T> {
  return withRollback(client, async (tx) => fn(tx, await buildFixture(tx)));
}

/** "Glup Uva con compra posterior": entran 5 antes de aplicar. current_stock 5, libro 4, 2 movimientos. */
async function restockGlup(tx: Client, fx: Fixture): Promise<void> {
  await move(tx, fx.storeId, fx.glup, "compra", 5);
}

const STOCK_FROM_LEDGER: Action = "stock_from_ledger";
const LEDGER_FROM_STOCK: Action = "ledger_from_stock";

const LUCKY_NUMBERS = { stock: 2, ledger: 12, movements: 3 };
const GLUP_NUMBERS = { stock: 0, ledger: -1, movements: 1 };
const GLUP_RESTOCKED_NUMBERS = { stock: 5, ledger: 4, movements: 2 };

const LUCKY_BROKEN: ProductState = { current_stock: 2, ledger: 12, movements: 3, reconciliation: 1 };
const GLUP_BROKEN: ProductState = { current_stock: 0, ledger: -1, movements: 1, reconciliation: 1 };
const GLUP_RESTOCKED_BROKEN: ProductState = { current_stock: 5, ledger: 4, movements: 2, reconciliation: 1 };

function productionLikeTargets(fx: Fixture): string[] {
  return [targetRow(fx, fx.lucky, STOCK_FROM_LEDGER, LUCKY_NUMBERS), targetRow(fx, fx.glup, LEDGER_FROM_STOCK, GLUP_NUMBERS)];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shape(rows: MarkerMovement[]): Array<Omit<MarkerMovement, "id">> {
  return rows.map(({ type, quantity_delta, stock_after }) => ({ type, quantity_delta, stock_after }));
}

describe("STK-656 · one-shot 20261006z: el fixture reproduce las dos situaciones de producción", () => {
  it("Lucky: stock 2 bajo un libro de 12 con el último stock_after en 2; Glup: libro −1 con stock 0", async () => {
    const seen = await scenario(async (tx, fx) => ({
      lucky: await stateOf(tx, fx.lucky),
      luckyBreaks: (await chainBreaks(tx, fx.lucky)).map(({ expected_stock_after, stock_after }) => ({ expected_stock_after, stock_after })),
      glup: await stateOf(tx, fx.glup),
      bystander: await stateOf(tx, fx.bystander),
    }));

    expect(seen.lucky).toEqual(LUCKY_BROKEN);
    expect(seen.luckyBreaks).toEqual([{ expected_stock_after: 20, stock_after: 10 }]);
    expect(seen.glup).toEqual(GLUP_BROKEN);
    expect(seen.bystander).toEqual({ current_stock: 7, ledger: 5, movements: 1, reconciliation: 1 });
  });
});

describe("STK-656 · one-shot 20261006z: camino que escribe", () => {
  it("stock_from_ledger deja current_stock = Σ libro sin movimiento; ledger_from_stock asienta un movimiento por la diferencia; nada más cambia", async () => {
    const seen = await scenario(async (tx, fx) => {
      const restBefore = await snapshotExcept(tx, [fx.lucky, fx.glup]);
      const luckyBreaksBefore = await chainBreaks(tx, fx.lucky);
      const error = await apply(tx, productionLikeTargets(fx));
      const marker = await markerMovements(tx, fx.glup);
      const glupBreaks = await chainBreaks(tx, fx.glup);
      return {
        error,
        lucky: await stateOf(tx, fx.lucky),
        luckyMarker: await markerMovements(tx, fx.lucky),
        luckyBreaksUnchanged: same(await chainBreaks(tx, fx.lucky), luckyBreaksBefore),
        glup: await stateOf(tx, fx.glup),
        marker: shape(marker),
        glupBreaksAreTheMarker: same(glupBreaks.map((row) => row.movement_id), marker.map((row) => row.id)),
        bystander: await stateOf(tx, fx.bystander),
        restUnchanged: same(await snapshotExcept(tx, [fx.lucky, fx.glup]), restBefore),
      };
    });

    expect(seen.error).toBeNull();
    // A · el libro manda: 2 → 12, los mismos 3 movimientos, sin fila nueva de cadena hoy.
    expect(seen.lucky).toEqual({ current_stock: 12, ledger: 12, movements: 3, reconciliation: 0 });
    expect(seen.luckyMarker).toEqual([]);
    expect(seen.luckyBreaksUnchanged).toBe(true);
    // B · el stock manda: exactamente un inventario_inicial +1; el stock sigue en 0.
    expect(seen.glup).toEqual({ current_stock: 0, ledger: 0, movements: 2, reconciliation: 0 });
    expect(seen.marker).toEqual([{ type: "inventario_inicial", quantity_delta: 1, stock_after: 0 }]);
    expect(seen.glupBreaksAreTheMarker).toBe(true);
    // El descuadrado que no está en la lista sigue igual, y el resto de la base también.
    expect(seen.bystander).toEqual({ current_stock: 7, ledger: 5, movements: 1, reconciliation: 1 });
    expect(seen.restUnchanged).toBe(true);
  });

  it("segunda ejecución con la misma lista: no-op por el marcador, sin ningún cambio", async () => {
    const seen = await scenario(async (tx, fx) => {
      const first = await apply(tx, productionLikeTargets(fx));
      const afterFirst = await snapshot(tx);
      const second = await apply(tx, productionLikeTargets(fx));
      return { first, second, unchanged: same(await snapshot(tx), afterFirst), markers: (await markerMovements(tx, fx.glup)).length };
    });

    expect(seen.first).toBeNull();
    expect(seen.second).toBeNull();
    expect(seen.unchanged).toBe(true);
    expect(seen.markers).toBe(1);
  });

  it("segunda ejecución de una lista solo con stock_from_ledger (sin movimiento que marque): no-op sin ningún cambio", async () => {
    const seen = await scenario(async (tx, fx) => {
      const rows = [targetRow(fx, fx.lucky, STOCK_FROM_LEDGER, LUCKY_NUMBERS)];
      const first = await apply(tx, rows);
      const afterFirst = await snapshot(tx);
      const second = await apply(tx, rows);
      return { first, second, unchanged: same(await snapshot(tx), afterFirst), lucky: await stateOf(tx, fx.lucky) };
    });

    expect(seen.first).toBeNull();
    expect(seen.second).toBeNull();
    expect(seen.unchanged).toBe(true);
    expect(seen.lucky).toEqual({ current_stock: 12, ledger: 12, movements: 3, reconciliation: 0 });
  });

  // S1/Z-2: documentado en la cabecera del parche y en docs/stock-integrity.md §6. Si esto
  // cambia (p. ej. el parche pasa a dejar la cadena coherente), hay que cambiar los docs.
  it("tras stock_from_ledger el SIGUIENTE movimiento real del producto aparece en stock_chain_breaks por la diferencia corregida (fila esperada)", async () => {
    const seen = await scenario(async (tx, fx) => {
      const error = await apply(tx, productionLikeTargets(fx));
      const before = (await chainBreaks(tx, fx.lucky)).map((row) => row.movement_id);
      const sale = await move(tx, fx.storeId, fx.lucky, "venta", -1);
      const added = (await chainBreaks(tx, fx.lucky)).filter((row) => !before.includes(row.movement_id));
      const second = await move(tx, fx.storeId, fx.lucky, "venta", -1);
      const afterSecond = (await chainBreaks(tx, fx.lucky)).map((row) => row.movement_id);
      return { error, sale, added, secondIsBreak: afterSecond.includes(second), lucky: await stateOf(tx, fx.lucky) };
    });

    expect(seen.error).toBeNull();
    // Último stock_after histórico 2; el trigger calcula desde current_stock 12: 11 donde la vista espera 1.
    expect(seen.added).toEqual([{ movement_id: seen.sale, expected_stock_after: 1, stock_after: 11 }]);
    // Solo el primero: desde ahí la cadena vuelve a ser coherente y el stock sigue cuadrando.
    expect(seen.secondIsBreak).toBe(false);
    expect(seen.lucky).toEqual({ current_stock: 10, ledger: 10, movements: 5, reconciliation: 0 });
  });
});

describe("STK-656 · one-shot 20261006z: la acción se declara por producto, no se deduce del signo del libro (Z-1)", () => {
  it("Glup con compra posterior y la lista actualizada (5, 4, 2) con su acción ledger_from_stock: asienta +1 y NO descuenta la unidad", async () => {
    const seen = await scenario(async (tx, fx) => {
      await restockGlup(tx, fx);
      const error = await apply(tx, [targetRow(fx, fx.glup, LEDGER_FROM_STOCK, GLUP_RESTOCKED_NUMBERS)]);
      return { error, glup: await stateOf(tx, fx.glup), marker: shape(await markerMovements(tx, fx.glup)) };
    });

    expect(seen.error).toBeNull();
    expect(seen.glup).toEqual({ current_stock: 5, ledger: 5, movements: 3, reconciliation: 0 });
    expect(seen.marker).toEqual([{ type: "inventario_inicial", quantity_delta: 1, stock_after: 5 }]);
  });

  it("Glup con compra posterior declarado por error como stock_from_ledger: aborta, la unidad sigue en el stock", async () => {
    const seen = await scenario(async (tx, fx) => {
      await restockGlup(tx, fx);
      const error = await apply(tx, [targetRow(fx, fx.glup, STOCK_FROM_LEDGER, GLUP_RESTOCKED_NUMBERS)]);
      return { error, glup: await stateOf(tx, fx.glup) };
    });

    // Con la rama elegida por el signo del libro (libro 4 >= 0): current_stock 5 → 4, sin error.
    expect(seen.glup).toEqual(GLUP_RESTOCKED_BROKEN);
    expect(seen.error).toMatch(MSG_WOULD_LOWER);
  });

  it("Glup con compra posterior y la lista SIN actualizar: aborta en la guarda de números exactos", async () => {
    const seen = await scenario(async (tx, fx) => {
      await restockGlup(tx, fx);
      const error = await apply(tx, productionLikeTargets(fx));
      return { error, glup: await stateOf(tx, fx.glup), lucky: await stateOf(tx, fx.lucky) };
    });

    expect(seen.error).toMatch(MSG_STALE_NUMBERS);
    expect(seen.glup).toEqual(GLUP_RESTOCKED_BROKEN);
    expect(seen.lucky).toEqual(LUCKY_BROKEN);
  });

  it("stock_from_ledger con libro negativo (Glup tal cual): aborta, nunca stock negativo", async () => {
    const seen = await scenario(async (tx, fx) => {
      const error = await apply(tx, [targetRow(fx, fx.glup, STOCK_FROM_LEDGER, GLUP_NUMBERS)]);
      return { error, glup: await stateOf(tx, fx.glup) };
    });

    expect(seen.error).toMatch(MSG_NEGATIVE_LEDGER);
    expect(seen.glup).toEqual(GLUP_BROKEN);
  });

  it("ledger_from_stock cuando la diferencia a asentar no es > 0 (Lucky: stock 2, libro 12): aborta, no asienta un movimiento negativo", async () => {
    const seen = await scenario(async (tx, fx) => {
      const error = await apply(tx, [targetRow(fx, fx.lucky, LEDGER_FROM_STOCK, LUCKY_NUMBERS)]);
      return { error, lucky: await stateOf(tx, fx.lucky) };
    });

    expect(seen.error).toMatch(MSG_NOTHING_TO_POST);
    expect(seen.lucky).toEqual(LUCKY_BROKEN);
  });

  it("acción desconocida: aborta sin tocar ninguno de los listados", async () => {
    const seen = await scenario(async (tx, fx) => {
      const error = await apply(tx, [targetRow(fx, fx.lucky, STOCK_FROM_LEDGER, LUCKY_NUMBERS), targetRow(fx, fx.glup, "borrar_todo", GLUP_NUMBERS)]);
      return { error, glup: await stateOf(tx, fx.glup), lucky: await stateOf(tx, fx.lucky) };
    });

    expect(seen.error).toMatch(MSG_UNKNOWN_ACTION);
    expect(seen.glup).toEqual(GLUP_BROKEN);
    expect(seen.lucky).toEqual(LUCKY_BROKEN);
  });

  it("sku declarado que no coincide con products.sku del id (Z-5): aborta sin tocar ninguno de los listados", async () => {
    const seen = await scenario(async (tx, fx) => {
      const error = await apply(tx, [
        targetRow(fx, fx.lucky, STOCK_FROM_LEDGER, LUCKY_NUMBERS, fx.glup.sku),
        targetRow(fx, fx.glup, LEDGER_FROM_STOCK, GLUP_NUMBERS),
      ]);
      return { error, glup: await stateOf(tx, fx.glup), lucky: await stateOf(tx, fx.lucky) };
    });

    expect(seen.error).toMatch(MSG_SKU_MISMATCH);
    expect(seen.glup).toEqual(GLUP_BROKEN);
    expect(seen.lucky).toEqual(LUCKY_BROKEN);
  });
});
