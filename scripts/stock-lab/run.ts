/**
 * Orquestador de corridas del laboratorio de stock (STK-305).
 *
 *   npm run stock-lab:run -- --agents 5 --minutes 10 --seed 42 [--run <id>]
 *   npm run stock-lab:run -- --serial --ops 200 --seed 42
 *
 * Paralelo: lanza N procesos `npx tsx scripts/stock-lab/agents/<x>.ts` (reparto
 * cíclico vendedor-1, vendedor-2, comprador, almacen, caos) con `--seed seed+i`.
 * Serial: un solo proceso `agents/mixto.ts`. Después ejecuta `reconcile.ts`
 * (si existe) por subproceso, lee productos y `stock_movements` de la tienda
 * `lab` con `pg` (STOCK_LAB_DB_URL, guarda de host) y escribe
 * `runs/<id>/summary.md` con `buildSummary`.
 *
 * Exit 0 si todos los agentes salieron 0 (aunque haya descuadres: en esta fase
 * solo se registran); exit 1 si algún agente salió ≠ 0 o reconcile reventó.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

import { EVENTS_FILE_NAME, readEvents } from "./agents/logger";
import { assertAllowedWriteHost, loadStockLabEnv } from "./env";
import {
  buildSummary,
  shortSummary,
  type SummaryAgent,
  type SummaryMovement,
  type SummaryProduct,
  type SummaryReconcile,
} from "./summary";

const ROOT = resolve(__dirname, "../..");
const RUNS_DIR = resolve(__dirname, "runs");
const AGENTS_DIR = "scripts/stock-lab/agents";
const RECONCILE_SCRIPT = "scripts/stock-lab/reconcile.ts";
const LAB_STORE_SLUG = "lab";

export const RUN_ARGS_USAGE =
  "--agents <n> (--minutes <m> | --ops <n>) --seed <n> [--run <id>] [--serial]";

export const PARALLEL_ROSTER = ["vendedor-1", "vendedor-2", "comprador", "almacen", "caos"] as const;

export type RunArgs = {
  agents: number;
  minutes?: number;
  ops?: number;
  seed: number;
  run: string;
  serial: boolean;
};

export type AgentPlan = { name: string; file: string; seed: number };

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseNumber(flag: string, raw: string | undefined, integer: boolean): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`--${flag} debe ser un ${integer ? "entero" : "número"} > 0 (recibido "${raw}"). Uso: ${RUN_ARGS_USAGE}`);
  }
  return value;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYYMMDD-HHmmss-seed<seed>` en hora local. */
export function defaultRunId(seed: number, now: Date = new Date()): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${date}-${time}-seed${seed}`;
}

export function parseRunArgs(argv: string[], now: Date = new Date()): RunArgs {
  const flags = new Map<string, string>();
  let serial = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`Argumento inesperado "${token}". Uso: ${RUN_ARGS_USAGE}`);
    }
    let name = token.slice(2);
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (name === "serial") {
      serial = true;
      continue;
    }
    if (!["agents", "minutes", "ops", "seed", "run"].includes(name)) {
      throw new Error(`Flag desconocida --${name}. Uso: ${RUN_ARGS_USAGE}`);
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      }
    }
    if (value === undefined || value.trim() === "") {
      throw new Error(`--${name} requiere un valor. Uso: ${RUN_ARGS_USAGE}`);
    }
    flags.set(name, value.trim());
  }

  const seedRaw = flags.get("seed");
  const seed = seedRaw === undefined ? Number.NaN : Number(seedRaw);
  if (!Number.isInteger(seed)) {
    throw new Error(`--seed <n> es obligatoria y entera. Uso: ${RUN_ARGS_USAGE}`);
  }
  const minutes = parseNumber("minutes", flags.get("minutes"), false);
  const ops = parseNumber("ops", flags.get("ops"), true);
  if (minutes === undefined && ops === undefined) {
    throw new Error(`Indica --minutes <m> o --ops <n>. Uso: ${RUN_ARGS_USAGE}`);
  }
  const agents = serial ? 1 : (parseNumber("agents", flags.get("agents"), true) ?? PARALLEL_ROSTER.length);
  const runId = flags.get("run") ?? defaultRunId(seed, now);
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error(`--run solo admite letras, números, punto, guion y guion bajo (recibido "${runId}").`);
  }
  const args: RunArgs = { agents, seed, run: runId, serial };
  if (minutes !== undefined) args.minutes = minutes;
  if (ops !== undefined) args.ops = ops;
  return args;
}

// ---------------------------------------------------------------------------
// Reparto
// ---------------------------------------------------------------------------

/** `vendedor-1` → `vendedor`, `vendedor-2-b` → `vendedor`, `caos` → `caos`. */
export function agentFileFor(name: string): string {
  return name.split("-")[0] ?? name;
}

function cycleSuffix(cycle: number): string {
  // 1 → b, 2 → c, ... 25 → z, 26 → ba ...
  let n = cycle;
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Reparto cíclico sobre PARALLEL_ROSTER; a partir de la segunda vuelta añade `-b`, `-c`, … */
export function assignAgents(count: number, seed: number): AgentPlan[] {
  const out: AgentPlan[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = PARALLEL_ROSTER[i % PARALLEL_ROSTER.length] ?? "vendedor-1";
    const cycle = Math.floor(i / PARALLEL_ROSTER.length);
    const name = cycle === 0 ? base : `${base}-${cycleSuffix(cycle)}`;
    out.push({ name, file: `${AGENTS_DIR}/${agentFileFor(name)}.ts`, seed: seed + i });
  }
  return out;
}

export function agentArgv(plan: AgentPlan, args: RunArgs): string[] {
  const argv = ["tsx", plan.file, "--run", args.run, "--seed", String(plan.seed)];
  if (args.minutes !== undefined) argv.push("--minutes", String(args.minutes));
  if (args.ops !== undefined) argv.push("--ops", String(args.ops));
  argv.push("--agent", plan.name);
  return argv;
}

// ---------------------------------------------------------------------------
// Subprocesos
// ---------------------------------------------------------------------------

type SpawnResult = { exitCode: number | null; error?: string };

function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...loadStockLabEnv(ROOT) };
}

/** Lanza `npx <argv>` con cwd en la raíz del repo y vuelca stdout+stderr a `logFile`. */
function spawnNpx(argv: string[], logFile: string): Promise<SpawnResult> {
  const out = createWriteStream(logFile, { flags: "a" });
  return new Promise((resolveSpawn) => {
    let settled = false;
    const finish = (result: SpawnResult) => {
      if (settled) return;
      settled = true;
      out.end();
      resolveSpawn(result);
    };
    const child = spawn("npx", argv, {
      cwd: ROOT,
      env: childEnv(),
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", (error) => finish({ exitCode: null, error: error.message }));
    child.on("exit", (code, signal) => finish({ exitCode: code, error: signal ? `señal ${signal}` : undefined }));
  });
}

async function runAgents(args: RunArgs, runDir: string): Promise<SummaryAgent[]> {
  const agentsDir = resolve(runDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const plans: AgentPlan[] = args.serial
    ? [{ name: "mixto", file: `${AGENTS_DIR}/mixto.ts`, seed: args.seed }]
    : assignAgents(args.agents, args.seed);

  console.log(`[run] ${args.run}: ${plans.map((p) => p.name).join(", ")}`);
  const results = await Promise.all(
    plans.map(async (plan) => {
      const result = await spawnNpx(agentArgv(plan, args), resolve(agentsDir, `${plan.name}.log`));
      console.log(`[run] ${plan.name} terminó con código ${result.exitCode ?? "null"}${result.error ? ` (${result.error})` : ""}`);
      return { name: plan.name, exitCode: result.exitCode };
    }),
  );
  return results;
}

async function runReconcile(runId: string, runDir: string): Promise<SummaryReconcile> {
  if (!existsSync(resolve(ROOT, RECONCILE_SCRIPT))) {
    return { status: "missing" };
  }
  const result = await spawnNpx(["tsx", RECONCILE_SCRIPT, "--run", runId], resolve(runDir, "reconcile.log"));
  const jsonFile = resolve(runDir, "reconcile.json");
  let raw: unknown;
  if (existsSync(jsonFile)) {
    try {
      raw = JSON.parse(readFileSync(jsonFile, "utf8")) as unknown;
    } catch (error) {
      raw = { parseError: error instanceof Error ? error.message : String(error) };
    }
  }
  // reconcile sale 0 = sin descuadres, 2 = con descuadres (ambos "ok": corrió); 1/null = reventó.
  const failed = result.exitCode === null || (result.exitCode !== 0 && result.exitCode !== 2);
  const reconcile: SummaryReconcile = { status: failed ? "failed" : "ok" };
  if (raw !== undefined) reconcile.raw = raw;
  if (failed) reconcile.error = result.error ?? `exit code ${result.exitCode ?? "null"} (ver reconcile.log)`;
  return reconcile;
}

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

type ProductRow = { id: string; sku: string; name: string; current_stock: number; is_active: boolean };
type MovementRow = {
  id: string;
  product_id: string;
  type: string;
  quantity_delta: number;
  stock_after: number;
  sale_id: string | null;
  purchase_id: string | null;
  conversion_id: string | null;
  created_at: Date | string;
  /** bigint: pg lo entrega como texto. */
  seq: string | number | null;
};

/** Movimientos de la tienda lab en el orden real de la cadena (`seq`, C16). */
export const LAB_MOVEMENTS_SQL = `select id, product_id, type::text as type, quantity_delta, stock_after, sale_id, purchase_id, conversion_id, created_at, seq
         from public.stock_movements
        where store_id = $1
        order by seq, id`;

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function readLabData(): Promise<{ products: SummaryProduct[]; movements: SummaryMovement[]; notes: string[] }> {
  const env = loadStockLabEnv(ROOT);
  const dbUrl = process.env.STOCK_LAB_DB_URL ?? env.STOCK_LAB_DB_URL;
  if (!dbUrl) throw new Error("STOCK_LAB_DB_URL no está definida (process.env o .env.stock-lab)");
  // El host permitido sale solo del archivo lab, nunca del entorno heredado (C21).
  assertAllowedWriteHost(dbUrl, env.STOCK_TEST_ALLOW_WRITES_HOST);

  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const store = await client.query<{ id: string }>("select id from public.stores where slug = $1 limit 1", [
      LAB_STORE_SLUG,
    ]);
    const storeId = store.rows[0]?.id;
    if (!storeId) {
      return { products: [], movements: [], notes: [`La tienda '${LAB_STORE_SLUG}' no existe en la base: sin productos ni movimientos.`] };
    }
    const products = await client.query<ProductRow>(
      "select id, sku, name, current_stock, is_active from public.products where store_id = $1 order by sku",
      [storeId],
    );
    const movements = await client.query<MovementRow>(LAB_MOVEMENTS_SQL, [storeId]);
    return {
      products: products.rows.map((row) => ({ ...row, current_stock: Number(row.current_stock) })),
      movements: movements.rows.map((row) => ({
        ...row,
        quantity_delta: Number(row.quantity_delta),
        stock_after: Number(row.stock_after),
        created_at: isoString(row.created_at),
        seq: row.seq === null || row.seq === undefined ? null : Number(row.seq),
      })),
      notes: [],
    };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseRunArgs(process.argv.slice(2));
  const runDir = resolve(RUNS_DIR, args.run);
  mkdirSync(runDir, { recursive: true });

  const agents = await runAgents(args, runDir);

  const reconcile = await runReconcile(args.run, runDir);
  if (reconcile.status === "missing") console.log(`[run] ${RECONCILE_SCRIPT} no existe: reconcile pendiente de integrar.`);
  else console.log(`[run] reconcile ${reconcile.status}${reconcile.error ? ` (${reconcile.error})` : ""}`);

  const notes: string[] = [];
  let products: SummaryProduct[] = [];
  let movements: SummaryMovement[] = [];
  try {
    const data = await readLabData();
    products = data.products;
    movements = data.movements;
    notes.push(...data.notes);
  } catch (error) {
    notes.push(`No se pudo leer la base del laboratorio: ${error instanceof Error ? error.message : String(error)}`);
  }

  const events = readEvents(resolve(runDir, EVENTS_FILE_NAME));
  const input = { runId: args.run, events, products, movements, reconcile, agents, notes };
  const summaryFile = resolve(runDir, "summary.md");
  writeFileSync(summaryFile, buildSummary(input), "utf8");

  console.log(summaryFile);
  for (const line of shortSummary(input)) console.log(line);

  const agentsFailed = agents.some((a) => a.exitCode !== 0);
  process.exit(agentsFailed || reconcile.status === "failed" ? 1 : 0);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
