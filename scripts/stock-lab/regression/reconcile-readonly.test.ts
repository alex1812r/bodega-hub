/** @jest-environment node */
/**
 * STK-604 · modo solo lectura del oráculo contra la base lab.
 *
 * Dentro de UNA transacción que SIEMPRE hace rollback:
 *   1. siembra una tienda propia e inyecta descuadres conocidos (stock ≠ Σ,
 *      cadena rota, venta sin movimiento, stock escrito fuera del libro);
 *   2. compara las comprobaciones inline con las vistas v2 y con
 *      `stock_integrity_report`;
 *   3. simula producción (`drop column seq cascade` + `drop view` de las 9
 *      vistas) y vuelve a correr las comprobaciones con el MISMO cliente: no
 *      revienta, ordena la cadena por created_at,id y sigue viendo lo inyectado.
 *
 *   npm run stock-lab:test -- scripts/stock-lab/regression/reconcile-readonly.test.ts
 *
 * Un fallo de preparación lanza un error que empieza por "SETUP".
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";

import { resolveStockLabDbUrl, tryConnect, withRollback } from "../db-test-utils";
import { INTEGRITY_VIEW_NAMES, type IntegrityViewName } from "../integrity-views";
import {
  CHAIN_ORDER_WARNING,
  NO_CHAIN_BREAK_LABEL,
  type QueryClient,
  type ReadOnlyReport,
  assertReadOnlyStatement,
  collectReadOnlyReport,
  createReadOnlyQuery,
  detectCapabilities,
  planChecks,
} from "../reconcile-readonly";

interface IdRow {
  id: string;
}

interface Fixture {
  storeId: string;
  /** stock 12, libro 9 (diff 3) y cadena rota en `forgedMovementId`. */
  brokenProductId: string;
  forgedMovementId: string;
  /** stock 7, libro 5 (diff 2), cadena sana. */
  offLedgerProductId: string;
  /** Venta viva con una línea sin movimiento. */
  orphanSaleId: string;
}

const EXPECTED_COUNTS: Record<IntegrityViewName, number> = {
  stock_reconciliation: 2,
  stock_chain_breaks: 1,
  sales_without_movements: 1,
  purchases_without_movements: 0,
  movements_without_document: 0,
  reversal_mismatches: 0,
  conversion_mismatches: 0,
  negative_stock: 0,
  cross_store_movements: 0,
};

let client: Client;

async function setup<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(`SETUP · ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function insertId(tx: Client, what: string, sql: string, params: unknown[]): Promise<string> {
  const result = await setup(what, () => tx.query<IdRow>(sql, params));
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`SETUP · ${what}: el insert no devolvió id`);
  return id;
}

/** Producto con stock 0: el stock entra solo por movimientos (el trigger del libro fija el saldo). */
function insertProduct(tx: Client, storeId: string, sku: string): Promise<string> {
  return insertId(
    tx,
    `producto ${sku}`,
    "insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock) values ($1, $2, $3, 1.5, 1, 0) returning id",
    [storeId, sku, `Producto ${sku}`],
  );
}

function insertMovement(
  tx: Client,
  productId: string,
  storeId: string,
  type: string,
  delta: number,
  saleId: string | null,
  minutes: number,
): Promise<string> {
  // now() es constante dentro de la transacción: created_at explícito para que el
  // orden por created_at,id (sin seq) sea el mismo que el del libro.
  return insertId(
    tx,
    `movimiento ${type} ${delta}`,
    `insert into public.stock_movements (product_id, store_id, type, quantity_delta, sale_id, created_at)
     values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6)) returning id`,
    [productId, storeId, type, delta, saleId, minutes],
  );
}

function insertSale(tx: Client, storeId: string, customerId: string, invoice: string, status: string): Promise<string> {
  return insertId(
    tx,
    `venta ${invoice}`,
    "insert into public.sales (invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, status, store_id) values ($1, $2, 36.5, 6, 6, 219, $3, $4) returning id",
    [invoice, customerId, status, storeId],
  );
}

async function seedInjectedFixture(tx: Client): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const storeId = await insertId(tx, "tienda", "insert into public.stores (name, slug) values ($1, $2) returning id", [
    `R604 ${suffix}`,
    `r604-${suffix}`,
  ]);
  const customerId = await insertId(
    tx,
    "cliente",
    "insert into public.contacts (type, name, store_id) values ('cliente', 'Cliente R604', $1) returning id",
    [storeId],
  );

  // Producto A: 10 - 4 (venta) + 2 = 8, coherente.
  const brokenProductId = await insertProduct(tx, storeId, `R604-A-${suffix}`);
  const saleId = await insertSale(tx, storeId, customerId, `R604-V1-${suffix}`, "pagada");
  await setup("línea de la venta 1", () =>
    tx.query(
      "insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, subtotal_ves) values ($1, $2, 4, 1.5, 219)",
      [saleId, brokenProductId],
    ),
  );
  await insertMovement(tx, brokenProductId, storeId, "inventario_inicial", 10, null, -3);
  await insertMovement(tx, brokenProductId, storeId, "venta", -4, saleId, -2);
  await insertMovement(tx, brokenProductId, storeId, "ajuste_entrada", 2, null, -1);

  // Inyección 1 · cadena rota: el último movimiento (+1 → 9) pasa a decir 99.
  const forgedMovementId = await insertMovement(tx, brokenProductId, storeId, "ajuste_entrada", 1, null, 1);
  await setup("forzar stock_after", () =>
    tx.query("update public.stock_movements set stock_after = 99 where id = $1", [forgedMovementId]),
  );
  // Inyección 2 · stock ≠ Σ: 9 en el libro, 12 en el producto.
  await setup("descuadrar current_stock", () =>
    tx.query("update public.products set current_stock = current_stock + 3 where id = $1", [brokenProductId]),
  );

  // Inyección 3 · venta viva con una línea sin movimiento.
  const orphanSaleId = await insertSale(tx, storeId, customerId, `R604-V2-${suffix}`, "pendiente_pago");
  await setup("línea de la venta huérfana", () =>
    tx.query(
      "insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, subtotal_ves) values ($1, $2, 2, 1.5, 109.5)",
      [orphanSaleId, brokenProductId],
    ),
  );

  // Inyección 4 · stock escrito fuera del libro, con la cadena sana: 5 en el libro, 7 en el producto.
  const offLedgerProductId = await insertProduct(tx, storeId, `R604-B-${suffix}`);
  await insertMovement(tx, offLedgerProductId, storeId, "inventario_inicial", 5, null, -3);
  await setup("escribir stock fuera del libro", () =>
    tx.query("update public.products set current_stock = 7 where id = $1", [offLedgerProductId]),
  );

  return { storeId, brokenProductId, forgedMovementId, offLedgerProductId, orphanSaleId };
}

/** Corre el núcleo de solo lectura sobre el cliente de la transacción y devuelve también lo que emitió. */
async function runInline(tx: Client, storeId: string): Promise<{ report: ReadOnlyReport; statements: string[] }> {
  const statements: string[] = [];
  const recording: QueryClient = {
    query: (text, values) => {
      statements.push(text);
      return values ? tx.query(text, values) : tx.query(text);
    },
  };
  const report = await collectReadOnlyReport(createReadOnlyQuery(recording), { storeId, limit: 20 });
  return { report, statements };
}

function countsOf(report: ReadOnlyReport): Record<string, number | null> {
  return Object.fromEntries(INTEGRITY_VIEW_NAMES.map((name) => [name, report.checks[name].count]));
}

function expectInjectedMismatches(report: ReadOnlyReport, fx: Fixture): void {
  expect(countsOf(report)).toEqual(EXPECTED_COUNTS);
  for (const name of INTEGRITY_VIEW_NAMES) expect(report.checks[name].evaluable).toBe(true);

  expect(report.total.absDiffSum).toBe(5);
  expect(report.total.worst.map((p) => [p.productId, p.currentStock, p.ledgerStock, p.diff])).toEqual([
    [fx.brokenProductId, 12, 9, 3],
    [fx.offLedgerProductId, 7, 5, 2],
  ]);
  expect(report.stores).toHaveLength(1);
  expect(report.stores[0].storeId).toBe(fx.storeId);
  expect(report.stores[0].counts).toEqual(EXPECTED_COUNTS);

  expect(report.rows.stock_chain_breaks).toHaveLength(1);
  expect(report.rows.stock_chain_breaks[0]).toMatchObject({
    movement_id: fx.forgedMovementId,
    expected_stock_after: 9,
    stock_after: 99,
  });
  expect(report.rows.sales_without_movements).toHaveLength(1);
  expect(report.rows.sales_without_movements[0]).toMatchObject({
    sale_id: fx.orphanSaleId,
    product_id: fx.brokenProductId,
    quantity: 2,
    movement_delta: null,
    issue: "missing",
  });

  const [broken, offLedger] = report.diffProducts;
  expect(broken.firstMismatch).toMatchObject({
    kind: "chain_break",
    movementId: fx.forgedMovementId,
    expectedStockAfter: 9,
    stockAfter: 99,
    order: report.chainOrder,
  });
  expect(offLedger.firstMismatch).toMatchObject({ kind: "no_chain_break", note: NO_CHAIN_BREAK_LABEL });
  if (offLedger.firstMismatch.kind === "no_chain_break") {
    expect(offLedger.firstMismatch.productCreatedAt).not.toBeNull();
    expect(offLedger.firstMismatch.lastMovementAt).not.toBeNull();
  }
}

async function seqColumnExists(db: Client): Promise<boolean> {
  const result = await db.query(
    "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'seq'",
  );
  return result.rows.length === 1;
}

async function integrityViewsPresent(db: Client): Promise<string[]> {
  const result = await db.query<{ table_name: string }>(
    "select table_name from information_schema.views where table_schema = 'public' and table_name = any($1::text[]) order by table_name",
    [[...INTEGRITY_VIEW_NAMES]],
  );
  return result.rows.map((row) => row.table_name);
}

describe("STK-604 · reconcile en modo solo lectura (base lab)", () => {
  beforeAll(async () => {
    const connected = await tryConnect(resolveStockLabDbUrl(), 5000);
    if (!connected) throw new Error("SETUP · la base lab no responde (npm run stock-lab:db-up)");
    client = connected;
    if (!(await seqColumnExists(client))) {
      throw new Error("SETUP · stock_movements.seq no existe: aplica los parches 20261006 (npm run stock-lab:db-up)");
    }
  });

  afterAll(async () => {
    await client?.end();
  });

  it("inline = vistas v2; y sin seq ni vistas (como producción) sigue detectando lo inyectado", async () => {
    const viewsBefore = await integrityViewsPresent(client);
    expect(viewsBefore).toEqual([...INTEGRITY_VIEW_NAMES].sort());

    await withRollback(client, async (tx) => {
      const fx = await seedInjectedFixture(tx);

      // 1. Con el esquema completo: mismas filas que las vistas v2.
      const full = await runInline(tx, fx.storeId);
      expect(full.report.chainOrder).toBe("seq");
      expect(full.report.warnings).toEqual([]);
      expect(full.report.integrityViewsPresent).toEqual([...INTEGRITY_VIEW_NAMES]);
      expectInjectedMismatches(full.report, fx);

      const oracle = await tx.query<{ report: Record<string, number> }>(
        "select public.stock_integrity_report($1::uuid) as report",
        [fx.storeId],
      );
      expect(countsOf(full.report)).toEqual(oracle.rows[0].report);
      const plans = planChecks(await detectCapabilities(createReadOnlyQuery(tx)));
      const rowsOf = async (source: string): Promise<string[]> => {
        const result = await tx.query<{ row: string }>(
          `select to_jsonb(v)::text as row from ${source} v where v.store_id = $1`,
          [fx.storeId],
        );
        return result.rows.map((r) => r.row).sort();
      };
      for (const name of INTEGRITY_VIEW_NAMES) {
        const sql = plans[name].sql;
        if (sql === null) throw new Error(`${name} no es evaluable con el esquema completo: falta ${plans[name].missing.join(", ")}`);
        expect({ name, rows: await rowsOf(`(${sql})`) }).toEqual({ name, rows: await rowsOf(`public.${name}`) });
      }

      // 2. Simular producción: sin seq (cascade se lleva la vista v2 de la cadena) y sin vistas.
      await tx.query("alter table public.stock_movements drop column seq cascade");
      for (const name of INTEGRITY_VIEW_NAMES) await tx.query(`drop view if exists public.${name} cascade`);
      expect(await seqColumnExists(tx)).toBe(false);
      expect(await integrityViewsPresent(tx)).toEqual([]);

      const degraded = await runInline(tx, fx.storeId);
      expect(degraded.report.chainOrder).toBe("created_at,id");
      expect(degraded.report.warnings).toEqual([`stock_chain_breaks: falta stock_movements.seq: ${CHAIN_ORDER_WARNING}`]);
      expect(degraded.report.integrityViewsPresent).toEqual([]);
      expect(degraded.statements.some((sql) => sql.includes("order by m.created_at, m.id"))).toBe(true);
      expect(degraded.statements.filter((sql) => /\bseq\b/.test(sql))).toEqual([]);
      expectInjectedMismatches(degraded.report, fx);

      // Ninguna sentencia del modo solo lectura es otra cosa que un SELECT.
      for (const sql of [...full.statements, ...degraded.statements]) expect(assertReadOnlyStatement(sql)).toBe("select");
    });

    // Rollback: ni el drop ni los datos persisten.
    expect(await seqColumnExists(client)).toBe(true);
    expect(await integrityViewsPresent(client)).toEqual(viewsBefore);
  });
});
