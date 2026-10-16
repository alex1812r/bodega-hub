/**
 * Repositorio de escaneos de factura para el modo mock del BFF: en memoria y
 * por tienda, con la misma semántica que `scans.server.ts` (unique tienda +
 * hash, reserva atómica como `reserve_invoice_scan` con la ruta ligada a la
 * tienda y páginas/límite acotados, cierre/fallo/descarte como las RPCs de
 * 20261019g/i con el intento vigente, tope de 512 KB de la lectura, cuota por
 * día de Caracas sobre `usagePages`, few-shot ≤ 3, 404 entre tiendas, purga a
 * 90 días de filas y de objetos sin escaneo vivo).
 */
import { ApiError } from "@/lib/api/apiError";
import { INVALID_DATA_MESSAGE } from "@/lib/supabase/errors";
import { mockState } from "@/shared/mocks/mockStore";
import { getCaracasIsoDate, toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import type { InvoiceScanLimits } from "../contracts";
import {
  DISCARD_CLAIMED_MESSAGE,
  DISCARD_NOT_ALLOWED_MESSAGES,
  type ExpiredScan,
  INVALID_SCAN_DATA_MESSAGE,
  INVOICE_SCAN_PAYLOAD_MAX_BYTES,
  INVOICE_SCAN_STALE_ATTEMPT_MESSAGE,
  invoiceScanPagePaths,
  invoiceScanProcessingWindowMs,
  isReserveInputInRange,
  isScanStoragePathInScope,
  MAX_FEW_SHOT_EXAMPLES,
  parseConfirmedScan,
  type StoredFewShotExample,
  type InvoiceScanCompletion,
  type InvoiceScanContext,
  type InvoiceScanInsert,
  type InvoiceScanReservation,
  type InvoiceScanReserveInput,
  type InvoiceScanRow,
} from "./scans.types";

function scans() {
  return mockState("invoice-scan:scans", () => new Map<string, InvoiceScanRow>());
}

/** Columna `attempt_id` por id de escaneo: cada reserva la renueva (20261019i). */
function attempts() {
  return mockState("invoice-scan:attempts", () => new Map<string, string>());
}

function byNewest(a: InvoiceScanRow, b: InvoiceScanRow) {
  return b.createdAt.localeCompare(a.createdAt);
}

function selectByHash(ctx: InvoiceScanContext, sha256: string) {
  return (
    [...scans().values()].find(
      (scan) => scan.storeId === ctx.storeId && scan.imageSha256 === sha256,
    ) ?? null
  );
}

function ownScan(ctx: InvoiceScanContext, id: string) {
  const scan = scans().get(id);

  return scan && scan.storeId === ctx.storeId ? scan : null;
}

function save(scan: InvoiceScanRow) {
  scans().set(scan.id, scan);

  return { ...scan };
}

function usedToday(ctx: InvoiceScanContext, now: Date) {
  const today = getCaracasIsoDate(now);

  return [...scans().values()]
    .filter((scan) => scan.storeId === ctx.storeId && toCaracasDateKey(scan.createdAt) === today)
    .reduce((sum, scan) => sum + scan.usagePages, 0);
}

/**
 * Paridad con `reserve_invoice_scan` (20261019e, g e i). El cuerpo es
 * síncrono (sin `await`): en un solo hilo equivale al lock por tienda de la RPC.
 */
export async function reserveScan(
  ctx: InvoiceScanContext,
  input: InvoiceScanReserveInput,
): Promise<InvoiceScanReservation> {
  if (
    !isReserveInputInRange(input.pages, input.limit) ||
    !isScanStoragePathInScope(ctx.storeId, input.imageSha256, input.storagePath)
  ) {
    throw new ApiError(400, "BAD_REQUEST", INVALID_SCAN_DATA_MESSAGE);
  }

  const now = new Date();
  const existing = selectByHash(ctx, input.imageSha256);

  if (existing && (existing.status === "extracted" || existing.status === "confirmed")) {
    return { id: existing.id, outcome: "cached" };
  }

  if (
    existing?.status === "processing" &&
    new Date(existing.createdAt).getTime() > now.getTime() - invoiceScanProcessingWindowMs(existing.pages)
  ) {
    return { id: existing.id, outcome: "in_progress" };
  }

  const used = usedToday(ctx, now);

  if (used + input.pages > input.limit) {
    return { limit: input.limit, outcome: "quota", used };
  }

  const sameDay = existing !== null && toCaracasDateKey(existing.createdAt) === getCaracasIsoDate(now);
  const row = save({
    confirmed: existing?.confirmed ?? null,
    confirmedAt: existing?.confirmedAt ?? null,
    createdAt: now.toISOString(),
    createdBy: ctx.userId,
    durationMs: null,
    error: null,
    extracted: null,
    id: existing?.id ?? crypto.randomUUID(),
    imageSha256: input.imageSha256,
    inputTokens: null,
    matched: null,
    model: input.model,
    outputTokens: null,
    pages: input.pages,
    provider: input.provider,
    purchaseId: existing?.purchaseId ?? null,
    status: "processing",
    storagePath: input.storagePath,
    storeId: ctx.storeId,
    supplierId: existing?.supplierId ?? null,
    usagePages: sameDay && existing ? existing.usagePages + input.pages : input.pages,
  });
  const attemptId = crypto.randomUUID();
  attempts().set(row.id, attemptId);

  return { attemptId, id: row.id, limit: input.limit, outcome: "reserved", used: used + input.pages };
}

/**
 * Como `complete_invoice_scan` / `fail_invoice_scan` (20261019i): null si la
 * fila no es de la tienda; 409 si no está `processing`, el intento no es el
 * vigente o la reservó otro usuario.
 */
function liveAttempt(ctx: InvoiceScanContext, id: string, attemptId: string) {
  const scan = ownScan(ctx, id);

  if (!scan) {
    return null;
  }

  if (scan.status !== "processing" || attempts().get(id) !== attemptId || scan.createdBy !== ctx.userId) {
    throw new ApiError(409, "CONFLICT", INVOICE_SCAN_STALE_ATTEMPT_MESSAGE);
  }

  return scan;
}

/**
 * Check `invoice_scans_payload_size` (23514 → 400). Aproximación: mide
 * `JSON.stringify`, algo más compacto que el `jsonb::text` de Postgres.
 */
function exceedsPayloadLimit(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length > INVOICE_SCAN_PAYLOAD_MAX_BYTES;
}

export async function completeScan(
  ctx: InvoiceScanContext,
  id: string,
  attemptId: string,
  completion: InvoiceScanCompletion,
): Promise<InvoiceScanRow | null> {
  const scan = liveAttempt(ctx, id, attemptId);

  if (!scan) {
    return null;
  }

  if (exceedsPayloadLimit(completion.extracted) || exceedsPayloadLimit(completion.matched)) {
    throw new ApiError(400, "BAD_REQUEST", INVALID_DATA_MESSAGE);
  }

  return save({ ...scan, ...completion, error: null, status: "extracted" });
}

export async function failScan(
  ctx: InvoiceScanContext,
  id: string,
  attemptId: string,
  errorCode: string,
  refundPages = false,
): Promise<void> {
  const scan = liveAttempt(ctx, id, attemptId);

  if (scan) {
    save({
      ...scan,
      error: errorCode,
      extracted: null,
      matched: null,
      status: "failed",
      usagePages: refundPages ? Math.max(0, scan.usagePages - scan.pages) : scan.usagePages,
    });
  }
}

/**
 * SOLO TESTS: siembra una fila directamente (estado y lectura a elección) para
 * fixtures de la purga y de este repositorio. Ningún código de producción debe
 * llamarla; el BFF crea filas con `reserveScan` + `completeScan` / `failScan`.
 */
export async function seedScanForTest(
  ctx: InvoiceScanContext,
  input: InvoiceScanInsert,
): Promise<InvoiceScanRow> {
  const existing = selectByHash(ctx, input.imageSha256);

  if (existing && existing.status !== "failed") {
    return { ...existing };
  }

  return save({
    confirmed: null,
    confirmedAt: null,
    createdAt: new Date().toISOString(),
    createdBy: ctx.userId,
    durationMs: input.durationMs ?? null,
    error: input.error ?? null,
    extracted: input.extracted ?? null,
    id: existing?.id ?? crypto.randomUUID(),
    imageSha256: input.imageSha256,
    inputTokens: input.inputTokens ?? null,
    matched: input.matched ?? null,
    model: input.model,
    outputTokens: input.outputTokens ?? null,
    pages: input.pages ?? 1,
    provider: input.provider,
    purchaseId: null,
    status: input.status ?? "extracted",
    storagePath: input.storagePath,
    storeId: ctx.storeId,
    supplierId: null,
    usagePages: input.pages ?? 1,
  });
}

/** Escaneos de la tienda, del más nuevo al más viejo (duplicados del emparejamiento mock). */
export function listMockScansOfStore(storeId: string): InvoiceScanRow[] {
  return [...scans().values()]
    .filter((scan) => scan.storeId === storeId)
    .sort(byNewest)
    .map((scan) => ({ ...scan }));
}

export async function getScan(ctx: InvoiceScanContext, id: string): Promise<InvoiceScanRow | null> {
  const scan = ownScan(ctx, id);

  return scan ? { ...scan } : null;
}

export async function discardScan(
  ctx: InvoiceScanContext,
  id: string,
): Promise<InvoiceScanRow | null> {
  const scan = ownScan(ctx, id);

  if (!scan) {
    return null;
  }

  if (scan.status !== "extracted") {
    throw new ApiError(409, "CONFLICT", DISCARD_NOT_ALLOWED_MESSAGES[scan.status]);
  }

  // Guarda de 20261019k. El mock no tiene las columnas de reclamo de 19b.
  if (scan.purchaseId !== null || scan.confirmed !== null) {
    throw new ApiError(409, "CONFLICT", DISCARD_CLAIMED_MESSAGE);
  }

  return save({ ...scan, status: "discarded" });
}

/**
 * Páginas cobradas hoy (día de Caracas). Misma limitación que `scans.server.ts`
 * (caos-2 N9): reutilizar una fila de otro día la pasa a hoy y el consumo de
 * aquel día pierde esas páginas.
 */
export async function getDailyUsage(
  ctx: InvoiceScanContext,
  limit: number,
  now: Date = new Date(),
): Promise<InvoiceScanLimits> {
  const used = usedToday(ctx, now);

  return { limit, remaining: Math.max(0, limit - used), used };
}

export async function listFewShotExamples(
  ctx: InvoiceScanContext,
  supplierId: string,
  max: number = MAX_FEW_SHOT_EXAMPLES,
): Promise<StoredFewShotExample[]> {
  const count = Math.min(Math.max(Math.trunc(max), 0), MAX_FEW_SHOT_EXAMPLES);

  return [...scans().values()]
    .filter((scan) => scan.storeId === ctx.storeId && scan.supplierId === supplierId && scan.confirmed !== null)
    .sort(byNewest)
    .slice(0, count)
    .flatMap((scan) => {
      const confirmed = parseConfirmedScan(scan.confirmed);

      return confirmed ? [{ extraction: confirmed.extraction, scanId: scan.id, storagePath: scan.storagePath }] : [];
    });
}

/** El mock no usa cliente: el primer argumento existe por paridad con `scans.server.ts`. */
export async function listExpiredScans(
  _adminClient: unknown,
  olderThanDays: number,
  now: Date,
  limit: number,
): Promise<ExpiredScan[]> {
  const cutoff = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;

  return [...scans().values()]
    .filter((scan) => new Date(scan.createdAt).getTime() < cutoff)
    .sort((a, b) => byNewest(b, a))
    .slice(0, limit)
    .map((scan) => ({ id: scan.id, storagePaths: invoiceScanPagePaths(scan.storagePath, scan.pages) }));
}

export async function deleteScansByIds(_adminClient: unknown, ids: readonly string[]): Promise<number> {
  return ids.filter((id) => scans().delete(id)).length;
}

/** Fecha de subida de cada objeto del bucket (equivale a `storage.objects.created_at`). */
function objectDates() {
  return mockState("invoice-scan:object-dates", () => new Map<string, string>());
}

/**
 * SOLO TESTS: registra un objeto del bucket en memoria con su fecha de subida
 * para fixtures de la purga. Ningún código de producción debe llamarla.
 */
export function seedScanObjectForTest(path: string, createdAt: string = new Date().toISOString()): void {
  objectDates().set(path, createdAt);
}

/**
 * Paridad con `list_expired_invoice_scan_objects` (20261019c): objetos subidos
 * antes del corte que no están en la carpeta `<store>/<sha>/` de un escaneo vivo
 * (creado en o después del corte), los más antiguos primero.
 */
export async function listExpiredScanObjects(
  _adminClient: unknown,
  olderThanDays: number,
  now: Date,
  limit: number,
): Promise<string[]> {
  const cutoff = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  const liveFolders = new Set(
    [...scans().values()]
      .filter((scan) => new Date(scan.createdAt).getTime() >= cutoff)
      .map((scan) => `${scan.storeId}/${scan.imageSha256}`),
  );

  return [...objectDates().entries()]
    .filter(([path, createdAt]) => {
      const [storeId, sha256] = path.split("/");
      return new Date(createdAt).getTime() < cutoff && !liveFolders.has(`${storeId}/${sha256}`);
    })
    .sort(([, a], [, b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([path]) => path);
}

/** Paridad con `removeInvoiceObjects`: borra los objetos indicados del bucket en memoria. */
export async function removeScanObjects(_adminClient: unknown, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    objectDates().delete(path);
  }
}
