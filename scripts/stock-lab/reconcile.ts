/**
 * Oraculo de inventario (STK-202, plan stock-integrity seccion 4).
 *
 *   npx tsx scripts/stock-lab/reconcile.ts [--run <id>] [--store <uuid>]
 *       [--target local|production] [--read-only] [--limit 20]
 *
 * target local (default): conecta a STOCK_LAB_DB_URL (precedencia process.env >
 *   .env.stock-lab > .env.stock-lab.example; aborta si el host no es
 *   STOCK_TEST_ALLOW_WRITES_HOST), llama a `public.stock_integrity_report($1)` y
 *   lee las primeras N filas de cada vista ya creada por el parche 20261005.
 *
 * target production: exige --read-only. Lee el `.env` de la raiz, resuelve los
 *   hosts como scripts/db-sql.mjs y CONTRA PRODUCCION NUNCA SE CREA NADA: los
 *   SELECT de las vistas van inline (extraidos del parche) en una transaccion
 *   `read only` que termina siempre en `rollback`.
 *
 * Salida: tabla vista | count | estado, filas de las vistas con descuadres y
 * `scripts/stock-lab/runs/<run-id>/reconcile.json`.
 * Exit 0 = todo en 0, 2 = hay descuadres, 1 = error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client, DatabaseError } from "pg";

import { assertAllowedWriteHost, loadStockLabEnv } from "./env";
import {
  INTEGRITY_VIEW_NAMES,
  type IntegrityReport,
  type IntegrityViewName,
  type ReconcileArgs,
  assertProductionReadOnly,
  buildReportFromCounts,
  defaultRunId,
  extractViewQueries,
  formatReportTable,
  parseReconcileArgs,
  parseRootEnv,
  productionCandidates,
  reportFromJson,
  totalIssues,
  wrapWithStoreCount,
  wrapWithStoreFilter,
} from "./integrity-views";

const ROOT = resolve(__dirname, "../..");
const RUNS_DIR = resolve(__dirname, "runs");
const INTEGRITY_PATCH = resolve(ROOT, "supabase/patches/20261005-stock-integrity-views.sql");
const UNDEFINED_FUNCTION = "42883";
const UNDEFINED_TABLE = "42P01";

type Row = Record<string, unknown>;
type RowsByView = Record<IntegrityViewName, Row[]>;

interface ReconcileResult {
  report: IntegrityReport;
  rows: RowsByView;
}

interface ReconcileFile extends ReconcileResult {
  runId: string;
  target: ReconcileArgs["target"];
  storeId: string | null;
  generatedAt: string;
  totalIssues: number;
}

function emptyRows(): RowsByView {
  const out = {} as RowsByView;
  for (const name of INTEGRITY_VIEW_NAMES) out[name] = [];
  return out;
}

function isPgError(error: unknown, code: string): boolean {
  return error instanceof DatabaseError && error.code === code;
}

// ---------------------------------------------------------------- local

function resolveLocalEnv(): { dbUrl: string; allowedHost: string | undefined } {
  const file = loadStockLabEnv(ROOT);
  const get = (key: string) => process.env[key] ?? file[key];
  const dbUrl = get("STOCK_LAB_DB_URL");
  if (!dbUrl) throw new Error("STOCK_LAB_DB_URL no esta definida (process.env o .env.stock-lab)");
  return { dbUrl, allowedHost: get("STOCK_TEST_ALLOW_WRITES_HOST") };
}

async function reconcileLocal(args: ReconcileArgs): Promise<ReconcileResult> {
  const { dbUrl, allowedHost } = resolveLocalEnv();
  const host = assertAllowedWriteHost(dbUrl, allowedHost);
  console.log(`target=local host=${host}`);
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    let report: IntegrityReport;
    try {
      const result = await client.query<{ report: unknown }>(
        "select public.stock_integrity_report($1::uuid) as report",
        [args.storeId],
      );
      report = reportFromJson(result.rows[0]?.report);
    } catch (error) {
      if (isPgError(error, UNDEFINED_FUNCTION)) {
        throw new Error(
          "public.stock_integrity_report no existe en la base local: aplica el patch 20261005 con npm run stock-lab:db-up",
        );
      }
      throw error;
    }
    const rows = emptyRows();
    for (const name of INTEGRITY_VIEW_NAMES) {
      if (report[name] === 0 || args.limit === 0) continue;
      try {
        const result = await client.query<Row>(
          `select * from public.${name} where ($1::uuid is null or store_id = $1) limit ${args.limit}`,
          [args.storeId],
        );
        rows[name] = result.rows;
      } catch (error) {
        if (isPgError(error, UNDEFINED_TABLE)) {
          throw new Error(`La vista public.${name} no existe: aplica el patch 20261005 con npm run stock-lab:db-up`);
        }
        throw error;
      }
    }
    return { report, rows };
  } finally {
    await client.end();
  }
}

// ----------------------------------------------------------- production

async function connectProduction(): Promise<Client> {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) throw new Error(`No existe ${envPath} (necesario para --target production)`);
  const env = parseRootEnv(readFileSync(envPath, "utf8"));
  if (!env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL no esta en .env");
  if (!env.SUPABASE_DB_PASS) throw new Error("SUPABASE_DB_PASS no esta en .env");
  const errors: string[] = [];
  for (const { host, user } of productionCandidates(env.NEXT_PUBLIC_SUPABASE_URL)) {
    const client = new Client({
      connectionTimeoutMillis: 10000,
      database: "postgres",
      host,
      password: env.SUPABASE_DB_PASS,
      port: 5432,
      ssl: { rejectUnauthorized: false },
      user,
    });
    try {
      await client.connect();
      console.log(`target=production host=${host} (read only, rollback al final)`);
      return client;
    } catch (error) {
      errors.push(`${host}: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`);
    }
  }
  throw new Error(`No pude conectar a produccion.\n${errors.join("\n")}`);
}

async function reconcileProduction(args: ReconcileArgs): Promise<ReconcileResult> {
  // Contra produccion nunca se crea nada: los SELECT van inline en una
  // transaccion read only con rollback.
  if (!existsSync(INTEGRITY_PATCH)) throw new Error(`No existe ${INTEGRITY_PATCH}`);
  const queries = extractViewQueries(readFileSync(INTEGRITY_PATCH, "utf8"));
  const client = await connectProduction();
  try {
    await client.query("begin");
    await client.query("set transaction read only");
    const counts: Partial<Record<IntegrityViewName, number>> = {};
    const rows = emptyRows();
    for (const name of INTEGRITY_VIEW_NAMES) {
      const count = await client.query<{ n: number }>(wrapWithStoreCount(queries[name]), [args.storeId]);
      counts[name] = count.rows[0]?.n ?? 0;
      if (counts[name] === 0 || args.limit === 0) continue;
      const sample = await client.query<Row>(
        `${wrapWithStoreFilter(queries[name], args.storeId)} limit ${args.limit}`,
        [args.storeId],
      );
      rows[name] = sample.rows;
    }
    return { report: buildReportFromCounts(counts), rows };
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

// ---------------------------------------------------------------- main

function printRows(result: ReconcileResult): void {
  for (const name of INTEGRITY_VIEW_NAMES) {
    const sample = result.rows[name];
    if (sample.length === 0) continue;
    console.log(`\n${name} (${result.report[name]} filas, mostrando ${sample.length}):`);
    for (const row of sample) console.log(JSON.stringify(row));
  }
}

function writeRunFile(args: ReconcileArgs, runId: string, result: ReconcileResult): string {
  const dir = resolve(RUNS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  const file: ReconcileFile = {
    runId,
    target: args.target,
    storeId: args.storeId,
    generatedAt: new Date().toISOString(),
    report: result.report,
    totalIssues: totalIssues(result.report),
    rows: result.rows,
  };
  const path = resolve(dir, "reconcile.json");
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return path;
}

async function main(): Promise<number> {
  const args = parseReconcileArgs(process.argv.slice(2));
  assertProductionReadOnly(args);
  const runId = args.runId ?? defaultRunId(new Date());
  const result = args.target === "production" ? await reconcileProduction(args) : await reconcileLocal(args);
  console.log(`\nrun=${runId} store=${args.storeId ?? "todas"}\n`);
  console.log(formatReportTable(result.report));
  printRows(result);
  const path = writeRunFile(args, runId, result);
  console.log(`\njson: ${path}`);
  return totalIssues(result.report) === 0 ? 0 : 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
