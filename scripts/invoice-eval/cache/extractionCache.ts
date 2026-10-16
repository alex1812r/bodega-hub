/**
 * Caché persistente de extracciones del banco (SCN-10n).
 *
 * Cada llamada real al modelo que termina bien se guarda en
 * `cache/<provider>/<modelId>/<id>-<pasada>-<clave>.json` con la extracción,
 * tokens, duración, fecha y modelId resuelto. La clave es el hash de lo que
 * recibe el modelo: prompt del sistema (`buildInvoiceSystemPrompt`), contrato
 * (JSON Schema de `invoiceExtractionSchema`), mensajes de few-shot y de la
 * página objetivo tal como los arma `prompt.ts` (con las imágenes sustituidas
 * por su sha256) y los ids de las facturas de few-shot. Un cambio de prompt,
 * de contrato, de few-shot o de imagen cambia la clave: la entrada vieja deja
 * de casar y se vuelve a llamar.
 *
 * Los errores (429, 503, timeout, salida inválida) NO se cachean. En la caché
 * no entra ninguna key ni la imagen: solo hashes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { invoiceExtractionSchema, type InvoiceExtraction } from "../../../src/modules/invoice-scan/contracts";
import type { InvoiceFewShotExample } from "../../../src/modules/invoice-scan/server/extract";
import { toFewShotFormat } from "../../../src/modules/invoice-scan/server/fewShot";
import {
  buildFewShotMessages,
  buildInvoiceSystemPrompt,
  buildTargetMessage,
} from "../../../src/modules/invoice-scan/server/prompt";

import type { BenchExtractInput, BenchExtractor, BenchFewShotExample } from "../runner";

/** Sube si cambia la forma del archivo de caché o de la clave. */
export const CACHE_FORMAT_VERSION = 1;
export const CACHE_DIR = __dirname;

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Few-shot como lo recibe `extractInvoice`: formato saneado; los inválidos se omiten (igual que producción). */
export function productionFewShot(examples: readonly BenchFewShotExample[] | undefined): InvoiceFewShotExample[] {
  const fewShot: InvoiceFewShotExample[] = [];
  for (const example of examples ?? []) {
    const reduced = toFewShotFormat(example.confirmed);
    if (!reduced.ok) continue;
    fewShot.push({ format: reduced.format, ...(example.page ? { page: example.page } : {}) });
  }
  return fewShot;
}

export type PromptFingerprint = { systemPromptHash: string; contractHash: string };

/** Hash del prompt del sistema y del contrato, desde el código vigente de `prompt.ts`/`contracts.ts`. */
export function currentPromptFingerprint(): PromptFingerprint {
  return {
    systemPromptHash: sha256(buildInvoiceSystemPrompt()),
    contractHash: sha256(JSON.stringify(z.toJSONSchema(invoiceExtractionSchema))),
  };
}

/** JSON estable de los mensajes con cada Uint8Array (imagen) reemplazado por su sha256. */
function hashedMessages(input: BenchExtractInput): string {
  const messages = [
    ...buildFewShotMessages(productionFewShot(input.fewShot)),
    ...input.pages.map((page, index) => buildTargetMessage(page, index + 1, input.pages.length)),
  ];
  return JSON.stringify(messages, (_key, value: unknown) =>
    value instanceof Uint8Array ? `sha256:${sha256(value)}` : value,
  );
}

export function extractionCacheKey(
  input: BenchExtractInput,
  target: { provider: string; modelId: string },
  fingerprint: PromptFingerprint,
): string {
  return sha256(
    JSON.stringify({
      v: CACHE_FORMAT_VERSION,
      provider: target.provider,
      modelId: target.modelId,
      systemPromptHash: fingerprint.systemPromptHash,
      contractHash: fingerprint.contractHash,
      fewShotIds: input.fewShotIds ?? [],
      messagesHash: sha256(hashedMessages(input)),
    }),
  );
}

function pathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-") || "desconocido";
}

export function extractionCachePath(
  root: string,
  target: { provider: string; modelId: string },
  ref: { id: string; bucket: string },
  key: string,
): string {
  return join(
    root,
    pathPart(target.provider),
    pathPart(target.modelId),
    `${pathPart(ref.id)}-${pathPart(ref.bucket)}-${key.slice(0, 16)}.json`,
  );
}

export type ExtractionCacheEntry = {
  version: number;
  key: string;
  provider: string;
  modelId: string;
  invoiceId: string;
  bucket: string;
  fewShotIds: string[];
  systemPromptHash: string;
  contractHash: string;
  extraction: InvoiceExtraction;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  pages: number;
  savedAt: string;
};

export type CacheFs = {
  read: (path: string) => string | null;
  write: (path: string, text: string) => void;
};

export const nodeCacheFs: CacheFs = {
  read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  write: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
};

export type ExtractionCacheState = {
  /** false con --no-cache: no se lee (sí se escribe lo nuevo). */
  enabled: boolean;
  hits: number;
  /** Llamadas nuevas que terminaron bien (y se guardaron). */
  calls: number;
  /** Llamadas que fallaron (no se guardan). */
  errors: number;
  /** Archivos con la clave pero ilegibles o con otra clave/extracción inválida (se tratan como miss). */
  invalid: number;
};

export type ExtractionCacheOptions = {
  root: string;
  provider: string;
  modelId: string;
  /** false = `--no-cache`: siempre llama, y guarda (sobrescribe) el resultado nuevo. */
  enabled: boolean;
  fingerprint?: PromptFingerprint;
  fs?: CacheFs;
  now?: () => Date;
};

function parseEntry(text: string, key: string): ExtractionCacheEntry | null {
  try {
    const raw = JSON.parse(text) as Partial<ExtractionCacheEntry>;
    if (raw.version !== CACHE_FORMAT_VERSION || raw.key !== key) return null;
    const extraction = invoiceExtractionSchema.safeParse(raw.extraction);
    if (!extraction.success || typeof raw.durationMs !== "number") return null;
    return { ...(raw as ExtractionCacheEntry), extraction: extraction.data };
  } catch {
    return null;
  }
}

/**
 * Antes de llamar busca (id, pasada, clave) en la caché; si está, devuelve la
 * extracción guardada con sus tokens y duración originales (`cached: true`).
 * Sin `input.invoice` no cachea (no sabe a qué factura pertenece).
 */
export function withExtractionCache(extractor: BenchExtractor, options: ExtractionCacheOptions) {
  const fs = options.fs ?? nodeCacheFs;
  const fingerprint = options.fingerprint ?? currentPromptFingerprint();
  const target = { provider: options.provider, modelId: options.modelId };
  const state: ExtractionCacheState = { enabled: options.enabled, hits: 0, calls: 0, errors: 0, invalid: 0 };

  const cached: BenchExtractor = async (input) => {
    const ref = input.invoice;
    const key = ref ? extractionCacheKey(input, target, fingerprint) : null;
    const path = ref && key ? extractionCachePath(options.root, target, ref, key) : null;

    if (options.enabled && path && key) {
      const text = fs.read(path);
      if (text !== null) {
        const entry = parseEntry(text, key);
        if (entry) {
          state.hits += 1;
          return {
            extraction: entry.extraction,
            provider: entry.provider,
            modelId: entry.modelId,
            inputTokens: entry.inputTokens,
            outputTokens: entry.outputTokens,
            durationMs: entry.durationMs,
            pages: entry.pages,
            cached: true,
          };
        }
        state.invalid += 1;
      }
    }

    let result: Awaited<ReturnType<BenchExtractor>>;
    try {
      result = await extractor(input);
    } catch (error) {
      state.errors += 1;
      throw error;
    }
    state.calls += 1;
    if (ref && key && path) {
      const entry: ExtractionCacheEntry = {
        version: CACHE_FORMAT_VERSION,
        key,
        provider: result.provider,
        modelId: result.modelId,
        invoiceId: ref.id,
        bucket: ref.bucket,
        fewShotIds: input.fewShotIds ?? [],
        systemPromptHash: fingerprint.systemPromptHash,
        contractHash: fingerprint.contractHash,
        extraction: result.extraction,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
        pages: result.pages,
        savedAt: (options.now ? options.now() : new Date()).toISOString(),
      };
      fs.write(path, `${JSON.stringify(entry, null, 2)}\n`);
    }
    return { ...result, cached: false };
  };

  return { extractor: cached, state };
}
