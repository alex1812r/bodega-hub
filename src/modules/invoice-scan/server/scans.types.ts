/**
 * Tipos del repositorio de escaneos de factura (`public.invoice_scans`,
 * parche 20261015c; plan factura-escaneo-gtm §3 "Idempotencia y cuota",
 * "Trazabilidad" y §4). Los comparten `scans.server.ts` y `scans.mock-server.ts`.
 */
import type { InvoiceExtraction, InvoiceMatch } from "../contracts";

export const invoiceScanStatuses = ["extracted", "confirmed", "discarded", "failed"] as const;
export type InvoiceScanStatus = (typeof invoiceScanStatuses)[number];

/** Tienda y usuario de la sesión (los pone el BFF; nunca vienen del cliente). */
export type InvoiceScanContext = {
  storeId: string;
  userId: string;
};

export type InvoiceScanRow = {
  id: string;
  storeId: string;
  createdBy: string;
  imageSha256: string;
  /** `<store_id>/<archivo>` dentro del bucket privado `invoice-scans`. */
  storagePath: string;
  pages: number;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  /** null mientras no hay lectura (escaneo fallido: la columna guarda `{}`). */
  extracted: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
  /** Lectura confirmada por el usuario al crear la compra (verdad de la capa 2). */
  confirmed: InvoiceExtraction | null;
  purchaseId: string | null;
  /** Proveedor confirmado (capa 2); lo rellena Emparejamiento al confirmar. */
  supplierId: string | null;
  status: InvoiceScanStatus;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

/**
 * Alta de un escaneo. `status: "failed"` (con `error`) registra un intento que
 * no produjo lectura: cuenta para la cuota pero no es caché.
 */
export type InvoiceScanInsert = {
  imageSha256: string;
  storagePath: string;
  pages?: number;
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  extracted?: InvoiceExtraction | null;
  matched?: InvoiceMatch | null;
  status?: Extract<InvoiceScanStatus, "extracted" | "failed">;
  error?: string | null;
};

/** Ejemplo few-shot de la capa 2: imagen guardada + lectura confirmada. */
export type InvoiceFewShotExample = {
  scanId: string;
  storagePath: string;
  confirmed: InvoiceExtraction;
};

export type PurgeExpiredScansResult = {
  deletedIds: string[];
  /** Rutas en el bucket `invoice-scans`; las borra el llamador (cron). */
  storagePaths: string[];
};

export const DEFAULT_INVOICE_SCAN_DAILY_LIMIT = 50;
export const DISCARD_NOT_ALLOWED_MESSAGE =
  "Solo se puede descartar un escaneo que aún no se ha confirmado.";
export const MAX_FEW_SHOT_EXAMPLES = 3;
export const INVOICE_SCAN_RETENTION_DAYS = 90;

/** Páginas por tienda y día operativo de Caracas (`INVOICE_SCAN_DAILY_LIMIT`, por defecto 50). */
export function readInvoiceScanDailyLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.INVOICE_SCAN_DAILY_LIMIT?.trim();

  if (!raw || !/^\d+$/.test(raw)) {
    return DEFAULT_INVOICE_SCAN_DAILY_LIMIT;
  }

  return Number(raw);
}
