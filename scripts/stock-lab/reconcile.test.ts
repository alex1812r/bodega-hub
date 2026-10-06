/** @jest-environment node */
/**
 * STK-203: inyeccion de descuadres contra la base LOCAL de stock-lab.
 *
 * Prueba que public.stock_integrity_report(p_store_id) y las vistas del parche
 * 20261005-stock-integrity-views.sql detectan descuadres inyectados. Todo corre
 * dentro de una transaccion que SIEMPRE hace rollback: nada persiste.
 *
 * Sin base (o sin el parche aplicado) los tests se saltan (skipped) con aviso:
 *   npm run stock-lab:db-up
 *   npx jest scripts/stock-lab/reconcile.test.ts
 */
import { randomUUID } from "node:crypto";
import type { Client } from "pg";

import {
  probeStockLabDbSync,
  resolveStockLabDbUrl,
  tryConnect,
  withRollback,
  withSavepoint,
} from "./db-test-utils";

const INTEGRITY_KEYS = [
  "stock_reconciliation",
  "stock_chain_breaks",
  "sales_without_movements",
  "purchases_without_movements",
  "movements_without_document",
  "reversal_mismatches",
  "conversion_mismatches",
  "negative_stock",
  "cross_store_movements",
] as const;

type IntegrityKey = (typeof INTEGRITY_KEYS)[number];
type IntegrityReport = Record<IntegrityKey, number>;

const ZERO_REPORT: IntegrityReport = {
  stock_reconciliation: 0,
  stock_chain_breaks: 0,
  sales_without_movements: 0,
  purchases_without_movements: 0,
  movements_without_document: 0,
  reversal_mismatches: 0,
  conversion_mismatches: 0,
  negative_stock: 0,
  cross_store_movements: 0,
};

interface IdRow {
  id: string;
}
interface CountRow {
  n: string;
}
interface ReportRow {
  report: IntegrityReport;
}
interface ReconciliationRow {
  product_id: string;
  current_stock: number;
  ledger_stock: number;
  diff: number;
}
interface ChainBreakRow {
  movement_id: string;
  expected_stock_after: number;
  stock_after: number;
}
interface SaleWithoutMovementRow {
  sale_id: string;
  product_id: string;
  quantity: number;
  movement_delta: number | null;
  issue: string;
}
interface NegativeStockRow {
  source: string;
  product_id: string;
  movement_id: string | null;
  value: number;
}

interface Fixture {
  storeId: string;
  customerId: string;
  productId: string;
  saleId: string;
}

const DB_URL = resolveStockLabDbUrl();
const probe = probeStockLabDbSync(DB_URL);

if (probe === "no-db") {
  console.warn(
    "STOCK_LAB_DB_URL no responde; se salta reconcile.test.ts (levanta la base con npm run stock-lab:db-up)",
  );
} else if (probe === "no-function") {
  console.warn(
    "public.stock_integrity_report no existe en STOCK_LAB_DB_URL; se salta reconcile.test.ts (aplica supabase/patches/20261005-stock-integrity-views.sql)",
  );
}

const maybe = probe === "ok" ? it : it.skip;

async function report(client: Client, storeId?: string): Promise<IntegrityReport> {
  const result = storeId
    ? await client.query<ReportRow>("select public.stock_integrity_report($1) as report", [storeId])
    : await client.query<ReportRow>("select public.stock_integrity_report() as report");
  return result.rows[0].report;
}

async function countStores(client: Client): Promise<string> {
  const result = await client.query<CountRow>("select count(*)::text as n from public.stores");
  return result.rows[0].n;
}

/** Tienda + cliente + producto (stock 0) + venta pagada (4 uds) + 3 movimientos coherentes; current_stock = 8. */
async function seedCoherentFixture(client: Client): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const store = await client.query<IdRow>(
    "insert into public.stores (name, slug) values ($1, $2) returning id",
    [`Lab test ${suffix}`, `lab-test-${suffix}`],
  );
  const storeId = store.rows[0].id;
  const customer = await client.query<IdRow>(
    "insert into public.contacts (type, name, store_id) values ('cliente', 'Cliente lab', $1) returning id",
    [storeId],
  );
  const customerId = customer.rows[0].id;
  const product = await client.query<IdRow>(
    "insert into public.products (store_id, sku, name, sale_price_ref, current_cost_ref, current_stock) values ($1, $2, 'Producto lab', 1.5, 1, 0) returning id",
    [storeId, `LAB-${suffix}`],
  );
  const productId = product.rows[0].id;
  const sale = await client.query<IdRow>(
    "insert into public.sales (invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, status, store_id) values ($1, $2, 36.5, 6, 6, 219, 'pagada', $3) returning id",
    [`LAB-V-${suffix}`, customerId, storeId],
  );
  const saleId = sale.rows[0].id;
  await client.query(
    "insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, subtotal_ves) values ($1, $2, 4, 1.5, 219)",
    [saleId, productId],
  );
  // now() es constante dentro de la transaccion: created_at explicito para fijar el orden de la cadena.
  await client.query(
    `insert into public.stock_movements (product_id, store_id, type, quantity_delta, stock_after, sale_id, created_at) values
       ($1, $2, 'inventario_inicial', 10, 10, null, now() - interval '3 minutes'),
       ($1, $2, 'venta', -4, 6, $3, now() - interval '2 minutes'),
       ($1, $2, 'ajuste_entrada', 2, 8, null, now() - interval '1 minute')`,
    [productId, storeId, saleId],
  );
  await client.query("update public.products set current_stock = 8 where id = $1", [productId]);
  return { storeId, customerId, productId, saleId };
}

describe("stock_integrity_report + vistas de integridad (base local stock-lab)", () => {
  let client: Client | null = null;
  let globalReportBefore: IntegrityReport | null = null;
  let storesBefore: string | null = null;

  beforeAll(async () => {
    if (probe !== "ok") return;
    client = await tryConnect(DB_URL);
    if (!client) return;
    globalReportBefore = await report(client);
    storesBefore = await countStores(client);
  });

  afterAll(async () => {
    await client?.end();
  });

  maybe("detecta cada descuadre inyectado y cuadra con el fixture coherente", async () => {
    if (!client) throw new Error("sin cliente pg pese al sondeo ok");
    await withRollback(client, async (tx) => {
      const fx = await seedCoherentFixture(tx);

      // 1. Fixture coherente: las 9 claves en 0.
      const clean = await report(tx, fx.storeId);
      expect(Object.keys(clean).sort()).toEqual([...INTEGRITY_KEYS].sort());
      expect(clean).toEqual(ZERO_REPORT);

      // 2. current_stock desalineado del libro.
      await withSavepoint(tx, async () => {
        await tx.query("update public.products set current_stock = current_stock + 3 where id = $1", [fx.productId]);
        const rows = await tx.query<ReconciliationRow>(
          "select product_id, current_stock, ledger_stock, diff from public.stock_reconciliation where store_id = $1",
          [fx.storeId],
        );
        expect(rows.rows).toEqual([{ product_id: fx.productId, current_stock: 11, ledger_stock: 8, diff: 3 }]);
        expect(await report(tx, fx.storeId)).toEqual({ ...ZERO_REPORT, stock_reconciliation: 1 });
      });

      // 3. Movimiento con stock_after incoherente (cadena rota).
      await withSavepoint(tx, async () => {
        const inserted = await tx.query<IdRow>(
          "insert into public.stock_movements (product_id, store_id, type, quantity_delta, stock_after, created_at) values ($1, $2, 'ajuste_entrada', 1, 99, now() + interval '1 minute') returning id",
          [fx.productId, fx.storeId],
        );
        await tx.query("update public.products set current_stock = 9 where id = $1", [fx.productId]);
        const rows = await tx.query<ChainBreakRow>(
          "select movement_id, expected_stock_after, stock_after from public.stock_chain_breaks where store_id = $1",
          [fx.storeId],
        );
        expect(rows.rows).toEqual([{ movement_id: inserted.rows[0].id, expected_stock_after: 9, stock_after: 99 }]);
        expect(await report(tx, fx.storeId)).toEqual({ ...ZERO_REPORT, stock_chain_breaks: 1 });
      });

      // 4. Venta viva con sale_item sin movimiento 'venta'.
      await withSavepoint(tx, async () => {
        const sale = await tx.query<IdRow>(
          "insert into public.sales (invoice_number, customer_id, ref_rate_ves, subtotal_ref, total_ref, total_ves, status, store_id) values ($1, $2, 36.5, 3, 3, 109.5, 'pendiente_pago', $3) returning id",
          [`LAB-V2-${fx.storeId.slice(0, 8)}`, fx.customerId, fx.storeId],
        );
        const saleId = sale.rows[0].id;
        await tx.query(
          "insert into public.sale_items (sale_id, product_id, quantity, unit_price_ref, subtotal_ves) values ($1, $2, 2, 1.5, 109.5)",
          [saleId, fx.productId],
        );
        const rows = await tx.query<SaleWithoutMovementRow>(
          "select sale_id, product_id, quantity, movement_delta, issue from public.sales_without_movements where store_id = $1",
          [fx.storeId],
        );
        expect(rows.rows).toEqual([
          { sale_id: saleId, product_id: fx.productId, quantity: 2, movement_delta: null, issue: "missing" },
        ]);
        expect(await report(tx, fx.storeId)).toEqual({ ...ZERO_REPORT, sales_without_movements: 1 });
      });

      // 5. stock_after negativo en un movimiento (products.current_stock tiene check >= 0).
      await withSavepoint(tx, async () => {
        const inserted = await tx.query<IdRow>(
          "insert into public.stock_movements (product_id, store_id, type, quantity_delta, stock_after, created_at) values ($1, $2, 'ajuste_salida', -9, -1, now() + interval '1 minute') returning id",
          [fx.productId, fx.storeId],
        );
        const rows = await tx.query<NegativeStockRow>(
          "select source, product_id, movement_id, value from public.negative_stock where store_id = $1",
          [fx.storeId],
        );
        expect(rows.rows).toEqual([
          { source: "movement", product_id: fx.productId, movement_id: inserted.rows[0].id, value: -1 },
        ]);
        // El libro queda en -1 frente a current_stock 8: tambien descuadra la conciliacion.
        expect(await report(tx, fx.storeId)).toEqual({ ...ZERO_REPORT, negative_stock: 1, stock_reconciliation: 1 });
      });

      // Tras deshacer cada inyeccion el fixture vuelve a cuadrar.
      expect(await report(tx, fx.storeId)).toEqual(ZERO_REPORT);
    });
  });

  maybe("no persiste nada: el reporte global y el conteo de tiendas son los de antes", async () => {
    if (!client) throw new Error("sin cliente pg pese al sondeo ok");
    expect(await report(client)).toEqual(globalReportBefore);
    expect(await countStores(client)).toBe(storesBefore);
  });
});
