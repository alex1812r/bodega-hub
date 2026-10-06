/**
 * Helpers para tests jest contra la base LOCAL de stock-lab (STK-203).
 *
 * Solo resuelven STOCK_LAB_DB_URL (process.env > .env.stock-lab >
 * .env.stock-lab.example); nunca el .env de la raiz, que es produccion.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";

import { loadStockLabEnv } from "./env";

const ROOT = resolve(__dirname, "../..");

export const STOCK_LAB_DB_URL_KEY = "STOCK_LAB_DB_URL";

/** Misma precedencia que db-up.ts: process.env > .env.stock-lab > .env.stock-lab.example. */
export function resolveStockLabDbUrl(): string {
  const fromEnv = process.env[STOCK_LAB_DB_URL_KEY];
  if (fromEnv) return fromEnv;
  const file = loadStockLabEnv(ROOT);
  const dbUrl = file[STOCK_LAB_DB_URL_KEY];
  if (!dbUrl) throw new Error(`${STOCK_LAB_DB_URL_KEY} no esta definida (process.env o .env.stock-lab)`);
  return dbUrl;
}

/** Devuelve un Client conectado, o null si la base no responde dentro de timeoutMs (no lanza). */
export async function tryConnect(dbUrl: string, timeoutMs = 2000): Promise<Client | null> {
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    return client;
  } catch {
    await client.end().catch(() => undefined);
    return null;
  }
}

export type StockLabProbe = "ok" | "no-db" | "no-function";

const PROBE_SCRIPT = [
  'const { Client } = require("pg");',
  "const c = new Client({ connectionString: process.env.STOCK_LAB_PROBE_URL, connectionTimeoutMillis: Number(process.env.STOCK_LAB_PROBE_TIMEOUT) });",
  "c.connect()",
  "  .then(() => c.query(\"select to_regprocedure('public.stock_integrity_report(uuid)') is not null as ok\"))",
  '  .then((r) => { process.stdout.write(r.rows[0].ok ? "ok" : "no-function"); return c.end(); })',
  '  .catch(() => process.stdout.write("no-db"))',
  "  .then(() => process.exit(0));",
].join("\n");

/**
 * Sondeo SINCRONO (proceso hijo) para decidir `it` vs `it.skip` al registrar los
 * tests: jest no permite saltar un test en tiempo de ejecucion y las describe no
 * pueden ser async. Devuelve "no-db" si no conecta y "no-function" si falta
 * public.stock_integrity_report (parche 20261005 sin aplicar).
 */
export function probeStockLabDbSync(dbUrl: string, timeoutMs = 2000): StockLabProbe {
  const result = spawnSync(process.execPath, ["-e", PROBE_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs + 3000,
    env: { ...process.env, STOCK_LAB_PROBE_URL: dbUrl, STOCK_LAB_PROBE_TIMEOUT: String(timeoutMs) },
  });
  const out = result.stdout?.trim();
  if (out === "ok" || out === "no-function") return out;
  return "no-db";
}

/** begin -> fn -> rollback SIEMPRE (tambien si fn lanza). Nada persiste. */
export async function withRollback<T>(client: Client, fn: (client: Client) => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

/** savepoint -> fn -> rollback to savepoint SIEMPRE. Para aislar inyecciones dentro de withRollback. */
export async function withSavepoint<T>(client: Client, fn: (client: Client) => Promise<T>): Promise<T> {
  await client.query("savepoint stock_lab_injection");
  try {
    return await fn(client);
  } finally {
    await client.query("rollback to savepoint stock_lab_injection");
  }
}
