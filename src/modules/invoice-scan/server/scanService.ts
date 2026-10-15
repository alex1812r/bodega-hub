/**
 * Orquestación del escaneo de facturas para el BFF (plan factura-escaneo-gtm
 * §3 "Idempotencia y cuota" y "Trazabilidad", §4 endpoints): validación de
 * bytes, reserva atómica (caché por hash, en curso y cuota diaria por tienda),
 * subida al bucket privado, few-shot de la capa 2, extracción y emparejamiento. Las dependencias se inyectan para testear el
 * flujo sin red; `createInvoiceScanDeps` arma las reales según la fuente de datos.
 *
 * El `storeId` y el `userId` siempre salen de la sesión (`InvoiceScanContext`).
 * Nunca se registra el contenido de la factura: en `invoice_scans.error` solo
 * queda el código del fallo.
 */
import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import type { ApiDataSource } from "@/lib/api/dataSource";
import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { mockState } from "@/shared/mocks/mockStore";

import type {
  InvoiceExtraction,
  InvoiceMatch,
  InvoiceScanResponse,
} from "../contracts";
import {
  extractInvoice,
  InvoiceExtractionError,
  toInvoiceScanApiError,
  type InvoiceFewShotExample,
  type InvoicePage,
} from "./extract";
import { inspectInvoiceImage } from "./imageInfo";
import { matchScan, type InvoiceScanMatcher } from "./matchScan";
import { createInvoiceScanModel, type InvoiceScanModelInfo } from "./provider";
import * as mockRepo from "./scans.mock-server";
import * as serverRepo from "./scans.server";
import {
  invoiceScanPagePaths,
  MAX_FEW_SHOT_EXAMPLES,
  readInvoiceScanDailyLimit,
  type InvoiceScanContext,
  type InvoiceScanStatus,
} from "./scans.types";
import {
  assertPathInStore,
  createInvoiceSignedReadUrl,
  downloadInvoicePage,
  INVOICE_INVALID_PATH_MESSAGE,
  INVOICE_MAX_BYTES,
  INVOICE_MAX_PAGES,
  INVOICE_PAGE_NOT_FOUND_MESSAGE,
  INVOICE_SCANS_BUCKET,
  invoiceScanMediaTypes,
  invoiceScanPath,
  sha256OfPages,
  uploadInvoicePage,
  type InvoiceScanMediaType,
} from "./storage";

export type InvoiceScanRepo = Pick<
  typeof serverRepo,
  "completeScan" | "discardScan" | "failScan" | "getDailyUsage" | "getScan" | "listFewShotExamples" | "reserveScan"
>;

/** Bucket privado `invoice-scans`; las rutas ya vienen validadas bajo la tienda de la sesión. */
export type InvoiceScanStorage = {
  upload(path: string, data: Uint8Array, mediaType: InvoiceScanMediaType): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  signedReadUrl(path: string, expiresInSeconds: number): Promise<string>;
};

export type InvoiceScanDeps = {
  dataSource: ApiDataSource;
  dailyLimit: number;
  extract: typeof extractInvoice;
  matcher: InvoiceScanMatcher;
  model: () => InvoiceScanModelInfo;
  now: () => Date;
  repo: InvoiceScanRepo;
  storage: InvoiceScanStorage;
};

export type ScanInvoiceInput =
  | { source: "upload"; pages: InvoicePage[]; sha256?: string; supplierId?: string }
  | { source: "storage"; sha256: string; storagePaths: string[]; supplierId?: string };

export type InvoiceScanDetail = {
  scanId: string;
  status: InvoiceScanStatus;
  extraction: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
  pages: number;
  createdAt: string;
  imageUrls: string[];
};

export type DiscardedInvoiceScan = { scanId: string; status: InvoiceScanStatus };

/** Las URLs firmadas de lectura de las páginas caducan a los 5 minutos. */
export const INVOICE_READ_URL_TTL_SECONDS = 300;

export const INVOICE_SCAN_NOT_FOUND_MESSAGE = "No encontramos ese escaneo de factura.";
export const INVOICE_HASH_MISMATCH_MESSAGE =
  "El hash de la factura no coincide con las páginas enviadas. Vuelve a cargarla.";
export const INVOICE_MIXED_TYPES_MESSAGE = "Todas las páginas de la factura deben tener el mismo formato.";
export const INVOICE_SCAN_IN_PROGRESS_MESSAGE =
  "Esta factura ya se está leyendo; espera unos segundos y vuelve a intentarlo.";
/** Código guardado en `invoice_scans.error` cuando el cliente corta la petición durante la lectura. */
export const INVOICE_SCAN_CLIENT_ABORTED = "CLIENT_ABORTED";
export const INVOICE_SCAN_CHANGED_MESSAGE =
  "La lectura de esta factura cambió mientras se procesaba. Vuelve a intentarlo.";

/**
 * Tope del cuerpo multipart: Vercel corta a 4,5 MB con un 413 que no es de la
 * app, así que la app corta antes. Por encima, el cliente sube por upload-url.
 */
export const INVOICE_MULTIPART_MAX_BYTES = 4 * 1024 * 1024;
export const INVOICE_MULTIPART_TOO_LARGE_MESSAGE =
  "La factura pesa más de 4 MB en total para enviarla de una vez. Súbela página por página con la subida directa (upload-url).";

export function multipartTooLarge(): ApiError {
  return new ApiError(413, "PAYLOAD_TOO_LARGE", INVOICE_MULTIPART_TOO_LARGE_MESSAGE);
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "El hash de la factura no es válido.");
const supplierIdSchema = z.string().trim().min(1).max(100);

export const storedScanBodySchema = z.object({
  sha256: sha256Schema,
  storagePaths: z.array(z.string().max(300)).min(1).max(INVOICE_MAX_PAGES),
  supplierId: supplierIdSchema.optional(),
});

const formFieldsSchema = z.object({
  sha256: sha256Schema.optional(),
  supplierId: supplierIdSchema.optional(),
});

const MEDIA_TYPE_BY_EXTENSION: Record<string, InvoiceScanMediaType> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const PAGE_FILE_EXTENSION = /\/p\d+\.(jpg|png|webp)$/;

function badRequest(message: string): never {
  throw new ApiError(400, "BAD_REQUEST", message);
}

function notFound(): never {
  throw new ApiError(404, "NOT_FOUND", INVOICE_SCAN_NOT_FOUND_MESSAGE);
}

function isInvoiceMediaType(value: string): value is InvoiceScanMediaType {
  return (invoiceScanMediaTypes as readonly string[]).includes(value);
}

function mediaTypeOfPath(path: string): InvoiceScanMediaType | null {
  const extension = path.match(PAGE_FILE_EXTENSION)?.[1];

  return extension ? (MEDIA_TYPE_BY_EXTENSION[extension] ?? null) : null;
}

function formString(form: FormData, key: string) {
  const value = form.get(key);

  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Forma multipart: campos `page` (1..10 imágenes JPG/PNG/WebP de ≤ 1 MB cada
 * una y ≤ 4 MB en total), `sha256` y `supplierId` opcionales. Una página de
 * más peso, o un total de más de 4 MB, es 413.
 */
export async function readUploadedPages(form: FormData): Promise<ScanInvoiceInput> {
  const entries = form.getAll("page");

  if (entries.length === 0) {
    badRequest("Adjunta al menos una página de la factura.");
  }

  if (entries.length > INVOICE_MAX_PAGES) {
    badRequest(`La factura puede tener como máximo ${INVOICE_MAX_PAGES} páginas.`);
  }

  const pages: InvoicePage[] = [];
  let totalBytes = 0;

  for (const [index, entry] of entries.entries()) {
    const label = `La página ${index + 1}`;

    if (typeof entry === "string") {
      badRequest(`${label} no es un archivo.`);
    }

    if (!isInvoiceMediaType(entry.type)) {
      badRequest(`${label} no es una imagen JPG, PNG o WebP.`);
    }

    if (entry.size === 0) {
      badRequest(`${label} está vacía.`);
    }

    if (entry.size > INVOICE_MAX_BYTES) {
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        `${label} pesa más de 1 MB. Comprímela o vuelve a tomar la foto.`,
      );
    }

    totalBytes += entry.size;

    if (totalBytes > INVOICE_MULTIPART_MAX_BYTES) {
      throw multipartTooLarge();
    }

    pages.push({ data: new Uint8Array(await entry.arrayBuffer()), mediaType: entry.type });
  }

  const fields = formFieldsSchema.parse({
    sha256: formString(form, "sha256"),
    supplierId: formString(form, "supplierId"),
  });

  return { pages, source: "upload", ...fields };
}

type LoadedScan = {
  pages: InvoicePage[];
  sha256: string;
  /** Ruta de la página 1; las demás se derivan (`p<n>.<ext>`). */
  storagePath: string;
  /** Solo la forma multipart sube las páginas; la otra ya las subió el cliente. */
  pendingUploads: { path: string; page: InvoicePage }[];
};

function assertSameMediaType(mediaTypes: readonly InvoiceScanMediaType[]) {
  if (new Set(mediaTypes).size > 1) {
    badRequest(INVOICE_MIXED_TYPES_MESSAGE);
  }
}

/** Bytes mágicos, tipo declarado y tamaño: antes de subir, de cobrar y de reservar. */
function assertImages(pages: readonly InvoicePage[]) {
  for (const page of pages) {
    inspectInvoiceImage(page.data, page.mediaType);
  }
}

function assertHash(expected: string | undefined, actual: string) {
  if (expected !== undefined && expected !== actual) {
    badRequest(INVOICE_HASH_MISMATCH_MESSAGE);
  }
}

async function loadScan(
  deps: InvoiceScanDeps,
  ctx: InvoiceScanContext,
  input: ScanInvoiceInput,
): Promise<LoadedScan> {
  if (input.source === "upload") {
    const mediaTypes = input.pages.map((page) => page.mediaType);
    assertSameMediaType(mediaTypes);
    assertImages(input.pages);

    const sha256 = sha256OfPages(input.pages.map((page) => page.data));
    assertHash(input.sha256, sha256);

    const pendingUploads = input.pages.map((page, index) => ({
      page,
      path: invoiceScanPath(ctx.storeId, sha256, index + 1, page.mediaType),
    }));

    return { pages: input.pages, pendingUploads, sha256, storagePath: pendingUploads[0]!.path };
  }

  for (const path of input.storagePaths) {
    assertPathInStore(path, ctx.storeId);
  }

  const mediaTypes = input.storagePaths.map(
    (path) => mediaTypeOfPath(path) ?? badRequest(INVOICE_INVALID_PATH_MESSAGE),
  );
  assertSameMediaType(mediaTypes);

  // Las rutas deben ser exactamente p1..pN del hash declarado: así la página 1
  // basta para derivar las demás.
  input.storagePaths.forEach((path, index) => {
    if (path !== invoiceScanPath(ctx.storeId, input.sha256, index + 1, mediaTypes[0]!)) {
      badRequest(INVOICE_INVALID_PATH_MESSAGE);
    }
  });

  const pages = await Promise.all(
    input.storagePaths.map(async (path, index) => ({
      data: await deps.storage.download(path),
      mediaType: mediaTypes[index]!,
    })),
  );

  assertHash(input.sha256, sha256OfPages(pages.map((page) => page.data)));
  assertImages(pages);

  return { pages, pendingUploads: [], sha256: input.sha256, storagePath: input.storagePaths[0]! };
}

function limitReached(limit: number, used: number, pages: number): ApiError {
  const remaining = Math.max(0, limit - used);

  return new ApiError(
    429,
    "INVOICE_SCAN_LIMIT_REACHED",
    `Alcanzaste el límite de ${limit} páginas escaneadas por día. Esta factura tiene ${pages} y hoy quedan ${remaining}. Vuelve a intentarlo mañana o registra la compra a mano.`,
    { limit, used },
  );
}

/**
 * Hasta 3 escaneos confirmados del proveedor; una imagen que no se descarga, o
 * cuya ruta guardada no es de la tienda de la sesión, se omite.
 */
async function loadFewShot(
  deps: InvoiceScanDeps,
  ctx: InvoiceScanContext,
  supplierId: string | undefined,
): Promise<InvoiceFewShotExample[]> {
  if (!supplierId) {
    return [];
  }

  const examples = await deps.repo.listFewShotExamples(ctx, supplierId, MAX_FEW_SHOT_EXAMPLES);
  const loaded = await Promise.all(
    examples.map(async (example): Promise<InvoiceFewShotExample | null> => {
      const mediaType = mediaTypeOfPath(example.storagePath);

      if (!mediaType) {
        return null;
      }

      try {
        assertPathInStore(example.storagePath, ctx.storeId);
        const data = await deps.storage.download(example.storagePath);

        return { confirmed: example.confirmed, page: { data, mediaType } };
      } catch {
        return null;
      }
    }),
  );

  return loaded.filter((example): example is InvoiceFewShotExample => example !== null);
}

export type ScanInvoiceOptions = {
  /** `request.signal`: si el cliente corta, se cancela la llamada al modelo. */
  signal?: AbortSignal;
};

/**
 * `POST /api/purchases/invoice-scan`: valida los bytes → reserva atómica
 * (`reserveScan`, lock por tienda) → según el resultado:
 * - `cached`: la lectura guardada, sin modelo ni cuota;
 * - `in_progress`: 409, otra petición está leyendo la misma foto;
 * - `quota`: 429;
 * - `reserved` (páginas ya cobradas): subida → few-shot → extracción →
 *   emparejamiento → `extracted`. Un fallo deja la fila `failed` con el código
 *   (nunca el contenido); si es del modelo responde 502. Si falla la subida
 *   (antes de llamar al modelo) se devuelven las páginas cobradas; un corte del
 *   cliente durante la lectura queda como `CLIENT_ABORTED`.
 * Un escaneo `failed` o `discarded` se vuelve a leer y cobra otra vez.
 */
export async function scanInvoice(
  deps: InvoiceScanDeps,
  ctx: InvoiceScanContext,
  input: ScanInvoiceInput,
  options: ScanInvoiceOptions = {},
): Promise<InvoiceScanResponse> {
  const scan = await loadScan(deps, ctx, input);
  const pageCount = scan.pages.length;
  const model = deps.model();
  const reservation = await deps.repo.reserveScan(ctx, {
    imageSha256: scan.sha256,
    limit: deps.dailyLimit,
    model: model.modelId,
    pages: pageCount,
    provider: model.provider,
    storagePath: scan.storagePath,
  });

  if (reservation.outcome === "cached") {
    const cached = await deps.repo.getScan(ctx, reservation.id);

    if (!cached?.extracted || !cached.matched) {
      throw new ApiError(409, "CONFLICT", INVOICE_SCAN_CHANGED_MESSAGE);
    }

    return {
      cached: true,
      extraction: cached.extracted,
      limits: await deps.repo.getDailyUsage(ctx, deps.dailyLimit, deps.now()),
      matched: cached.matched,
      scanId: cached.id,
    };
  }

  if (reservation.outcome === "in_progress") {
    throw new ApiError(409, "CONFLICT", INVOICE_SCAN_IN_PROGRESS_MESSAGE);
  }

  if (reservation.outcome === "quota") {
    throw limitReached(reservation.limit, reservation.used, pageCount);
  }

  // Las páginas ya están cobradas: cualquier fallo cierra la reserva como failed,
  // y si el modelo aún no se llamó, las devuelve.
  const fail = (code: string, refundPages = false) => deps.repo.failScan(ctx, reservation.id, code, refundPages);
  let result: Awaited<ReturnType<typeof extractInvoice>>;
  let matched: InvoiceMatch;

  try {
    for (const upload of scan.pendingUploads) {
      await deps.storage.upload(upload.path, upload.page.data, upload.page.mediaType);
    }
  } catch (error) {
    await fail("UPLOAD_ERROR", true);
    throw error;
  }

  const fewShot = await loadFewShot(deps, ctx, input.supplierId);

  try {
    result = await deps.extract({ fewShot, model, pages: scan.pages, signal: options.signal });
  } catch (error) {
    await fail(
      options.signal?.aborted
        ? INVOICE_SCAN_CLIENT_ABORTED
        : error instanceof InvoiceExtractionError
          ? error.code
          : "PROVIDER_ERROR",
    );
    throw toInvoiceScanApiError(error);
  }

  try {
    matched = await deps.matcher(result.extraction, { dataSource: deps.dataSource, storeId: ctx.storeId });
  } catch (error) {
    await fail("MATCH_ERROR");
    throw error;
  }

  const row = await deps.repo.completeScan(ctx, reservation.id, {
    durationMs: result.durationMs,
    extracted: result.extraction,
    inputTokens: result.inputTokens,
    matched,
    outputTokens: result.outputTokens,
  });

  if (!row) {
    throw new ApiError(409, "CONFLICT", INVOICE_SCAN_CHANGED_MESSAGE);
  }

  return {
    cached: false,
    extraction: result.extraction,
    limits: await deps.repo.getDailyUsage(ctx, deps.dailyLimit, deps.now()),
    matched,
    scanId: row.id,
  };
}

export async function getInvoiceScanDetail(
  deps: InvoiceScanDeps,
  ctx: InvoiceScanContext,
  id: string,
): Promise<InvoiceScanDetail> {
  const row = (await deps.repo.getScan(ctx, id)) ?? notFound();
  // La ruta guardada se vuelve a validar antes de firmar con service role.
  assertPathInStore(row.storagePath, ctx.storeId);
  const imageUrls = await Promise.all(
    invoiceScanPagePaths(row.storagePath, row.pages).map((path) => deps.storage.signedReadUrl(path, INVOICE_READ_URL_TTL_SECONDS)),
  );

  return {
    createdAt: row.createdAt,
    extraction: row.extracted,
    imageUrls,
    matched: row.matched,
    pages: row.pages,
    scanId: row.id,
    status: row.status,
  };
}

/** 404 si no es de la tienda; 409 (del repositorio) si ya no está `extracted`. */
export async function discardInvoiceScan(
  deps: InvoiceScanDeps,
  ctx: InvoiceScanContext,
  id: string,
): Promise<DiscardedInvoiceScan> {
  const row = (await deps.repo.discardScan(ctx, id)) ?? notFound();

  return { scanId: row.id, status: row.status };
}

function createSupabaseInvoiceStorage(): InvoiceScanStorage {
  return {
    download: (path) => downloadInvoicePage(createAdminSupabaseClient(), path),
    signedReadUrl: (path, expiresInSeconds) =>
      createInvoiceSignedReadUrl(createAdminSupabaseClient(), path, expiresInSeconds),
    upload: (path, data, mediaType) => uploadInvoicePage(createAdminSupabaseClient(), path, data, mediaType),
  };
}

function mockObjects() {
  return mockState("invoice-scan:objects", () => new Map<string, Uint8Array>());
}

/** Storage en memoria del modo mock, con URLs de lectura falsas y deterministas. */
export const mockInvoiceStorage: InvoiceScanStorage = {
  async download(path) {
    const data = mockObjects().get(path);

    if (!data) {
      throw new ApiError(404, "NOT_FOUND", INVOICE_PAGE_NOT_FOUND_MESSAGE);
    }

    return data;
  },
  async signedReadUrl(path, expiresInSeconds) {
    return `https://mock-storage.local/storage/v1/object/sign/${INVOICE_SCANS_BUCKET}/${path}?token=mock-read-${expiresInSeconds}`;
  },
  async upload(path, data) {
    mockObjects().set(path, data);
  },
};

export function createInvoiceScanDeps(dataSource: ApiDataSource): InvoiceScanDeps {
  const supabase = dataSource === "supabase";

  return {
    dailyLimit: readInvoiceScanDailyLimit(),
    dataSource,
    extract: extractInvoice,
    matcher: matchScan,
    model: createInvoiceScanModel,
    now: () => new Date(),
    repo: supabase ? serverRepo : mockRepo,
    storage: supabase ? createSupabaseInvoiceStorage() : mockInvoiceStorage,
  };
}
