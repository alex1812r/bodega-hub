/**
 * CLI del banco de evaluación del escaneo de facturas (SCN-10h; plan
 * factura-escaneo-gtm §5.4 SCN-10 y §10).
 *
 *   npm run invoice-eval -- --provider google|anthropic|mock [--model <id>]
 *     [--only f01,f02] [--no-fewshot] [--concurrency 2]
 *     [--out scripts/invoice-eval/runs] [--label texto] [--keys-env <ruta>]
 *
 * Conecta `runBench` con `extractInvoice` (el mismo extractor de producción) y
 * `loadMatchContext` contra la base LAB con la sesión del admin del escenario
 * (service-role no pasa `assert_store_context`).
 *
 * Entorno:
 * - Supabase SOLO de `.env.stock-lab` del worktree; aborta si la URL no es local.
 * - Keys de IA: de `--keys-env` se leen ÚNICAMENTE GOOGLE_GENERATIVE_AI_API_KEY y
 *   ANTHROPIC_API_KEY (ese archivo apunta a producción: nada más entra en
 *   process.env), y solo la del proveedor pedido. Nunca se imprimen ni se escriben.
 * - Cerrojo `.notes/factura-escaneo/lab.lock` mientras corre.
 * - 3 errores de cuota seguidos cortan la pasada (aviso en el informe).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { extractInvoice, type InvoiceFewShotExample } from "../../src/modules/invoice-scan/server/extract";
import { toFewShotFormat } from "../../src/modules/invoice-scan/server/fewShot";
import {
  loadMatchContext,
  type MatchContextSupabaseClient,
} from "../../src/modules/invoice-scan/server/loadMatchContext";
import { createInvoiceScanModel } from "../../src/modules/invoice-scan/server/provider";
import { parseEnvFile } from "../stock-lab/env";

import { TARGETS, type AggregateMetrics } from "./metrics";
import { renderMarkdown, toJson } from "./report";
import { runBench, type BenchExtractor, type BenchPage, type BenchResult } from "./runner";
import { SCENARIO_USER_EMAIL, SCENARIO_USER_PASSWORD } from "./scenario/catalog";
import { loadScenarioIds } from "./seed-lab";
import { loadTruth } from "./truth";

const EVAL_DIR = __dirname;
const WORKTREE_ROOT = resolve(__dirname, "../..");
const MAIN_REPO = "C:\\Users\\alexa\\Developments\\Alex\\control-ventas";
export const DEFAULT_KEYS_ENV = join(MAIN_REPO, ".env.local");
export const LAB_LOCK_PATH = join(MAIN_REPO, ".notes", "factura-escaneo", "lab.lock");
export const QUOTA_STREAK_LIMIT = 3;

// ───────────────────────── flags ─────────────────────────

export const CLI_PROVIDERS = ["google", "anthropic", "mock"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

export type CliOptions = {
  provider: CliProvider;
  model?: string;
  only?: string[];
  fewShot: boolean;
  concurrency: number;
  out: string;
  label?: string;
  keysEnv: string;
};

const USAGE =
  "Uso: npm run invoice-eval -- --provider google|anthropic|mock [--model <id>] [--only f01,f02] " +
  "[--no-fewshot] [--concurrency n] [--out <dir>] [--label <texto>] [--keys-env <ruta>]";

export function parseArgs(argv: readonly string[], cwd: string = process.cwd()): CliOptions {
  const values = new Map<string, string>();
  let fewShot = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-fewshot") {
      fewShot = false;
      continue;
    }
    const known = ["--provider", "--model", "--only", "--concurrency", "--out", "--label", "--keys-env"];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (!known.includes(flag)) throw new Error(`Flag desconocido: ${arg}. ${USAGE}`);
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || value.startsWith("--") || value.trim() === "") {
      throw new Error(`${flag} necesita un valor. ${USAGE}`);
    }
    values.set(flag, value.trim());
  }

  const provider = values.get("--provider");
  if (!provider) throw new Error(`--provider es obligatorio. ${USAGE}`);
  if (!(CLI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`--provider "${provider}" no es válido (google|anthropic|mock).`);
  }
  const concurrencyRaw = values.get("--concurrency") ?? "2";
  const concurrency = Number(concurrencyRaw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error(`--concurrency debe ser un entero entre 1 y 8 (recibido "${concurrencyRaw}").`);
  }
  const only = values
    .get("--only")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (only && only.length === 0) throw new Error("--only no trae ningún id.");
  const toAbsolute = (path: string) => (isAbsolute(path) ? path : resolve(cwd, path));
  const model = values.get("--model");
  const label = values.get("--label");

  return {
    provider: provider as CliProvider,
    ...(model ? { model } : {}),
    ...(only ? { only } : {}),
    fewShot,
    concurrency,
    out: toAbsolute(values.get("--out") ?? join(EVAL_DIR, "runs")),
    ...(label ? { label } : {}),
    keysEnv: toAbsolute(values.get("--keys-env") ?? DEFAULT_KEYS_ENV),
  };
}

// ───────────────────────── keys y entorno ─────────────────────────

export const AI_KEY_NAMES = ["GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY"] as const;
export type AiKeyName = (typeof AI_KEY_NAMES)[number];
export type AiKeys = Partial<Record<AiKeyName, string>>;

/**
 * Parser propio, línea a línea, que SOLO reconoce las dos keys de IA. El resto
 * del archivo (producción) se ignora sin guardarlo en ningún sitio.
 */
export function readAiKeys(text: string): AiKeys {
  const keys: AiKeys = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    for (const name of AI_KEY_NAMES) {
      const match = new RegExp(`^${name}\\s*=(.*)$`).exec(line);
      if (!match) continue;
      let value = match[1].trim();
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (value) keys[name] = value;
    }
  }
  return keys;
}

export function keyNameFor(provider: CliProvider): AiKeyName | null {
  if (provider === "google") return "GOOGLE_GENERATIVE_AI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  return null;
}

/**
 * Deja en `env` solo la key del proveedor pedido (la del otro se borra: así la
 * factory no puede caer a otro proveedor) y fija INVOICE_SCAN_PROVIDER/MODEL.
 */
export function applyModelEnv(env: Record<string, string | undefined>, options: Pick<CliOptions, "provider" | "model">, keys: AiKeys): void {
  for (const name of AI_KEY_NAMES) delete env[name];
  const keyName = keyNameFor(options.provider);
  if (keyName) {
    const value = keys[keyName];
    if (!value) throw new Error(`El archivo de keys no trae ${keyName}: no se puede correr --provider ${options.provider}.`);
    env[keyName] = value;
  }
  env.INVOICE_SCAN_PROVIDER = options.provider;
  if (options.model) env.INVOICE_SCAN_MODEL = options.model;
}

/** Aborta si la factory resolvió otro proveedor u otro modelo que el pedido. */
export function assertResolvedModel(
  requested: Pick<CliOptions, "provider" | "model">,
  resolved: { provider: string; modelId: string },
): void {
  if (resolved.provider !== requested.provider) {
    throw new Error(
      `Se pidió --provider ${requested.provider} pero la factory resolvió "${resolved.provider}" (${resolved.modelId}). ` +
        "Falta la key o no es válida: abortado para no medir otro modelo.",
    );
  }
  if (requested.model && resolved.modelId !== requested.model) {
    throw new Error(`Se pidió --model ${requested.model} pero la factory resolvió "${resolved.modelId}": abortado.`);
  }
}

const LOCAL_SUPABASE_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function assertLocalSupabaseUrl(url: string | undefined): string {
  if (!url?.trim()) throw new Error("NEXT_PUBLIC_SUPABASE_URL no está en .env.stock-lab.");
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL de .env.stock-lab no es una URL válida.");
  }
  if (!LOCAL_SUPABASE_HOSTS.has(host)) {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL apunta a "${host}": el banco solo corre contra 127.0.0.1 / localhost.`);
  }
  return url.trim();
}

/** Solo `.env.stock-lab` del worktree (sin caer al `.example`). */
export function loadLabSupabase(root: string = WORKTREE_ROOT): { url: string; anonKey: string; serviceRoleKey: string } {
  const path = join(root, ".env.stock-lab");
  if (!existsSync(path)) throw new Error(`No existe ${path}: el banco solo lee Supabase del laboratorio.`);
  const env = parseEnvFile(readFileSync(path, "utf8"));
  const url = assertLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está en .env.stock-lab.");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY no está en .env.stock-lab.");
  return { url, anonKey, serviceRoleKey };
}

// ───────────────────────── cerrojo ─────────────────────────

export function acquireLabLock(path: string, now: Date = new Date()): string {
  const stamp = `evaluacion-bench ${caracasTime(now)}`;
  mkdirSync(resolve(path, ".."), { recursive: true });
  try {
    writeFileSync(path, `${stamp}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const holder = readFileSync(path, "utf8").trim();
      throw new Error(`El lab está ocupado (lab.lock: "${holder}"). Espera a que se libere.`);
    }
    throw error;
  }
  return stamp;
}

/** Solo borra el cerrojo si sigue siendo el nuestro. */
export function releaseLabLock(path: string, stamp: string): void {
  try {
    if (readFileSync(path, "utf8").trim() === stamp) unlinkSync(path);
  } catch {
    // Ya no existe: nada que liberar.
  }
}

// ───────────────────────── extractor ─────────────────────────

/** Ajusta la forma del runner (`confirmed`) a la de producción (`format` saneado con `toFewShotFormat`). */
export function toProductionExtractor(
  extract: typeof extractInvoice,
  model: Parameters<typeof extractInvoice>[0]["model"],
): BenchExtractor {
  return async (input) => {
    const fewShot: InvoiceFewShotExample[] = [];
    for (const example of input.fewShot ?? []) {
      const reduced = toFewShotFormat(example.confirmed);
      if (!reduced.ok) continue; // producción también lo omite
      fewShot.push({ format: reduced.format, ...(example.page ? { page: example.page } : {}) });
    }
    const result = await extract({
      pages: input.pages,
      ...(fewShot.length > 0 ? { fewShot } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(model ? { model } : {}),
    });
    return result;
  };
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as Record<string, unknown>;
  return record.code === "QUOTA" || record.status === 429 || record.statusCode === 429;
}

export const QUOTA_CUT_CODE = "QUOTA_CUT";

/**
 * Tras `limit` errores de cuota seguidos, las extracciones siguientes fallan
 * sin llamar al modelo (código QUOTA_CUT). `state.cutAfter` = id de progreso.
 */
export function withQuotaCut(extractor: BenchExtractor, limit: number = QUOTA_STREAK_LIMIT) {
  const state = { streak: 0, cut: false, skipped: 0 };
  const guarded: BenchExtractor = async (input) => {
    if (state.cut) {
      state.skipped += 1;
      throw Object.assign(new Error(`Pasada cortada: ${limit} errores de cuota seguidos.`), { code: QUOTA_CUT_CODE });
    }
    try {
      const result = await extractor(input);
      state.streak = 0;
      return result;
    } catch (error) {
      if (isQuotaError(error)) {
        state.streak += 1;
        if (state.streak >= limit) state.cut = true;
      } else {
        state.streak = 0;
      }
      throw error;
    }
  };
  return { extractor: guarded, state };
}

// ───────────────────────── salida ─────────────────────────

function caracasDate(now: Date): string {
  return new Date(now.getTime() - 4 * 3600_000).toISOString().slice(0, 10);
}

function caracasTime(now: Date): string {
  return new Date(now.getTime() - 4 * 3600_000).toISOString().slice(11, 16);
}

export function slugPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "") || "desconocido"
  );
}

export function runBaseName(input: { date: Date; provider: string; model: string; label?: string }): string {
  const parts = [caracasDate(input.date), slugPart(input.provider), slugPart(input.model)];
  if (input.label) parts.push(slugPart(input.label));
  return parts.join("-");
}

export type RunMeta = {
  label?: string;
  requested: { provider: CliProvider; model?: string };
  fewShot: boolean;
  only?: string[];
  quotaCut: boolean;
  quotaSkipped: number;
};

/**
 * Si ninguna extracción respondió, el runner no sabe el modelo ("desconocido"):
 * se toma el resuelto por la factory (ya verificado contra el pedido).
 */
export function withResolvedModel(result: BenchResult, resolved: { provider: string; modelId: string }): BenchResult {
  const unknown = "desconocido";
  if (result.meta.provider !== unknown && result.meta.modelId !== unknown) return result;
  return { ...result, meta: { ...result.meta, provider: resolved.provider, modelId: resolved.modelId } };
}

export function renderRunMarkdown(result: BenchResult, meta: RunMeta): string {
  const lines = [
    `> Corrida: ${result.meta.provider} / ${result.meta.modelId}${meta.label ? ` — ${meta.label}` : ""}`,
    `> Pedido: --provider ${meta.requested.provider}${meta.requested.model ? ` --model ${meta.requested.model}` : ""}; few-shot ${meta.fewShot ? "sí" : "no"}${meta.only ? `; solo ${meta.only.join(", ")}` : ""}`,
  ];
  if (meta.quotaCut) {
    lines.push(
      `> **AVISO: pasada cortada por cuota** (${QUOTA_STREAK_LIMIT} errores QUOTA seguidos; ${meta.quotaSkipped} extracciones no se intentaron). Las métricas de esta corrida están incompletas.`,
    );
  }
  return `${lines.join("\n")}\n\n${renderMarkdown(result)}`;
}

/** `<dir>/<fecha>-<provider>-<model>[-label][-n].md|.json`; nunca sobrescribe. */
export function writeRun(result: BenchResult, meta: RunMeta, dir: string, now: Date): { markdownPath: string; jsonPath: string } {
  mkdirSync(dir, { recursive: true });
  const base = runBaseName({ date: now, provider: result.meta.provider, model: result.meta.modelId, ...(meta.label ? { label: meta.label } : {}) });
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    const markdownPath = join(dir, `${name}.md`);
    const jsonPath = join(dir, `${name}.json`);
    if (existsSync(markdownPath) || existsSync(jsonPath)) continue;
    writeFileSync(markdownPath, renderRunMarkdown(result, meta), { encoding: "utf8", flag: "wx" });
    const json = JSON.parse(toJson(result)) as Record<string, unknown>;
    writeFileSync(jsonPath, `${JSON.stringify({ run: meta, ...json }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { markdownPath, jsonPath };
  }
}

function pct(value: number | null): string {
  return value === null ? "–" : `${(value * 100).toFixed(1)}%`;
}

function mark(value: number | null, target: number, comparator: ">=" | "<="): string {
  if (value === null) return "–";
  return (comparator === ">=" ? value >= target - 1e-9 : value <= target + 1e-9) ? "OK" : "NO";
}

/** Resumen de 10 líneas: métricas globales por bucket contra las metas §10. */
export function summaryLines(result: BenchResult, meta: RunMeta, files: { markdownPath: string }): string[] {
  const sin: AggregateMetrics = result.global.all.byBucket.sinAlias;
  const con: AggregateMetrics = result.global.all.byBucket.conAlias;
  const total = result.global.all.total;
  const row = (name: string, key: keyof (typeof TARGETS)["sinAlias"], pick: (m: AggregateMetrics) => number | null, comparator: ">=" | "<=") =>
    `${name.padEnd(22)} sin ${pct(pick(sin)).padStart(6)} (${mark(pick(sin), TARGETS.sinAlias[key], comparator)} ${comparator}${pct(TARGETS.sinAlias[key])}) | con ${pct(pick(con)).padStart(6)} (${mark(pick(con), TARGETS.conAlias[key], comparator)} ${comparator}${pct(TARGETS.conAlias[key])})`;
  const errors = result.perInvoice.filter((entry) => entry.error);
  const codes = new Map<string, number>();
  errors.forEach((entry) => codes.set(entry.error?.code ?? "?", (codes.get(entry.error?.code ?? "?") ?? 0) + 1));
  return [
    `${result.meta.provider}/${result.meta.modelId}${meta.label ? ` [${meta.label}]` : ""} few-shot=${meta.fewShot ? "sí" : "no"} facturas real=${result.meta.invoices.real} sint=${result.meta.invoices.synthetic}${meta.quotaCut ? " ** CORTADA POR CUOTA **" : ""}`,
    row("Cabecera", "headerFieldRate", (m) => m.headerFieldRate, ">="),
    row("Líneas detectadas", "linesDetectedRate", (m) => m.linesDetectedRate, ">="),
    row("Exactitud", "exactRate", (m) => m.exactRate, ">="),
    row("Emparejadas OK", "matchOkRate", (m) => m.matchOkRate, ">="),
    row("Confirmadas mal", "confirmedWrongRateMax", (m) => m.confirmedWrongRate, "<="),
    `p95 1 página           ${total.p95DurationMs1Page === null ? "–" : `${total.p95DurationMs1Page} ms`} (${mark(total.p95DurationMs1Page, TARGETS.p95DurationMs1PageMax, "<=")} <=${TARGETS.p95DurationMs1PageMax} ms)`,
    `$/factura              ${total.avgCostUsd === null ? "–" : `$${total.avgCostUsd.toFixed(5)}`} (${mark(total.avgCostUsd, TARGETS.avgCostUsdMax, "<=")} <=$${TARGETS.avgCostUsdMax}) tokens in=${total.inputTokens} out=${total.outputTokens}`,
    `Errores                ${errors.length}${codes.size > 0 ? ` (${[...codes].map(([code, n]) => `${code}×${n}`).join(", ")})` : ""}; metas ${result.targets.ok ? "CUMPLIDAS" : "NO cumplidas"}`,
    `Informe                ${files.markdownPath}`,
  ];
}

// ───────────────────────── main ─────────────────────────

const MEDIA_TYPES: Record<string, BenchPage["mediaType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function readBenchPage(path: string, baseDir: string = EVAL_DIR): BenchPage {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Extensión de página no soportada: ${path}`);
  return { data: new Uint8Array(readFileSync(join(baseDir, path))), mediaType };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const lab = loadLabSupabase();

  // Keys: solo las dos de IA, y solo la del proveedor pedido. Mock no lee el archivo.
  const keys = options.provider === "mock" ? {} : readAiKeys(readFileSync(options.keysEnv, "utf8"));
  applyModelEnv(process.env, options, keys);
  const model = createInvoiceScanModel();
  assertResolvedModel(options, model);

  let truths = loadTruth(join(EVAL_DIR, "truth"));
  if (options.only) {
    const wanted = new Set(options.only);
    const unknown = options.only.filter((id) => !truths.some((truth) => truth.id === id));
    if (unknown.length > 0) throw new Error(`--only con ids sin verdad: ${unknown.join(", ")}`);
    truths = truths.filter((truth) => wanted.has(truth.id));
  }

  const stamp = acquireLabLock(LAB_LOCK_PATH);
  try {
    const client = createClient(lab.url, lab.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await client.auth.signInWithPassword({ email: SCENARIO_USER_EMAIL, password: SCENARIO_USER_PASSWORD });
    if (login.error) {
      throw new Error(`Login del usuario del escenario falló (${login.error.message}): ¿falta npx tsx scripts/invoice-eval/seed-lab.ts?`);
    }
    // `stores` solo lo lee un superadmin: los ids salen con service-role del lab (solo
    // lectura); el emparejamiento va con la sesión del admin (assert_store_context).
    const admin = createClient(lab.url, lab.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const ids = await loadScenarioIds(admin);
    const profile = await client.from("profiles").select("store_id").eq("id", login.data.user.id).maybeSingle();
    const profileStore = (profile.data as { store_id?: string } | null)?.store_id;
    if (profile.error || profileStore !== ids.storeId) {
      throw new Error("El usuario del escenario no pertenece a la tienda eval-facturas: re-sembrar con seed-lab.ts.");
    }
    const matchClient = client as unknown as MatchContextSupabaseClient;
    const guard = withQuotaCut(toProductionExtractor(extractInvoice, model));
    console.log(`[invoice-eval] ${model.provider}/${model.modelId}: ${truths.length} facturas, few-shot ${options.fewShot ? "sí" : "no"}`);

    const now = new Date();
    const raw = await runBench({
      truths,
      extractor: guard.extractor,
      loadContext: (_truth, extraction) => loadMatchContext(matchClient, ids.storeId, extraction),
      scenario: { products: ids.products, suppliers: ids.suppliers },
      readPage: (path) => readBenchPage(path),
      fewShot: options.fewShot,
      concurrency: options.concurrency,
      now: () => now,
      onProgress: (event) => {
        if (event.phase === "extract") {
          console.log(`  ${event.bucket} ${event.done}/${event.total} ${event.id}${event.error ? ` ERROR ${event.error.code ?? ""}` : ""}`);
        }
      },
    });

    const meta: RunMeta = {
      ...(options.label ? { label: options.label } : {}),
      requested: { provider: options.provider, ...(options.model ? { model: options.model } : {}) },
      fewShot: options.fewShot,
      ...(options.only ? { only: options.only } : {}),
      quotaCut: guard.state.cut,
      quotaSkipped: guard.state.skipped,
    };
    const result = withResolvedModel(raw, model);
    const files = writeRun(result, meta, options.out, now);
    console.log(summaryLines(result, meta, files).join("\n"));
    await client.auth.signOut();
  } finally {
    releaseLabLock(LAB_LOCK_PATH, stamp);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`[invoice-eval] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
