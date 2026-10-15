/**
 * SCN-12 · Exportador del dataset de ajuste supervisado (SFT) de Gemini en Vertex AI
 * a partir de `invoice_scans` confirmados (plan factura-escaneo-gtm §0b y §5.4).
 *
 *   npm run invoice-eval:export-finetune -- --store eval-facturas --gcs-prefix gs://mi-bucket/invoice-scans \
 *     [--out <file.jsonl>] [--since 2026-10-01] [--validation-ratio 0.1] [--download-dir <dir>] \
 *     [--env-file .env.stock-lab] [--allow-remote]
 *
 * NO ejecuta ningún entrenamiento ni sube nada a Google: solo escribe JSONL locales
 * (y, con `--download-dir`, copia las imágenes del bucket privado `invoice-scans`
 * para que el usuario las suba con `gsutil -m cp -r <dir>/* gs://mi-bucket/invoice-scans/`).
 *
 * Formato (documentación oficial consultada el 2026-10-15; las URL cloud.google.com
 * redirigen a docs.cloud.google.com):
 * - Preparar datos: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning-prepare
 * - SFT y límites:  https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning
 * - Usar SFT:       https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-use-supervised-tuning
 * - Imagen:         https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/tune_gemini/image_tune
 * Una línea JSON por ejemplo: `systemInstruction` (solo partes `text`) y `contents[]`
 * con un turno `user` (una parte `fileData {mimeType, fileUri}` por página + una parte
 * `text` con la instrucción) y un turno `model` (una parte `text` = JSON de la
 * extracción confirmada). Cada parte lleva `text` O `fileData`, nunca ambos.
 * Límites aplicados: ≤ 30 imágenes por ejemplo, ≤ 20 MB por imagen (solo se puede
 * comprobar al descargar), ≤ 131.072 tokens por ejemplo (estimación conservadora,
 * ver `estimateTokens`), ≤ 5.000 ejemplos de validación. Modelos ajustables hoy:
 * gemini-3.5-flash, Gemini 3.1 Flash-Lite, Gemini 2.5 Pro / Flash / Flash-Lite.
 * La doc recomienda empezar con 100–500 ejemplos.
 *
 * Salida del modelo: un `InvoiceExtraction` (src/modules/invoice-scan/contracts.ts)
 * corregido por el usuario y validado con `invoiceExtractionSchema`, sin ids internos.
 * `invoice_scans.confirmed` tiene hoy dos formas posibles y se aceptan las dos:
 * 1. `InvoiceExtraction` completo (lo que Extracción lee como few-shot): se usa tal cual.
 * 2. `ConfirmedInvoiceScan` (lo que escribe Emparejamiento en `confirm_invoice_scan`,
 *    `buildConfirmedPayload`): `lines[{ lineIndex, productId, packLabel, unitsPerPack,
 *    aliasNorm, rawText }]`. Se reconstruye desde `extracted` con estas reglas:
 *    - `confirmed` no guarda cantidades, precios ni totales: se conservan los de `extracted`;
 *    - `unitsPerPack` no nulo confirmado reemplaza el leído; nulo/ausente lo conserva
 *      (modo unidad = decisión de entrada, no prueba de que la factura no lo imprima);
 *    - `confirmed` solo referencia líneas de `extracted` (no puede añadir líneas);
 *    - si alguna línea de `extracted` no aparece en `confirmed`, el ejemplo se OMITE:
 *      no se distingue una línea mal leída de una línea no comprada;
 *    - si el `rawText` confirmado no coincide con el de `extracted`, o una misma línea
 *      se confirma con dos tamaños de empaque distintos, el ejemplo se OMITE;
 *    - `productId`, `supplierId`, `purchaseId`, alias y fechas de confirmación nunca
 *      pasan a la salida (el modelo no conoce los ids).
 *
 * Imágenes: `fileUri = <gcs-prefix>/<ruta>`; multipágina con la convención de
 * Extracción (`<store>/<sha>/p1.<ext>` → `p2.<ext>`…, `invoiceScanPagePaths`).
 * Entorno: solo lee `--env-file` (default `.env.stock-lab`); si la URL de Supabase no
 * es local exige `--allow-remote` (solo lectura). Nunca imprime claves.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  invoiceExtractionSchema,
  type InvoiceExtraction,
} from "../../src/modules/invoice-scan/contracts";
import { parseEnvFile } from "../stock-lab/env";

const ROOT = resolve(__dirname, "../..");

export const INVOICE_SCANS_BUCKET = "invoice-scans";
export const MAX_IMAGES_PER_EXAMPLE = 30;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_TOKENS_PER_EXAMPLE = 131_072;
export const MAX_VALIDATION_EXAMPLES = 5_000;
export const RECOMMENDED_MIN_EXAMPLES = 100;
/** Cota superior por imagen (2240 = `ultra_high` de la Developer API, mayor que cualquier nivel de tuning). */
export const IMAGE_TOKEN_BUDGET = 2_240;
const PAGE_SIZE = 500;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FIRST_PAGE_PATH = /^(.+\/)p1\.(jpg|jpeg|png|webp)$/i;
const SAFE_STORAGE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export const SYSTEM_INSTRUCTION = [
  "Eres un lector de facturas de compra de una bodega venezolana.",
  "Devuelve SOLO un objeto JSON con las claves: supplier {name, taxId?, phone?, address?}, number?, date? (YYYY-MM-DD),",
  'currency ("VES" | "USD" | "unknown"), printedRate?, lines[], subtotal?, tax?, total?, confidence (0..1), warnings[] (en español).',
  "Cada línea: rawText (texto literal de la línea), description, quantity, unit? (unidad|caja|bulto|paquete|display|otro),",
  "unitsPerPack?, unitPrice, lineTotal, taxHint? (exento|reducida|general|unknown), barcode?, supplierSku?, confidence (0..1).",
  "No inventes líneas ni valores: si algo no se lee, omítelo y avisa en warnings.",
].join(" ");

export function userInstruction(pages: number): string {
  return pages > 1
    ? `Extrae la factura de estas ${pages} páginas (en orden) como un único JSON.`
    : "Extrae la factura de esta imagen como JSON.";
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type InvoiceScanExportRow = {
  id: string;
  storage_path: string;
  pages: number;
  extracted: unknown;
  confirmed: unknown;
  created_at?: string;
};

export type TuningPart = { text: string } | { fileData: { mimeType: string; fileUri: string } };

export type TuningExample = {
  systemInstruction: { parts: { text: string }[] };
  contents: [{ role: "user"; parts: TuningPart[] }, { role: "model"; parts: [{ text: string }] }];
};

export type BuildOptions = {
  /** `gs://bucket/prefijo` (sin barra final obligatoria). */
  gcsPrefix: string;
  /** MIME detectado por cabecera tras descargar, por ruta (pisa la extensión). */
  mimeOverrides?: Record<string, string>;
};

export type BuildResult =
  | { ok: true; example: TuningExample; line: string; imagePaths: string[]; source: "extraction" | "confirmed-lines" }
  | { ok: false; reason: string };

type ConfirmedLine = { lineIndex: number; rawText?: unknown; unitsPerPack?: unknown };

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

/** Rutas de las páginas (misma convención que Extracción: `<store>/<sha>/pN.<ext>`). */
export function invoiceScanPagePaths(storagePath: string, pages: number): string[] {
  const match = storagePath.match(FIRST_PAGE_PATH);
  if (!match || pages <= 1) return [storagePath];
  return Array.from({ length: pages }, (_, index) => `${match[1]}p${index + 1}.${match[2]}`);
}

export function mimeTypeFromPath(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    default:
      return null;
  }
}

export function mimeTypeFromHeader(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Estimación conservadora: texto ≈ 1 token cada 3 caracteres + `IMAGE_TOKEN_BUDGET` por imagen. */
export function estimateTokens(example: TuningExample): number {
  let chars = example.systemInstruction.parts.reduce((sum, part) => sum + part.text.length, 0);
  let images = 0;
  for (const content of example.contents) {
    for (const part of content.parts) {
      if ("text" in part) chars += part.text.length;
      else images += 1;
    }
  }
  return Math.ceil(chars / 3) + images * IMAGE_TOKEN_BUDGET;
}

function isConfirmedLinesShape(value: unknown): value is { lines: ConfirmedLine[] } {
  const lines = (value as { lines?: unknown } | null)?.lines;
  return (
    Array.isArray(lines) &&
    lines.every(
      (line) =>
        line !== null &&
        typeof line === "object" &&
        Number.isInteger((line as { lineIndex?: unknown }).lineIndex) &&
        (line as { lineIndex: number }).lineIndex >= 0,
    )
  );
}

/**
 * Extracción corregida por el usuario o motivo de omisión (reglas en la cabecera).
 */
export function reconstructExtraction(
  row: Pick<InvoiceScanExportRow, "extracted" | "confirmed">,
): { ok: true; extraction: InvoiceExtraction; source: "extraction" | "confirmed-lines" } | { ok: false; reason: string } {
  if (row.confirmed === null || row.confirmed === undefined) return { ok: false, reason: "confirmed vacío" };

  const direct = invoiceExtractionSchema.safeParse(row.confirmed);
  if (direct.success) return { ok: true, extraction: direct.data, source: "extraction" };

  if (!isConfirmedLinesShape(row.confirmed)) {
    return { ok: false, reason: "confirmed con forma desconocida" };
  }

  const base = invoiceExtractionSchema.safeParse(row.extracted);
  if (!base.success) return { ok: false, reason: "extracted no cumple invoiceExtractionSchema" };

  const extraction = structuredClone(base.data);
  const packByIndex = new Map<number, number | null>();

  for (const line of row.confirmed.lines) {
    const target = extraction.lines[line.lineIndex];
    if (!target) return { ok: false, reason: "confirmed apunta a una línea que no existe en extracted" };
    if (typeof line.rawText === "string" && line.rawText !== target.rawText) {
      return { ok: false, reason: "rawText confirmado no coincide con extracted" };
    }
    const units =
      typeof line.unitsPerPack === "number" && Number.isInteger(line.unitsPerPack) && line.unitsPerPack > 0
        ? line.unitsPerPack
        : null;
    const previous = packByIndex.get(line.lineIndex);
    if (previous !== undefined && previous !== null && units !== null && previous !== units) {
      return { ok: false, reason: "una línea confirmada con dos tamaños de empaque" };
    }
    packByIndex.set(line.lineIndex, previous ?? units);
  }

  if (packByIndex.size < extraction.lines.length) {
    return {
      ok: false,
      reason: "confirmed no cubre todas las líneas de extracted (no se distingue línea mal leída de no comprada)",
    };
  }

  for (const [index, units] of packByIndex) {
    if (units !== null) extraction.lines[index] = { ...extraction.lines[index]!, unitsPerPack: units };
  }

  const checked = invoiceExtractionSchema.safeParse(extraction);
  if (!checked.success) return { ok: false, reason: "la extracción corregida no cumple invoiceExtractionSchema" };
  return { ok: true, extraction: checked.data, source: "confirmed-lines" };
}

export function assertGcsPrefix(prefix: string): string {
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]{1,220}[a-z0-9](\/.*)?$/.test(prefix)) {
    throw new Error("--gcs-prefix debe empezar por gs:// seguido de un bucket válido (p. ej. gs://mi-bucket/invoice-scans)");
  }
  return prefix.replace(/\/+$/, "");
}

/** Fila confirmada → ejemplo de tuning (una línea JSONL) o motivo de omisión. */
export function buildTuningExample(row: InvoiceScanExportRow, opts: BuildOptions): BuildResult {
  const prefix = assertGcsPrefix(opts.gcsPrefix);
  const pages = Number.isInteger(row.pages) && row.pages > 0 ? row.pages : 1;
  if (pages > MAX_IMAGES_PER_EXAMPLE) {
    return { ok: false, reason: `más de ${MAX_IMAGES_PER_EXAMPLE} imágenes por ejemplo` };
  }
  if (!SAFE_STORAGE_PATH.test(row.storage_path) || row.storage_path.split("/").includes("..")) {
    return { ok: false, reason: "storage_path inválido" };
  }

  const imagePaths = invoiceScanPagePaths(row.storage_path, pages);
  if (imagePaths.length !== pages) {
    return { ok: false, reason: "storage_path no sigue la convención multipágina <store>/<sha>/p1.<ext>" };
  }

  const fileParts: TuningPart[] = [];
  for (const path of imagePaths) {
    const mimeType = opts.mimeOverrides?.[path] ?? mimeTypeFromPath(path);
    if (!mimeType) return { ok: false, reason: "imagen con formato no admitido" };
    fileParts.push({ fileData: { mimeType, fileUri: `${prefix}/${path}` } });
  }

  const reconstructed = reconstructExtraction(row);
  if (!reconstructed.ok) return reconstructed;

  const answer = JSON.stringify(reconstructed.extraction);
  if (UUID_PATTERN.test(answer)) return { ok: false, reason: "la extracción contiene un id interno" };

  const example: TuningExample = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      { role: "user", parts: [...fileParts, { text: userInstruction(pages) }] },
      { role: "model", parts: [{ text: answer }] },
    ],
  };
  if (estimateTokens(example) > MAX_TOKENS_PER_EXAMPLE) {
    return { ok: false, reason: `supera ${MAX_TOKENS_PER_EXAMPLE} tokens por ejemplo (estimado)` };
  }
  return { ok: true, example, line: JSON.stringify(example), imagePaths, source: reconstructed.source };
}

/** Fracción determinista en [0, 1) por hash SHA-256 del id. */
export function hashFraction(id: string): number {
  return createHash("sha256").update(id).digest().readUInt32BE(0) / 0x1_0000_0000;
}

/** Reparto determinista entrenamiento/validación por hash del id (independiente del orden). */
export function splitTrainValidation<T extends { id: string }>(
  items: readonly T[],
  ratio: number,
): { train: T[]; validation: T[] } {
  if (!(ratio >= 0 && ratio < 1)) throw new Error("--validation-ratio debe estar en [0, 1)");
  const train: T[] = [];
  const validation: T[] = [];
  for (const item of items) {
    (ratio > 0 && hashFraction(item.id) < ratio ? validation : train).push(item);
  }
  return { train, validation };
}

export function validationPath(out: string): string {
  return out.replace(/\.jsonl$/i, "") + ".validation.jsonl";
}

// ---------------------------------------------------------------------------
// CLI / IO
// ---------------------------------------------------------------------------

export type ExportOptions = {
  store: string;
  gcsPrefix: string;
  out: string;
  since?: string;
  validationRatio: number;
  downloadDir?: string;
  envFile: string;
  allowRemote: boolean;
};

export type ExportSummary = {
  storeId: string;
  rows: number;
  examples: number;
  train: number;
  validation: number;
  images: number;
  downloaded: number;
  skipped: { id: string; reason: string }[];
  out: string;
  validationOut: string | null;
  warnings: string[];
};

function todayCaracas(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
}

export function defaultOutPath(): string {
  return resolve(ROOT, ".notes/factura-escaneo/evaluacion/finetune", `${todayCaracas()}.jsonl`);
}

export function parseArgs(argv: readonly string[]): ExportOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) throw new Error(`Argumento inesperado: ${arg}`);
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (key === "allow-remote") {
      flags.add(key);
      continue;
    }
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`Falta el valor de --${key}`);
    values.set(key, value);
  }
  const known = new Set(["store", "gcs-prefix", "out", "since", "validation-ratio", "download-dir", "env-file"]);
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`Opción desconocida: --${key}`);

  const store = values.get("store");
  if (!store) throw new Error("--store <id|slug> es obligatorio");
  const gcsPrefix = values.get("gcs-prefix");
  if (!gcsPrefix) throw new Error("--gcs-prefix gs://bucket/prefijo es obligatorio");
  assertGcsPrefix(gcsPrefix);
  const since = values.get("since");
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since debe ser YYYY-MM-DD");
  const validationRatio = Number(values.get("validation-ratio") ?? "0.1");
  if (!(validationRatio >= 0 && validationRatio < 1)) throw new Error("--validation-ratio debe estar en [0, 1)");
  const out = resolve(values.get("out") ?? defaultOutPath());
  if (!/\.jsonl$/i.test(out)) throw new Error("--out debe terminar en .jsonl");

  return {
    store,
    gcsPrefix,
    out,
    ...(since ? { since } : {}),
    validationRatio,
    ...(values.get("download-dir") ? { downloadDir: resolve(values.get("download-dir")!) } : {}),
    envFile: values.get("env-file") ?? ".env.stock-lab",
    allowRemote: flags.has("allow-remote"),
  };
}

type Logger = Pick<Console, "log" | "warn">;

/** Lee el archivo de entorno y valida el destino; nunca devuelve ni imprime más que la URL. */
export function loadExportEnv(
  envFile: string,
  allowRemote: boolean,
  log: Logger = console,
): { supabaseUrl: string; serviceRoleKey: string } {
  const path = isAbsolute(envFile) ? envFile : resolve(ROOT, envFile);
  if (!existsSync(path)) throw new Error(`No existe ${envFile}`);
  const env = parseEnvFile(readFileSync(path, "utf8"));
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`${envFile} debe definir NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY`);
  }
  let host: string;
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no es una URL válida");
  }
  if (!LOCAL_HOSTS.has(host)) {
    if (!allowRemote) {
      throw new Error(`La URL de Supabase apunta a "${host}" (no local): repite con --allow-remote si de verdad quieres leerla`);
    }
    log.warn(`AVISO: lectura de una base REMOTA (${host}) con --allow-remote. El export solo lee; no escribe en la base.`);
  }
  return { supabaseUrl, serviceRoleKey };
}

async function resolveStoreId(client: SupabaseClient, store: string): Promise<string> {
  const column = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(store) ? "id" : "slug";
  const { data, error } = await client.from("stores").select("id").eq(column, store).maybeSingle();
  if (error) throw new Error(`stores: ${error.message}`);
  const id = (data as { id: string } | null)?.id;
  if (!id) throw new Error(`No existe la tienda ${store}`);
  return id;
}

async function fetchConfirmedRows(client: SupabaseClient, storeId: string, since?: string): Promise<InvoiceScanExportRow[]> {
  const rows: InvoiceScanExportRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client
      .from("invoice_scans")
      .select("id, storage_path, pages, extracted, confirmed, created_at")
      .eq("store_id", storeId)
      .eq("status", "confirmed")
      .not("confirmed", "is", null);
    // Día operativo de Caracas (UTC-4).
    if (since) query = query.gte("created_at", `${since}T00:00:00-04:00`);
    const { data, error } = await query.order("created_at").order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`invoice_scans: ${error.message}`);
    rows.push(...((data ?? []) as InvoiceScanExportRow[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function insideDir(dir: string, path: string): string {
  const target = resolve(dir, path);
  const rel = relative(dir, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("ruta de imagen fuera de --download-dir");
  return target;
}

/** Descarga las páginas; devuelve el MIME por cabecera o un motivo de omisión. */
async function downloadImages(
  client: SupabaseClient,
  dir: string,
  paths: string[],
): Promise<{ ok: true; mimes: Record<string, string> } | { ok: false; reason: string }> {
  const mimes: Record<string, string> = {};
  const files: { target: string; bytes: Uint8Array }[] = [];
  for (const path of paths) {
    const { data, error } = await client.storage.from(INVOICE_SCANS_BUCKET).download(path);
    if (error || !data) return { ok: false, reason: "imagen no encontrada en Storage" };
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "imagen de más de 20 MB" };
    const mime = mimeTypeFromHeader(bytes) ?? mimeTypeFromPath(path);
    if (!mime) return { ok: false, reason: "imagen con formato no admitido" };
    mimes[path] = mime;
    files.push({ target: insideDir(dir, path), bytes });
  }
  for (const file of files) {
    mkdirSync(dirname(file.target), { recursive: true });
    writeFileSync(file.target, file.bytes);
  }
  return { ok: true, mimes };
}

export async function runExport(options: ExportOptions, log: Logger = console): Promise<ExportSummary> {
  const env = loadExportEnv(options.envFile, options.allowRemote, log);
  const client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const storeId = await resolveStoreId(client, options.store);
  const rows = await fetchConfirmedRows(client, storeId, options.since);

  const built: { id: string; line: string; images: number }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let downloaded = 0;

  for (const row of rows) {
    let result = buildTuningExample(row, { gcsPrefix: options.gcsPrefix });
    if (result.ok && options.downloadDir) {
      const download = await downloadImages(client, options.downloadDir, result.imagePaths);
      if (!download.ok) {
        skipped.push({ id: row.id, reason: download.reason });
        continue;
      }
      downloaded += result.imagePaths.length;
      result = buildTuningExample(row, { gcsPrefix: options.gcsPrefix, mimeOverrides: download.mimes });
    }
    if (result.ok) built.push({ id: row.id, line: result.line, images: result.imagePaths.length });
    else skipped.push({ id: row.id, reason: result.reason });
  }

  const { train, validation } = splitTrainValidation(built, options.validationRatio);
  const warnings: string[] = [];
  if (validation.length > MAX_VALIDATION_EXAMPLES) {
    warnings.push(`validación con ${validation.length} ejemplos: Vertex admite como mucho ${MAX_VALIDATION_EXAMPLES}`);
  }
  if (built.length < RECOMMENDED_MIN_EXAMPLES) {
    warnings.push(`solo ${built.length} ejemplos: la doc recomienda 100–500 para empezar`);
  }

  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, train.map((item) => `${item.line}\n`).join(""), "utf8");
  const validationOut = options.validationRatio > 0 ? validationPath(options.out) : null;
  if (validationOut) writeFileSync(validationOut, validation.map((item) => `${item.line}\n`).join(""), "utf8");

  return {
    storeId,
    rows: rows.length,
    examples: built.length,
    train: train.length,
    validation: validation.length,
    images: built.reduce((sum, item) => sum + item.images, 0),
    downloaded,
    skipped,
    out: options.out,
    validationOut,
    warnings,
  };
}

export function formatSummary(summary: ExportSummary): string {
  const reasons = new Map<string, number>();
  for (const item of summary.skipped) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  return [
    `escaneos confirmados leídos: ${summary.rows}`,
    `ejemplos: ${summary.examples} (entrenamiento ${summary.train}, validación ${summary.validation})`,
    `omitidos: ${summary.skipped.length}`,
    ...[...reasons].map(([reason, count]) => `  - ${count} × ${reason}`),
    ...summary.skipped.map((item) => `    · ${item.id}: ${item.reason}`),
    `imágenes referenciadas: ${summary.images}${summary.downloaded ? ` (descargadas ${summary.downloaded})` : ""}`,
    `salida: ${summary.out}`,
    ...(summary.validationOut ? [`validación: ${summary.validationOut}`] : []),
    ...summary.warnings.map((warning) => `AVISO: ${warning}`),
    "No se ejecutó ningún entrenamiento ni se subió nada a Google.",
  ].join("\n");
}

async function main(): Promise<void> {
  const summary = await runExport(parseArgs(process.argv.slice(2)));
  console.log(formatSummary(summary));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
