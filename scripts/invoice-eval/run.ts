/**
 * CLI del banco de evaluación del escaneo de facturas (SCN-10h; plan
 * factura-escaneo-gtm §5.4 SCN-10 y §10).
 *
 *   npm run invoice-eval -- --provider google|anthropic|mock [--model <id>]
 *     [--only f01,f02] [--no-fewshot] [--concurrency 2]
 *     [--out scripts/invoice-eval/runs] [--label texto] [--keys-env <ruta>]
 *     [--resume] [--no-cache]
 *   npm run invoice-eval -- --provider oracle [...]
 *   npm run invoice-eval -- --replay <run.json> [--fill-missing --provider p --model m] [...]
 *
 * Modos sin modelo (SCN-10l):
 * - `--provider oracle`: la extracción es la verdad (0 llamadas, tokens/costo
 *   null, duración 0). Mide SOLO el emparejamiento; few-shot no aplica.
 * - `--replay`: reutiliza las `predicted` guardadas de una corrida por (id,
 *   pasada) y recalcula el emparejamiento con el código y el lab actuales. Las
 *   que no tengan extracción quedan con error REPLAY_MISSING salvo
 *   `--fill-missing`, que las extrae con el proveedor/modelo de la corrida
 *   original (`--provider/--model` deben coincidir con su meta).
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
 *   Oráculo y replay sin --fill-missing no leen el archivo.
 * - Cerrojo `.notes/factura-escaneo/lab.lock` mientras corre.
 * - 3 errores de cuota seguidos cortan la pasada (aviso en el informe).
 *
 * Caché y reanudación (SCN-10n):
 * - Toda extracción real (google/anthropic) que termina bien se guarda en
 *   `scripts/invoice-eval/cache/<provider>/<modelId>/` (ver
 *   `cache/extractionCache.ts`); antes de llamar se busca allí. `--no-cache`
 *   fuerza la llamada (y sobrescribe la entrada). Los errores no se cachean.
 * - Un 429 se reintenta tras 65 s (ventana por minuto); si sigue, cuenta para
 *   la racha de cuota (diaria). Un PROVIDER_ERROR (503) se reintenta una vez.
 * - `--resume`: extrae reales antes que sintéticas en cada pasada; con la
 *   caché, repetir la corrida solo llama por lo que falta. El informe lista
 *   las facturas/pasadas que quedan por medir y por qué.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { InvoiceExtraction } from "../../src/modules/invoice-scan/contracts";
import { extractInvoice, type InvoiceFewShotExample } from "../../src/modules/invoice-scan/server/extract";
import {
  loadMatchContext,
  type MatchContextSupabaseClient,
} from "../../src/modules/invoice-scan/server/loadMatchContext";
import { createInvoiceScanModel } from "../../src/modules/invoice-scan/server/provider";
import { parseEnvFile } from "../stock-lab/env";

import {
  CACHE_DIR,
  productionFewShot,
  withExtractionCache,
  type ExtractionCacheState,
} from "./cache/extractionCache";
import { aggregate, TARGETS, type AggregateMetrics, type Bucket, type GlobalMetrics } from "./metrics";
import { FROM_ORIGINAL, ORACLE_BANNER, ORACLE_NA, modeTargetsOk, renderMarkdown, toJson, type ReportMode } from "./report";
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

export const CLI_PROVIDERS = ["google", "anthropic", "mock", "oracle"] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];
/** Proveedores que pasan por la factory (`oracle` no llama a nada). */
export type ModelProvider = Exclude<CliProvider, "oracle">;

export type CliOptions = {
  /** Obligatorio salvo con `--replay` (sin `--fill-missing`). */
  provider?: CliProvider;
  model?: string;
  only?: string[];
  fewShot: boolean;
  concurrency: number;
  out: string;
  label?: string;
  keysEnv: string;
  /** Ruta absoluta del run.json de origen. */
  replay?: string;
  fillMissing: boolean;
  /** false con `--no-cache`. */
  cache: boolean;
  resume: boolean;
};

const USAGE =
  "Uso: npm run invoice-eval -- --provider google|anthropic|mock|oracle [--model <id>] [--only f01,f02] " +
  "[--no-fewshot] [--concurrency n] [--out <dir>] [--label <texto>] [--keys-env <ruta>] [--resume] [--no-cache] " +
  "| --replay <run.json> [--fill-missing --provider <p> --model <m>]";

export function parseArgs(argv: readonly string[], cwd: string = process.cwd()): CliOptions {
  const values = new Map<string, string>();
  let fewShot = true;
  let noFewShotFlag = false;
  let fillMissing = false;
  let cache = true;
  let resume = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-cache") {
      cache = false;
      continue;
    }
    if (arg === "--resume") {
      resume = true;
      continue;
    }
    if (arg === "--no-fewshot") {
      fewShot = false;
      noFewShotFlag = true;
      continue;
    }
    if (arg === "--fill-missing") {
      fillMissing = true;
      continue;
    }
    const known = ["--provider", "--model", "--only", "--concurrency", "--out", "--label", "--keys-env", "--replay"];
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
  const replay = values.get("--replay");
  if (provider && !(CLI_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`--provider "${provider}" no es válido (google|anthropic|mock|oracle).`);
  }
  if (fillMissing && !replay) throw new Error(`--fill-missing solo vale con --replay. ${USAGE}`);
  if (replay) {
    if (noFewShotFlag) throw new Error("Con --replay el few-shot sale de la corrida de origen: quita --no-fewshot.");
    if (provider === "oracle") throw new Error("--replay y --provider oracle son modos distintos: usa uno.");
    if (fillMissing && (!provider || !values.get("--model"))) {
      throw new Error("--fill-missing exige --provider y --model iguales a los de la corrida de origen.");
    }
    if (!fillMissing && (provider || values.get("--model"))) {
      throw new Error("--replay sin --fill-missing no llama a ningún modelo: quita --provider/--model.");
    }
  } else if (!provider) {
    throw new Error(`--provider es obligatorio. ${USAGE}`);
  }
  if (provider === "oracle" && values.get("--model")) throw new Error("--provider oracle no usa --model.");
  if (resume && !cache) throw new Error("--resume necesita la caché: quita --no-cache.");
  if ((resume || !cache) && (replay || (provider !== "google" && provider !== "anthropic"))) {
    throw new Error("--resume y --no-cache solo valen con --provider google|anthropic (sin --replay).");
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
    ...(provider ? { provider: provider as CliProvider } : {}),
    ...(model ? { model } : {}),
    ...(only ? { only } : {}),
    // Oráculo: few-shot no aplica (conAlias reutiliza la extracción = verdad).
    fewShot: provider === "oracle" ? false : fewShot,
    concurrency,
    out: toAbsolute(values.get("--out") ?? join(EVAL_DIR, "runs")),
    ...(label ? { label } : {}),
    keysEnv: toAbsolute(values.get("--keys-env") ?? DEFAULT_KEYS_ENV),
    ...(replay ? { replay: toAbsolute(replay) } : {}),
    fillMissing,
    cache,
    resume,
  };
}

export type RunMode = "model" | "oracle" | "replay";

export function runModeOf(options: Pick<CliOptions, "provider" | "replay">): RunMode {
  if (options.replay) return "replay";
  return options.provider === "oracle" ? "oracle" : "model";
}

/**
 * Proveedor que hay que construir con la factory, o null si la corrida no hace
 * llamadas (oráculo; replay sin --fill-missing).
 */
export function modelProviderFor(options: Pick<CliOptions, "provider" | "replay" | "fillMissing">): ModelProvider | null {
  if (!options.provider || options.provider === "oracle") return null;
  if (options.replay && !options.fillMissing) return null;
  return options.provider;
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
/**
 * Lee el archivo de keys SOLO si la corrida llama a un modelo real (google o
 * anthropic). Oráculo, replay sin --fill-missing y mock no lo abren.
 */
export function resolveAiKeys(
  options: Pick<CliOptions, "provider" | "replay" | "fillMissing" | "keysEnv">,
  readFile: (path: string) => string,
): AiKeys {
  const provider = modelProviderFor(options);
  if (!provider || keyNameFor(provider) === null) return {};
  return readAiKeys(readFile(options.keysEnv));
}

export function applyModelEnv(
  env: Record<string, string | undefined>,
  options: { provider: ModelProvider; model?: string },
  keys: AiKeys,
): void {
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
  requested: { provider: ModelProvider; model?: string },
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
    // Formato saneado; los inválidos se omiten como en producción (la caché usa la misma función).
    const fewShot: InvoiceFewShotExample[] = productionFewShot(input.fewShot);
    const result = await extract({
      pages: input.pages,
      ...(fewShot.length > 0 ? { fewShot } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(model ? { model } : {}),
    });
    return result;
  };
}

// ───────────────────────── oráculo y replay (SCN-10l) ─────────────────────────

export const ORACLE_PROVIDER = "oracle";
export const ORACLE_MODEL_ID = "verdad";

/** Devuelve `truth.extraction` tal cual: 0 llamadas, tokens null, duración 0. */
export function createOracleExtractor(): BenchExtractor {
  return async (input) => {
    if (!input.invoice) throw new Error("Oráculo: el runner no indicó la factura.");
    return {
      extraction: structuredClone(input.invoice.truth.extraction),
      provider: ORACLE_PROVIDER,
      modelId: ORACLE_MODEL_ID,
      inputTokens: null,
      outputTokens: null,
      durationMs: 0,
      pages: input.pages.length,
    };
  };
}

export const REPLAY_MISSING_CODE = "REPLAY_MISSING";
export const REPLAY_MISSING_MESSAGE = "sin extracción en el replay";

export type ReplayEntry = {
  predicted: InvoiceExtraction;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
};

export type ReplaySource = {
  path: string;
  provider: string;
  modelId: string;
  fewShot: boolean;
  /** Clave `<id>:<bucket>`; solo entradas con `predicted`. */
  entries: Map<string, ReplayEntry>;
};

export function replayKey(id: string, bucket: string): string {
  return `${id}:${bucket}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Lee un run.json de `writeRun`: meta (proveedor/modelo/few-shot) y `predicted` por (id, pasada). */
export function parseReplaySource(raw: unknown, path: string): ReplaySource {
  if (!isRecord(raw) || !isRecord(raw.meta) || !Array.isArray(raw.perInvoice)) {
    throw new Error(`${path} no es un run.json del banco (falta meta o perInvoice).`);
  }
  const { meta } = raw;
  if (typeof meta.provider !== "string" || typeof meta.modelId !== "string" || typeof meta.fewShot !== "boolean") {
    throw new Error(`${path}: meta sin provider/modelId/fewShot.`);
  }
  const entries = new Map<string, ReplayEntry>();
  for (const item of raw.perInvoice) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.bucket !== "string") continue;
    const predicted = item.predicted;
    if (!isRecord(predicted) || !Array.isArray(predicted.lines)) continue;
    const tokens = isRecord(item.tokens) ? item.tokens : {};
    entries.set(replayKey(item.id, item.bucket), {
      predicted: predicted as unknown as InvoiceExtraction,
      inputTokens: numberOrNull(tokens.input),
      outputTokens: numberOrNull(tokens.output),
      durationMs: numberOrNull(item.durationMs),
    });
  }
  return { path, provider: meta.provider, modelId: meta.modelId, fewShot: meta.fewShot, entries };
}

/** --fill-missing solo con el mismo proveedor/modelo de la corrida de origen. */
export function assertFillMissingMatches(options: Pick<CliOptions, "provider" | "model">, source: ReplaySource): void {
  if (options.provider !== source.provider || options.model !== source.modelId) {
    throw new Error(
      `--fill-missing exige --provider ${source.provider} --model ${source.modelId} (los de la corrida de origen); ` +
        `se pidió --provider ${options.provider ?? "–"} --model ${options.model ?? "–"}.`,
    );
  }
}

/**
 * Devuelve la extracción guardada de (id, pasada) con tokens/tiempo de la
 * corrida original. Sin extracción: `fallback` (--fill-missing) o error
 * REPLAY_MISSING.
 */
export function createReplayExtractor(source: ReplaySource, fallback?: BenchExtractor) {
  const state = { replayed: 0, missing: 0, filled: 0 };
  const extractor: BenchExtractor = async (input) => {
    if (!input.invoice) throw new Error("Replay: el runner no indicó la factura.");
    const entry = source.entries.get(replayKey(input.invoice.id, input.invoice.bucket));
    if (entry) {
      state.replayed += 1;
      return {
        extraction: structuredClone(entry.predicted),
        provider: source.provider,
        modelId: source.modelId,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        durationMs: entry.durationMs ?? 0,
        pages: input.pages.length,
      };
    }
    state.missing += 1;
    if (!fallback) throw Object.assign(new Error(REPLAY_MISSING_MESSAGE), { code: REPLAY_MISSING_CODE });
    const result = await fallback(input);
    state.filled += 1;
    return result;
  };
  return { extractor, state };
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

/** Espera antes de reintentar un 429: más que la ventana por minuto (RPM). */
export const QUOTA_RETRY_DELAYS_MS: readonly number[] = [65_000];
/** Espera antes de reintentar un PROVIDER_ERROR (503 de sobrecarga, sobre todo). */
export const PROVIDER_RETRY_DELAYS_MS: readonly number[] = [20_000];

export type RetryOptions = {
  quotaDelaysMs?: readonly number[];
  providerDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (event: { code: string; delayMs: number; id?: string }) => void;
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Reintenta con espera: un 429 por minuto se resuelve esperando la ventana; si
 * tras las esperas sigue el 429, es la cuota diaria y el error sube (lo cuenta
 * `withQuotaCut`). Un PROVIDER_ERROR se reintenta también (503 transitorio).
 */
export function withRetry(extractor: BenchExtractor, options: RetryOptions = {}): BenchExtractor {
  const quotaDelays = options.quotaDelaysMs ?? QUOTA_RETRY_DELAYS_MS;
  const providerDelays = options.providerDelaysMs ?? PROVIDER_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  return async (input) => {
    let quotaTries = 0;
    let providerTries = 0;
    for (;;) {
      try {
        return await extractor(input);
      } catch (error) {
        const quota = isQuotaError(error);
        const provider = !quota && errorCode(error) === "PROVIDER_ERROR";
        const delay = quota ? quotaDelays[quotaTries] : provider ? providerDelays[providerTries] : undefined;
        if (delay === undefined) throw error;
        if (quota) quotaTries += 1;
        else providerTries += 1;
        options.onRetry?.({ code: quota ? "QUOTA" : "PROVIDER_ERROR", delayMs: delay, ...(input.invoice ? { id: input.invoice.id } : {}) });
        await sleep(delay);
      }
    }
  };
}

// ───────────────────────── pendientes (SCN-10n) ─────────────────────────

export type PendingExtraction = { id: string; bucket: Bucket; code: string; reason: string };

const PENDING_REASONS: Record<string, string> = {
  QUOTA: "cuota agotada (429 tras reintentar)",
  [QUOTA_CUT_CODE]: "cuota: pasada cortada, no se intentó",
  PROVIDER_ERROR: "proveedor no disponible (503/otro)",
  TIMEOUT: "timeout del modelo",
  INVALID_OUTPUT: "salida inválida del modelo (no se cachea; se reintenta)",
};

/**
 * Facturas/pasadas sin extracción medida: las que el runner intentó extraer y
 * fallaron. Las de conAlias que reutilizan la de sinAlias no cuentan aparte.
 */
export function pendingExtractions(result: Pick<BenchResult, "perInvoice">): PendingExtraction[] {
  return result.perInvoice
    .filter((entry) => !entry.reusedExtraction && entry.predicted === null && entry.error)
    .map((entry) => {
      const code = entry.error?.code ?? "?";
      return { id: entry.id, bucket: entry.bucket, code, reason: PENDING_REASONS[code] ?? entry.error?.message ?? "error" };
    });
}

export type MeasuredMetrics = { entries: number; of: number; global: GlobalMetrics };

/**
 * Métricas SOLO sobre las entradas con extracción (sin las pendientes, que el
 * agregado normal cuenta como fallo total). Las de conAlias pueden haber
 * aprendido menos alias si una anterior del proveedor quedó pendiente.
 */
export function measuredMetrics(result: Pick<BenchResult, "perInvoice">): MeasuredMetrics {
  const measured = result.perInvoice.filter((entry) => entry.predicted !== null);
  return { entries: measured.length, of: result.perInvoice.length, global: aggregate(measured.map((entry) => entry.metrics)) };
}

function pct1(value: number | null): string {
  return value === null ? "–" : `${(value * 100).toFixed(1)}%`;
}

export function measuredMarkdown(measured: MeasuredMetrics): string[] {
  const row = (name: string, m: AggregateMetrics) =>
    `| ${name} | ${m.invoices} | ${pct1(m.headerFieldRate)} | ${pct1(m.linesDetectedRate)} | ${pct1(m.exactRate)} | ${pct1(m.matchOkRate)} | ${pct1(m.confirmedWrongRate)} | ${m.p95DurationMs1Page ?? "–"} | ${m.avgCostUsd === null ? "–" : `$${m.avgCostUsd.toFixed(5)}`} |`;
  return [
    `## Métricas solo sobre lo medido (${measured.entries} de ${measured.of} entradas)`,
    "",
    "Sin las pendientes (que arriba cuentan como fallo). En conAlias, una anterior pendiente del mismo proveedor deja menos alias aprendidos.",
    "",
    "| Pasada | Facturas | Cabecera | Líneas detectadas | Exactitud | Emparejadas OK | Confirmadas mal | p95 1 pág. (ms) | $/factura |",
    "|---|---|---|---|---|---|---|---|---|",
    row("sin alias", measured.global.byBucket.sinAlias),
    row("con alias", measured.global.byBucket.conAlias),
    row("total", measured.global.total),
  ];
}

export function pendingMarkdown(pending: readonly PendingExtraction[], model: string): string[] {
  if (pending.length === 0) {
    return [`## Pendientes por medir (${model})`, "", "Ninguna: todas las extracciones de la corrida están medidas."];
  }
  return [
    `## Pendientes por medir (${model}): ${pending.length}`,
    "",
    "| Factura | Pasada | Motivo |",
    "|---|---|---|",
    ...pending.map((entry) => `| ${entry.id} | ${entry.bucket} | ${entry.reason} (${entry.code}) |`),
  ];
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

export function runBaseName(input: { date: Date; provider: string; model: string; label?: string; mode?: RunMode }): string {
  const parts =
    input.mode === "oracle"
      ? [caracasDate(input.date), "oraculo-solo-emparejamiento"]
      : input.mode === "replay"
        ? [caracasDate(input.date), "replay", slugPart(input.provider), slugPart(input.model)]
        : [caracasDate(input.date), slugPart(input.provider), slugPart(input.model)];
  if (input.label) parts.push(slugPart(input.label));
  return parts.join("-");
}

export type RunMeta = {
  /** Ausente = "model" (corridas anteriores a SCN-10l). */
  mode?: RunMode;
  /** Solo en oráculo: aviso explícito también en el JSON. */
  notice?: string;
  label?: string;
  requested: { provider?: CliProvider; model?: string };
  fewShot: boolean;
  only?: string[];
  quotaCut: boolean;
  quotaSkipped: number;
  /** --resume: reales primero; el informe lista lo pendiente. */
  resume?: boolean;
  /** Caché de extracciones (solo google/anthropic). Tokens y duración de los hits son de la llamada original. */
  cache?: ExtractionCacheState & { dir: string };
  /** Facturas/pasadas que quedan por medir (solo corridas con modelo). */
  pending?: PendingExtraction[];
  /** Con pendientes: métricas solo sobre lo medido. */
  measured?: MeasuredMetrics;
  replay?: {
    /** Corrida de origen (relativa al worktree si cae dentro). */
    source: string;
    sourceProvider: string;
    sourceModel: string;
    fillMissing: boolean;
    replayed: number;
    missing: number;
    filled: number;
    usage: typeof FROM_ORIGINAL;
  };
};

export function reportModeOf(meta: RunMeta): ReportMode {
  if (meta.mode === "oracle") return { kind: "oracle" };
  if (meta.mode === "replay" && meta.replay) {
    const { source, fillMissing, replayed, missing, filled } = meta.replay;
    return { kind: "replay", source, fillMissing, replayed, missing, filled };
  }
  return { kind: "model" };
}

export function displayPath(path: string, root: string = WORKTREE_ROOT): string {
  const rel = relative(root, path);
  return (rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path).replace(/\\/g, "/");
}

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
  const requested = [
    meta.mode === "replay" && meta.replay ? `--replay ${meta.replay.source}${meta.replay.fillMissing ? " --fill-missing" : ""}` : "",
    meta.requested.provider ? `--provider ${meta.requested.provider}` : "",
    meta.requested.model ? `--model ${meta.requested.model}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [
    `> Corrida: ${result.meta.provider} / ${result.meta.modelId}${meta.label ? ` — ${meta.label}` : ""}`,
    `> Pedido: ${requested}; few-shot ${meta.fewShot ? "sí" : "no"}${meta.mode === "oracle" ? " (no aplica en oráculo)" : ""}${meta.only ? `; solo ${meta.only.join(", ")}` : ""}`,
  ];
  if (meta.quotaCut) {
    lines.push(
      `> **AVISO: pasada cortada por cuota** (${QUOTA_STREAK_LIMIT} errores QUOTA seguidos; ${meta.quotaSkipped} extracciones no se intentaron). Las métricas de esta corrida están incompletas.`,
    );
  }
  if (meta.cache) lines.push(`> ${cacheLine(meta.cache)}`);
  const tailLines = [
    ...(meta.pending ? pendingMarkdown(meta.pending, `${result.meta.provider}/${result.meta.modelId}`) : []),
    ...(meta.measured ? ["", ...measuredMarkdown(meta.measured)] : []),
  ];
  const tail = tailLines.length > 0 ? `\n\n${tailLines.join("\n")}\n` : "";
  return `${lines.join("\n")}\n\n${renderMarkdown(result, reportModeOf(meta))}${tail}`;
}

export function cacheLine(cache: NonNullable<RunMeta["cache"]>): string {
  return (
    `Caché de extracciones (${cache.dir}${cache.enabled ? "" : ", --no-cache: no se leyó"}): ${cache.hits} de caché, ` +
    `${cache.calls} llamadas nuevas, ${cache.errors} llamadas con error (no cacheadas)${cache.invalid > 0 ? `, ${cache.invalid} entradas inválidas ignoradas` : ""}. ` +
    "Tokens y duración de las de caché son los de su llamada original."
  );
}

/** `<dir>/<fecha>-<provider>-<model>[-label][-n].md|.json`; nunca sobrescribe. */
export function writeRun(result: BenchResult, meta: RunMeta, dir: string, now: Date): { markdownPath: string; jsonPath: string } {
  mkdirSync(dir, { recursive: true });
  const base = runBaseName({
    date: now,
    provider: result.meta.provider,
    model: result.meta.modelId,
    ...(meta.label ? { label: meta.label } : {}),
    ...(meta.mode ? { mode: meta.mode } : {}),
  });
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
  const mode = reportModeOf(meta);
  const oracle = mode.kind === "oracle";
  const fromOriginal = mode.kind === "replay" ? ` (${FROM_ORIGINAL})` : "";
  const sin: AggregateMetrics = result.global.all.byBucket.sinAlias;
  const con: AggregateMetrics = result.global.all.byBucket.conAlias;
  const total = result.global.all.total;
  const row = (name: string, key: keyof (typeof TARGETS)["sinAlias"], pick: (m: AggregateMetrics) => number | null, comparator: ">=" | "<=") =>
    oracle && key !== "matchOkRate" && key !== "confirmedWrongRateMax"
      ? `${name.padEnd(22)} ${ORACLE_NA}`
      : `${name.padEnd(22)} sin ${pct(pick(sin)).padStart(6)} (${mark(pick(sin), TARGETS.sinAlias[key], comparator)} ${comparator}${pct(TARGETS.sinAlias[key])}) | con ${pct(pick(con)).padStart(6)} (${mark(pick(con), TARGETS.conAlias[key], comparator)} ${comparator}${pct(TARGETS.conAlias[key])})`;
  const errors = result.perInvoice.filter((entry) => entry.error);
  const codes = new Map<string, number>();
  errors.forEach((entry) => codes.set(entry.error?.code ?? "?", (codes.get(entry.error?.code ?? "?") ?? 0) + 1));
  const head = oracle
    ? `** ${ORACLE_BANNER} **`
    : mode.kind === "replay"
      ? `REPLAY de ${mode.source}: reutilizadas ${mode.replayed}, sin extracción ${mode.missing}${mode.fillMissing ? `, rellenadas ${mode.filled}` : ""}`
      : null;
  return [
    ...(head ? [head] : []),
    `${result.meta.provider}/${result.meta.modelId}${meta.label ? ` [${meta.label}]` : ""} few-shot=${meta.fewShot ? "sí" : "no"} facturas real=${result.meta.invoices.real} sint=${result.meta.invoices.synthetic}${meta.quotaCut ? " ** CORTADA POR CUOTA **" : ""}`,
    row("Cabecera", "headerFieldRate", (m) => m.headerFieldRate, ">="),
    row("Líneas detectadas", "linesDetectedRate", (m) => m.linesDetectedRate, ">="),
    row("Exactitud", "exactRate", (m) => m.exactRate, ">="),
    row("Emparejadas OK", "matchOkRate", (m) => m.matchOkRate, ">="),
    row("Confirmadas mal", "confirmedWrongRateMax", (m) => m.confirmedWrongRate, "<="),
    oracle
      ? `p95 1 página           ${ORACLE_NA}`
      : `p95 1 página           ${total.p95DurationMs1Page === null ? "–" : `${total.p95DurationMs1Page} ms`} (${mark(total.p95DurationMs1Page, TARGETS.p95DurationMs1PageMax, "<=")} <=${TARGETS.p95DurationMs1PageMax} ms)${fromOriginal}`,
    oracle
      ? `$/factura              ${ORACLE_NA}`
      : `$/factura              ${total.avgCostUsd === null ? "–" : `$${total.avgCostUsd.toFixed(5)}`} (${mark(total.avgCostUsd, TARGETS.avgCostUsdMax, "<=")} <=$${TARGETS.avgCostUsdMax}) tokens in=${total.inputTokens} out=${total.outputTokens}${fromOriginal}`,
    ...(meta.cache ? [`Caché                  ${meta.cache.hits} de caché, ${meta.cache.calls} nuevas, ${meta.cache.errors} con error`] : []),
    ...(meta.pending ? [`Pendientes             ${meta.pending.length}${meta.pending.length > 0 ? ` (${meta.pending.map((p) => `${p.id}:${p.bucket}`).join(", ")})` : ""}`] : []),
    `Errores                ${errors.length}${codes.size > 0 ? ` (${[...codes].map(([code, n]) => `${code}×${n}`).join(", ")})` : ""}; metas${oracle ? " de emparejamiento" : ""} ${modeTargetsOk(result, mode) ? "CUMPLIDAS" : "NO cumplidas"}`,
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

  const mode = runModeOf(options);
  const source = options.replay
    ? parseReplaySource(JSON.parse(readFileSync(options.replay, "utf8")) as unknown, displayPath(options.replay))
    : null;
  if (source && options.fillMissing) assertFillMissingMatches(options, source);

  // Keys: solo las dos de IA, solo la del proveedor pedido y solo si hay llamadas
  // reales (oráculo, replay sin --fill-missing y mock no leen el archivo).
  const modelProvider = modelProviderFor(options);
  let model: ReturnType<typeof createInvoiceScanModel> | null = null;
  if (modelProvider) {
    const keys = resolveAiKeys(options, (path) => readFileSync(path, "utf8"));
    const requested = { provider: modelProvider, ...(options.model ? { model: options.model } : {}) };
    applyModelEnv(process.env, requested, keys);
    model = createInvoiceScanModel();
    assertResolvedModel(requested, model);
  }
  const resolved =
    mode === "oracle"
      ? { provider: ORACLE_PROVIDER, modelId: ORACLE_MODEL_ID }
      : source
        ? { provider: source.provider, modelId: source.modelId }
        : (model as NonNullable<typeof model>);
  // Replay: el few-shot de la corrida de origen (sus extracciones conAlias son con o sin él).
  const fewShot = source ? source.fewShot : options.fewShot;

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
    // Extractor según el modo; la cuota solo vigila llamadas reales.
    // Orden: caché → corte por cuota → reintentos con espera → producción (un hit no gasta cuota ni lo bloquea el corte).
    const guard = model
      ? withQuotaCut(
          withRetry(toProductionExtractor(extractInvoice, model), {
            onRetry: (event) => console.log(`  reintento ${event.id ?? ""} tras ${event.code}: espera ${Math.round(event.delayMs / 1000)} s`),
          }),
        )
      : null;
    const realModel = model && keyNameFor(model.provider as CliProvider) !== null ? model : null;
    const cache =
      guard && realModel
        ? withExtractionCache(guard.extractor, {
            root: CACHE_DIR,
            provider: realModel.provider,
            modelId: realModel.modelId,
            enabled: options.cache,
          })
        : null;
    const modelExtractor = cache?.extractor ?? guard?.extractor;
    const replay = source ? createReplayExtractor(source, options.fillMissing ? modelExtractor : undefined) : null;
    const extractor = mode === "oracle" ? createOracleExtractor() : replay ? replay.extractor : (modelExtractor as BenchExtractor);
    const modeTag = mode === "oracle" ? " [ORÁCULO: solo emparejamiento]" : source ? ` [REPLAY de ${source.path}]` : "";
    console.log(`[invoice-eval] ${resolved.provider}/${resolved.modelId}${modeTag}: ${truths.length} facturas, few-shot ${fewShot ? "sí" : "no"}`);

    const now = new Date();
    const raw = await runBench({
      truths,
      extractor,
      loadContext: (_truth, extraction) => loadMatchContext(matchClient, ids.storeId, extraction),
      scenario: { products: ids.products, suppliers: ids.suppliers },
      readPage: (path) => readBenchPage(path),
      fewShot,
      concurrency: options.concurrency,
      ...(options.resume ? { extractOrder: "realFirst" as const } : {}),
      now: () => now,
      onProgress: (event) => {
        if (event.phase === "extract") {
          console.log(`  ${event.bucket} ${event.done}/${event.total} ${event.id}${event.error ? ` ERROR ${event.error.code ?? ""}` : ""}`);
        }
      },
    });

    const meta: RunMeta = {
      mode,
      ...(mode === "oracle" ? { notice: ORACLE_BANNER } : {}),
      ...(options.label ? { label: options.label } : {}),
      requested: {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
      },
      fewShot,
      ...(options.only ? { only: options.only } : {}),
      quotaCut: guard?.state.cut ?? false,
      quotaSkipped: guard?.state.skipped ?? 0,
      ...(options.resume ? { resume: true } : {}),
      ...(cache ? { cache: { ...cache.state, dir: displayPath(CACHE_DIR) } } : {}),
      ...(mode === "model" ? { pending: pendingExtractions(raw) } : {}),
      ...(mode === "model" && pendingExtractions(raw).length > 0 ? { measured: measuredMetrics(raw) } : {}),
      ...(source && replay
        ? {
            replay: {
              source: source.path,
              sourceProvider: source.provider,
              sourceModel: source.modelId,
              fillMissing: options.fillMissing,
              ...replay.state,
              usage: FROM_ORIGINAL,
            },
          }
        : {}),
    };
    const result = withResolvedModel(raw, resolved);
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
