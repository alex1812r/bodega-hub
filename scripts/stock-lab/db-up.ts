/**
 * Base de prueba Supabase LOCAL para stock-lab (STK-101).
 *
 *   npx tsx scripts/stock-lab/db-up.ts [up|down|reset]
 *
 *   up    : `npx supabase init` (si falta supabase/config.toml) + `npx supabase start`
 *           + schema + parches estructurales + seed + superadmin + verify-patches.
 *   down  : `npx supabase stop` (conserva el volumen; `up` lo reaplica idempotente).
 *   reset : start + `npx supabase db reset --local --no-seed` (base vacia sin
 *           reiniciar contenedores, mas rapido que stop/start) + el pipeline de `up`.
 *
 * Usa el binario `supabase` de node_modules (devDependency) via `npx supabase`.
 * Conecta SOLO a STOCK_LAB_DB_URL (nunca al .env de produccion) y aborta si el
 * host no coincide con STOCK_TEST_ALLOW_WRITES_HOST (regla 1.4 del plan).
 * Precedencia: process.env > .env.stock-lab > .env.stock-lab.example.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client, DatabaseError } from "pg";

import { assertAllowedWriteHost, loadStockLabEnv } from "./env";
import {
  APPLY_ALL_PATCH,
  SCHEMA_FILE,
  SEED_FILE,
  SEED_SUPERADMIN_PATCH,
  VERIFY_PATCH,
  applyStockLabConfig,
  failedChecks,
  selectStructuralPatches,
  type VerifyRow,
} from "./pipeline";

const ROOT = resolve(__dirname, "../..");
const SUPABASE_DIR = resolve(ROOT, "supabase");
const PATCHES_DIR = resolve(SUPABASE_DIR, "patches");
const CONFIG_FILE = resolve(SUPABASE_DIR, "config.toml");

function supabase(...args: string[]): void {
  const result = spawnSync("npx", ["supabase", ...args], { cwd: ROOT, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new Error(`npx supabase ${args.join(" ")} termino con codigo ${result.status}`);
}

function resolveEnv(): { dbUrl: string; allowedHost: string | undefined } {
  const file = loadStockLabEnv(ROOT);
  const get = (key: string) => process.env[key] ?? file[key];
  const dbUrl = get("STOCK_LAB_DB_URL");
  if (!dbUrl) throw new Error("STOCK_LAB_DB_URL no esta definida (process.env o .env.stock-lab)");
  return { dbUrl, allowedHost: get("STOCK_TEST_ALLOW_WRITES_HOST") };
}

function ensureConfig(): void {
  if (!existsSync(CONFIG_FILE)) {
    supabase("init", "--yes");
    console.log("init: supabase/config.toml creado");
  }
  const current = readFileSync(CONFIG_FILE, "utf8");
  const next = applyStockLabConfig(current);
  if (next !== current) {
    writeFileSync(CONFIG_FILE, next);
    console.log("config: project_id + db.seed/studio/analytics/edge_runtime ajustados");
  }
}

async function applyFile(client: Client, label: string, file: string): Promise<void> {
  const started = Date.now();
  const sql = readFileSync(file, "utf8");
  try {
    await client.query(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = error instanceof DatabaseError && error.position ? Number(error.position) : null;
    const line = position ? ` (linea ${sql.slice(0, position).split("\n").length})` : "";
    throw new Error(`${label}${line}: ${message}`);
  }
  console.log(`${label} ${Date.now() - started}ms`);
}

async function summarize(client: Client): Promise<void> {
  const stores = await client.query<{ n: string }>("select count(*)::text as n from public.stores");
  const products = await client.query<{ n: string }>("select count(*)::text as n from public.products");
  const rpc = await client.query<{ ok: boolean }>(
    "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_sale_with_payments') as ok",
  );
  console.log(
    `stores=${stores.rows[0].n} products=${products.rows[0].n} create_sale_with_payments=${rpc.rows[0].ok ? "yes" : "no"}`,
  );
}

async function applyPipeline(dbUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    // El schema base describe un proyecto nuevo (vistas sin store_id); sobre una
    // base ya parcheada no es re-aplicable, asi que solo entra si no hay tablas.
    const base = await client.query<{ fresh: boolean }>("select to_regclass('public.profiles') is null as fresh");
    if (base.rows[0].fresh) await applyFile(client, SCHEMA_FILE, resolve(SUPABASE_DIR, SCHEMA_FILE));
    else console.log(`${SCHEMA_FILE} omitido (base ya inicializada; usa reset para partir de cero)`);
    const patches = selectStructuralPatches(readdirSync(PATCHES_DIR));
    for (const patch of patches) await applyFile(client, patch, resolve(PATCHES_DIR, patch));
    await applyFile(client, SEED_FILE, resolve(SUPABASE_DIR, SEED_FILE));
    await applyFile(client, SEED_SUPERADMIN_PATCH, resolve(PATCHES_DIR, SEED_SUPERADMIN_PATCH));
    const verify = await client.query<VerifyRow>(readFileSync(resolve(PATCHES_DIR, VERIFY_PATCH), "utf8"));
    const failed = failedChecks(verify.rows);
    console.log(`${VERIFY_PATCH} ok=${verify.rows.length - failed.length} fail=${failed.length}`);
    for (const name of failed) console.log(`  FAIL ${name}`);
    await summarize(client);
    return failed;
  } finally {
    await client.end();
  }
}

async function up(options: { reset: boolean }): Promise<void> {
  const started = Date.now();
  const { dbUrl, allowedHost } = resolveEnv();
  const host = assertAllowedWriteHost(dbUrl, allowedHost);
  console.log(`target host=${host} (${APPLY_ALL_PATCH} no se usa: los parches se aplican uno a uno)`);
  ensureConfig();
  supabase("start");
  if (options.reset) supabase("db", "reset", "--local", "--no-seed");
  const failed = await applyPipeline(dbUrl);
  console.log(`total ${Date.now() - started}ms`);
  if (failed.length > 0) {
    console.error(`verify-patches con ${failed.length} check(s) en false: ${failed.join(", ")}`);
    process.exit(1);
  }
}

function down(): void {
  supabase("stop");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";
  if (command === "up") return up({ reset: false });
  if (command === "down") return down();
  if (command === "reset") return up({ reset: true });
  throw new Error(`Subcomando desconocido '${command}' (usa up|down|reset)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
