/**
 * Tasa fija para `npm run stock-lab:test` (REP-06, QA X1).
 *
 * Varios tests de `regression/` (payments-idempotency, payments-purchase-rls,
 * report-inventory-views, report-money-views) asumen la tasa del seed
 * (`LAB_EXCHANGE_RATE_VES`). Entrar al lab con el BFF en marcha inserta la
 * oficial de DolarAPI (p. ej. 880,1159) y esos tests fallan por redondeo o por
 * la tolerancia de tasa de `create_sale`. El globalSetup deja como vigente la
 * tasa del seed (fila marcada, `created_at` más reciente) solo si la vigente es
 * otra; el globalTeardown borra esa fila y la tienda vuelve a su tasa previa.
 * Sin base lab no hace nada: los tests se saltan solos (`probeStockLabDbSync`).
 */
import type { Client } from "pg";

import { resolveStockLabDbUrl, tryConnect } from "./db-test-utils";
import { LAB_EXCHANGE_RATE_VES, LAB_STORE_SLUG } from "./seed-lab";

export const STOCK_LAB_TEST_RATE_NOTE = "stock-lab:test tasa del seed (REP-06)";

const RATE_EPSILON = 0.0001;

async function withLabDb(fn: (db: Client, storeId: string) => Promise<void>): Promise<void> {
  const db = await tryConnect(resolveStockLabDbUrl());
  if (!db) return;
  try {
    const store = await db.query<{ id: string }>("select id from public.stores where slug = $1 limit 1", [LAB_STORE_SLUG]);
    const storeId = store.rows[0]?.id;
    if (storeId) await fn(db, storeId);
  } finally {
    await db.end();
  }
}

/** Deja vigente la tasa del seed en la tienda lab si la última fila es otra. */
export async function pinSeedExchangeRate(): Promise<void> {
  await withLabDb(async (db, storeId) => {
    const last = await db.query<{ rate_ves: number }>(
      "select rate_ves::float8 as rate_ves from public.exchange_rates where store_id = $1 order by created_at desc limit 1",
      [storeId],
    );
    const current = last.rows[0]?.rate_ves;
    if (current !== undefined && Math.abs(current - LAB_EXCHANGE_RATE_VES) < RATE_EPSILON) return;
    await db.query(
      "insert into public.exchange_rates (store_id, rate_ves, source, notes, created_by) values ($1, $2, 'Manual', $3, null)",
      [storeId, LAB_EXCHANGE_RATE_VES, STOCK_LAB_TEST_RATE_NOTE],
    );
  });
}

/** Borra la fila de `pinSeedExchangeRate` (también las de una corrida interrumpida). */
export async function unpinSeedExchangeRate(): Promise<void> {
  await withLabDb(async (db, storeId) => {
    await db.query("delete from public.exchange_rates where store_id = $1 and notes = $2", [storeId, STOCK_LAB_TEST_RATE_NOTE]);
  });
}
