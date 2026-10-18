/**
 * Storage del escaneo de facturas (bucket privado `invoice-scans`, lo crea
 * SCN-03a). Todas las rutas viven bajo `<storeId>/<sha256>/p<n>.<ext>` y el
 * `storeId` siempre sale de la sesión del servidor.
 *
 * Los fallos de Storage se traducen a `ApiError` con mensaje en español sin el
 * detalle interno; nunca se registra el contenido de las facturas.
 */
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/apiError";

export {
  INVOICE_MAX_BYTES,
  INVOICE_MAX_PAGES,
  INVOICE_MAX_SIDE,
} from "../client/invoiceLimits";

export const INVOICE_SCANS_BUCKET = "invoice-scans";

export const invoiceScanMediaTypes = ["image/jpeg", "image/webp", "image/png"] as const;
export type InvoiceScanMediaType = (typeof invoiceScanMediaTypes)[number];

const EXTENSION_BY_MEDIA_TYPE: Record<InvoiceScanMediaType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const INVOICE_STORAGE_UNAVAILABLE_MESSAGE =
  "El almacenamiento de facturas no está disponible. Intenta de nuevo en unos minutos.";
export const INVOICE_PAGE_NOT_FOUND_MESSAGE = "No encontramos la página de la factura en Storage.";
export const INVOICE_INVALID_PATH_MESSAGE = "La ruta de la factura no es válida.";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STORE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const PAGE_FILE_PATTERN = /^p([1-9]\d?)\.(jpg|webp|png)$/;

type StorageClient = Pick<SupabaseClient, "storage">;

function invalidPath(): never {
  throw new ApiError(400, "BAD_REQUEST", INVOICE_INVALID_PATH_MESSAGE);
}

function storageUnavailable(): never {
  throw new ApiError(503, "INTERNAL_ERROR", INVOICE_STORAGE_UNAVAILABLE_MESSAGE);
}

/** `<storeId>/<sha256>/p<page>.<jpg|webp|png>`; valida cada segmento. */
export function invoiceScanPath(
  storeId: string,
  sha256: string,
  page: number,
  mediaType: InvoiceScanMediaType,
): string {
  if (
    !STORE_ID_PATTERN.test(storeId) ||
    !SHA256_PATTERN.test(sha256) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 99
  ) {
    invalidPath();
  }

  return `${storeId}/${sha256}/p${page}.${EXTENSION_BY_MEDIA_TYPE[mediaType]}`;
}

/**
 * Rechaza cualquier ruta que no tenga exactamente la forma de `invoiceScanPath`
 * bajo la tienda de la sesión: otro prefijo, `..`, barras dobles, segmentos de
 * más o nombres de archivo distintos de `p<n>.<ext>`.
 */
export function assertPathInStore(path: string, storeId: string): void {
  const segments = path.split("/");

  if (
    !STORE_ID_PATTERN.test(storeId) ||
    segments.length !== 3 ||
    segments[0] !== storeId ||
    !SHA256_PATTERN.test(segments[1] ?? "") ||
    !PAGE_FILE_PATTERN.test(segments[2] ?? "")
  ) {
    invalidPath();
  }
}

/** sha256 en hexadecimal (minúsculas), igual que `sha256Hex` del cliente. */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Hash del escaneo: sha256 de la concatenación de los bytes de las páginas en
 * orden. Coincide con `hashInvoicePages` del cliente para los mismos bytes.
 */
export function sha256OfPages(pages: readonly Uint8Array[]): string {
  const hash = createHash("sha256");

  for (const page of pages) {
    hash.update(page);
  }

  return hash.digest("hex");
}

export type InvoiceUploadUrl = {
  page: number;
  path: string;
  signedUrl: string;
  token: string;
};

export type InvoiceUploadRequestPage = { page: number; mediaType: InvoiceScanMediaType };

/** Página que ya está en el bucket: no se firma (no se puede reemplazar). */
export type InvoiceExistingUpload = { alreadyExists: true; page: number; path: string };

/**
 * Storage niega la firma de una ruta que ya existe sin upsert: StorageApiError
 * con `status` HTTP 400, `statusCode` "409" y `code` "KeyAlreadyExists".
 */
function isAlreadyExistsError(error: { status?: number; statusCode?: string; code?: string } | null) {
  return error?.statusCode === "409" || error?.status === 409 || error?.code === "KeyAlreadyExists";
}

/**
 * URLs firmadas de subida, una por página, bajo `<storeId>/<sha256>/`.
 *
 * Sin upsert (auditoría M3): con upsert cualquiera con `purchases.create`
 * podía pedir la URL del hash de un escaneo ajeno (el sha se ve en
 * `invoice_scans`) y reemplazar su imagen, incluso confirmada. El token lo emite
 * Storage con vida fija de 2 h: `createSignedUploadUrl` de
 * @supabase/storage-js 2.115 solo acepta `{ upsert }`, no una expiración. La
 * protección es por tanto `upsert: false`: un PUT sobre un objeto que ya
 * existe falla (409 "Duplicate"), sea el segundo PUT del mismo token o uno
 * sobre la página de otro escaneo. Para un reintento legítimo eso equivale a
 * "ya subido": el POST rehace el hash sobre los bytes guardados.
 *
 * Storage tampoco firma una ruta que ya existe (Duplicate 409): esa página se
 * devuelve como `{ alreadyExists: true }` sin URL en vez de 503, para que el
 * reintento tras un POST cortado o el reescaneo de un escaneo descartado con
 * el objeto aún en el bucket lleguen al POST (REP-03-F1).
 */
export async function createInvoiceUploadUrls(
  client: StorageClient,
  storeId: string,
  sha256: string,
  pages: readonly InvoiceUploadRequestPage[],
): Promise<Array<InvoiceUploadUrl | InvoiceExistingUpload>> {
  const bucket = client.storage.from(INVOICE_SCANS_BUCKET);

  return Promise.all(
    pages.map(async ({ mediaType, page }) => {
      const path = invoiceScanPath(storeId, sha256, page, mediaType);
      const result = await bucket
        .createSignedUploadUrl(path, { upsert: false })
        .catch(() => storageUnavailable());

      if (result.error && isAlreadyExistsError(result.error)) {
        return { alreadyExists: true as const, page, path };
      }

      if (result.error || !result.data?.signedUrl) {
        storageUnavailable();
      }

      return { page, path, signedUrl: result.data.signedUrl, token: result.data.token };
    }),
  );
}

/** URLs de subida falsas y deterministas para el modo mock (sin Storage). */
export function createMockInvoiceUploadUrls(
  storeId: string,
  sha256: string,
  pages: readonly InvoiceUploadRequestPage[],
): InvoiceUploadUrl[] {
  return pages.map(({ mediaType, page }) => {
    const path = invoiceScanPath(storeId, sha256, page, mediaType);
    const token = `mock-token-${sha256.slice(0, 12)}-p${page}`;
    return {
      page,
      path,
      signedUrl: `https://mock-upload.local/storage/v1/object/upload/sign/${INVOICE_SCANS_BUCKET}/${path}?token=${token}`,
      token,
    };
  });
}

export async function uploadInvoicePage(
  client: StorageClient,
  path: string,
  data: Uint8Array,
  mediaType: InvoiceScanMediaType,
): Promise<void> {
  const result = await client.storage
    .from(INVOICE_SCANS_BUCKET)
    .upload(path, data, { contentType: mediaType, upsert: true })
    .catch(() => storageUnavailable());

  if (result.error) {
    storageUnavailable();
  }
}

export async function downloadInvoicePage(client: StorageClient, path: string): Promise<Uint8Array> {
  const result = await Promise.resolve(client.storage.from(INVOICE_SCANS_BUCKET).download(path)).catch(
    () => storageUnavailable(),
  );

  if (result.error || !result.data) {
    throwIfObjectNotFound(result.error);
    storageUnavailable();
  }

  return new Uint8Array(await result.data.arrayBuffer());
}

/**
 * Objeto inexistente: Storage lo marca con 404 en `status` o en `statusCode`
 * (según versión) → 404. El llamador trata el resto como caída (503).
 */
function throwIfObjectNotFound(error: { status?: number; statusCode?: string } | null) {
  if (error?.status === 404 || error?.statusCode === "404") {
    throw new ApiError(404, "NOT_FOUND", INVOICE_PAGE_NOT_FOUND_MESSAGE);
  }
}

export async function createInvoiceSignedReadUrl(
  client: StorageClient,
  path: string,
  expiresInSeconds: number,
): Promise<string> {
  const result = await client.storage
    .from(INVOICE_SCANS_BUCKET)
    .createSignedUrl(path, expiresInSeconds)
    .catch(() => storageUnavailable());

  if (result.error || !result.data?.signedUrl) {
    throwIfObjectNotFound(result.error);
    storageUnavailable();
  }

  return result.data.signedUrl;
}

export async function removeInvoiceObjects(client: StorageClient, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const result = await client.storage
    .from(INVOICE_SCANS_BUCKET)
    .remove([...paths])
    .catch(() => storageUnavailable());

  if (result.error) {
    storageUnavailable();
  }
}
