/**
 * Tipos del repositorio de escaneos de factura (`public.invoice_scans`,
 * parche 20261019a; plan factura-escaneo-gtm §3 "Idempotencia y cuota",
 * "Trazabilidad" y §4). Los comparten `scans.server.ts` y `scans.mock-server.ts`.
 */
import { z } from "zod";

import { INVOICE_MAX_PAGES } from "../client/invoiceLimits";
import { invoiceExtractionSchema, type InvoiceExtraction, type InvoiceMatch } from "../contracts";

/** `processing`: reservado por `reserveScan` mientras el modelo lee (parche 20261019e). */
export const invoiceScanStatuses = ["processing", "extracted", "confirmed", "discarded", "failed"] as const;
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
  /** Páginas cobradas hoy por la fila: cada intento suma (cuota, parche 20261019e). */
  usagePages: number;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  /** null mientras no hay lectura (escaneo fallido: la columna guarda `{}`). */
  extracted: InvoiceExtraction | null;
  matched: InvoiceMatch | null;
  /**
   * Confirmación del usuario al crear la compra (verdad de la capa 2), null si
   * no hay. `unknown` a propósito: la escribe Emparejamiento y hay filas con la
   * forma vieja (InvoiceExtraction suelta); quien la lea valida con
   * `parseConfirmedScan` (D10).
   */
  confirmed: unknown;
  purchaseId: string | null;
  /** Proveedor confirmado (capa 2); lo rellena Emparejamiento al confirmar. */
  supplierId: string | null;
  status: InvoiceScanStatus;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
};

/**
 * Alta directa de un escaneo en el repositorio mock (fixtures de tests). El BFF
 * no la usa: reserva con `reserveScan` y cierra con `completeScan`/`failScan`.
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

/**
 * Una fila `processing` más reciente que esto bloquea otra lectura de la misma
 * foto: 50 s por página + 60 s, porque las páginas se leen en serie con hasta
 * 45 s cada una (`reserve_invoice_scan`, parche 20261019g).
 */
export function invoiceScanProcessingWindowMs(pages: number): number {
  return (50 * pages + 60) * 1000;
}

/**
 * Regla de `invoice_scans_storage_path_scope` (parche 20261019g): la ruta de la
 * página 1 es exactamente `<store_id>/<sha256>/p1.<jpg|png|webp>`.
 */
export function isScanStoragePathInScope(storeId: string, imageSha256: string, storagePath: string): boolean {
  return ["jpg", "png", "webp"].some((extension) => storagePath === `${storeId}/${imageSha256}/p1.${extension}`);
}

/** Mensaje 22023 de `reserve_invoice_scan` y demás RPCs del escaneo. */
export const INVALID_SCAN_DATA_MESSAGE = "Datos de escaneo no válidos.";

/**
 * Topes que `reserve_invoice_scan` exige a `p_limit` (0..10000) y a `p_pages`
 * (1..INVOICE_MAX_PAGES); fuera de ellos responde 22023 (parche 20261019i, caos-3 C3).
 */
export const INVOICE_SCAN_MAX_DAILY_LIMIT = 10_000;

export function isReserveInputInRange(pages: number, limit: number): boolean {
  return (
    Number.isInteger(pages) &&
    pages >= 1 &&
    pages <= INVOICE_MAX_PAGES &&
    Number.isInteger(limit) &&
    limit >= 0 &&
    limit <= INVOICE_SCAN_MAX_DAILY_LIMIT
  );
}

/**
 * Tope de `extracted` y de `matched` (check `invoice_scans_payload_size`,
 * 20261019i, caos-3 C7): `octet_length(<columna>::text)` ≤ 512 KB.
 */
export const INVOICE_SCAN_PAYLOAD_MAX_BYTES = 512 * 1024;

/**
 * PT409 de `complete_invoice_scan` y `fail_invoice_scan` (20261019i) cuando el
 * intento no es el vigente de la fila: otra reserva la tomó, ya se cerró o la
 * reservó otro usuario.
 */
export const INVOICE_SCAN_STALE_ATTEMPT_MESSAGE = "Esta lectura ya no está vigente.";

/** Entrada de `reserveScan` (RPC `reserve_invoice_scan`, parche 20261019e). */
export type InvoiceScanReserveInput = {
  imageSha256: string;
  storagePath: string;
  pages: number;
  limit: number;
  provider: string;
  model: string;
};

/**
 * Resultado de la reserva atómica (lock por tienda):
 * - `cached`: la foto ya tiene lectura (extracted o confirmed); no se llama al modelo;
 * - `in_progress`: otra petición la está leyendo (processing dentro de la ventana por páginas);
 * - `quota`: las páginas no caben en la cuota de hoy;
 * - `reserved`: fila en `processing` y páginas cobradas; `used` ya las incluye.
 *   `attemptId` (columna `attempt_id`, nueva en cada reserva) es lo que piden
 *   `completeScan` y `failScan` para cerrar este intento y no otro (20261019i).
 */
export type InvoiceScanReservation =
  | { outcome: "cached"; id: string }
  | { outcome: "in_progress"; id: string }
  | { outcome: "quota"; used: number; limit: number }
  | { outcome: "reserved"; id: string; attemptId: string; used: number; limit: number };

/**
 * Lectura que cierra una reserva (`processing` → `extracted`). Proveedor y
 * modelo ya quedaron en la fila al reservar.
 */
export type InvoiceScanCompletion = {
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  extracted: InvoiceExtraction;
  /**
   * null si el emparejamiento falló después de leer (D35): la columna guarda
   * `{}` y el reintento de la misma foto re-empareja la lectura desde el caché.
   */
  matched: InvoiceMatch | null;
};

/**
 * Forma de `invoice_scans.confirmed` (D10): la lectura corregida por el usuario
 * y el producto elegido por línea. La raíz admite claves nuevas de Emparejamiento.
 */
export const confirmedScanSchema = z
  .object({
    extraction: invoiceExtractionSchema,
    lines: z.array(
      z.object({
        lineIndex: z.number().int().nonnegative(),
        productId: z.string(),
        packLabel: z.string().optional(),
        unitsPerPack: z.number().int().positive().optional(),
      }),
    ),
  })
  .loose();
export type ConfirmedScan = z.infer<typeof confirmedScanSchema>;

export const INVALID_CONFIRMED_SCAN = "INVALID_CONFIRMED_SCAN";

/**
 * Valida `confirmed` en el borde. Una fila fuera del contrato (forma vieja,
 * JSON roto) devuelve null y registra solo el código, nunca su contenido.
 */
export function parseConfirmedScan(value: unknown): ConfirmedScan | null {
  const parsed = confirmedScanSchema.safeParse(value);

  if (!parsed.success) {
    console.warn("[invoice-scan] confirmed fuera del contrato", { code: INVALID_CONFIRMED_SCAN });
    return null;
  }

  return parsed.data;
}

/** Ejemplo few-shot de la capa 2: imagen guardada + `confirmed.extraction` ya validado. */
export type StoredFewShotExample = {
  scanId: string;
  storagePath: string;
  extraction: InvoiceExtraction;
};

/** Escaneo vencido que la purga (cron) debe borrar: primero Storage, luego la fila. */
/**
 * Estados con objetos ya subidos y en uso: `upload-url` no firma una subida
 * sobre el hash de un escaneo así (auditoría M3).
 */
export const LIVE_INVOICE_SCAN_STATUSES = ["processing", "extracted", "confirmed"] as const;

/** Escaneo vivo de la tienda con un hash y las rutas de todas sus páginas. */
export type LiveInvoiceScan = {
  id: string;
  status: (typeof LIVE_INVOICE_SCAN_STATUSES)[number];
  storagePaths: string[];
};

export type ExpiredScan = {
  id: string;
  /** Rutas de todas las páginas en el bucket `invoice-scans`. */
  storagePaths: string[];
};

const FIRST_PAGE_PATH = /^(.+\/)p1\.(jpg|png|webp)$/;

/**
 * Rutas de las `pages` páginas a partir de la página 1 (`<store>/<sha>/p1.<ext>`):
 * todas comparten carpeta y formato (SCN-03b). Una ruta antigua que no sigue el
 * patrón se devuelve tal cual.
 */
export function invoiceScanPagePaths(storagePath: string, pages: number): string[] {
  const match = storagePath.match(FIRST_PAGE_PATH);

  if (!match) {
    return [storagePath];
  }

  return Array.from({ length: pages }, (_, index) => `${match[1]}p${index + 1}.${match[2]}`);
}

export const DEFAULT_INVOICE_SCAN_DAILY_LIMIT = 50;
/** 409 al descartar fuera de `extracted`, por estado (PT409 de `discard_invoice_scan`, 20261019g). */
export const DISCARD_NOT_ALLOWED_MESSAGES: Record<Exclude<InvoiceScanStatus, "extracted">, string> = {
  confirmed: "Este escaneo ya se confirmó en una compra y no se puede descartar.",
  discarded: "Este escaneo ya estaba descartado.",
  failed: "La lectura de este escaneo falló y no hay nada que descartar. Vuelve a escanear la factura.",
  processing: "Este escaneo todavía se está leyendo; espera a que termine para descartarlo.",
};
/** 409 al descartar un `extracted` que Emparejamiento está confirmando (PT409 de `discard_invoice_scan`, 20261019k). */
export const DISCARD_CLAIMED_MESSAGE = "Esta factura se está confirmando en una compra; espera a que termine.";
export const MAX_FEW_SHOT_EXAMPLES = 3;
export const INVOICE_SCAN_RETENTION_DAYS = 90;

/**
 * Páginas por tienda y día operativo de Caracas (`INVOICE_SCAN_DAILY_LIMIT`,
 * por defecto 50), como mucho `INVOICE_SCAN_MAX_DAILY_LIMIT`: más arriba la
 * RPC rechazaría todas las reservas.
 */
export function readInvoiceScanDailyLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.INVOICE_SCAN_DAILY_LIMIT?.trim();

  if (!raw || !/^\d+$/.test(raw)) {
    return DEFAULT_INVOICE_SCAN_DAILY_LIMIT;
  }

  return Math.min(Number(raw), INVOICE_SCAN_MAX_DAILY_LIMIT);
}
