/**
 * Repositorio de escaneos de factura para el modo mock del BFF: en memoria y
 * por tienda, con la misma semántica que `scans.server.ts` (unique tienda +
 * hash, `failed` no es caché y se reutiliza, cuota por día de Caracas,
 * few-shot ≤ 3, 404 entre tiendas, purga a 90 días).
 */
import { ApiError } from "@/lib/api/apiError";
import { mockState } from "@/shared/mocks/mockStore";
import { getCaracasIsoDate, toCaracasDateKey } from "@/shared/utils/caracasBusinessDay";

import type { InvoiceExtraction, InvoiceScanLimits } from "../contracts";
import {
  DISCARD_NOT_ALLOWED_MESSAGE,
  type ExpiredScan,
  INVOICE_SCAN_RETENTION_DAYS,
  invoiceScanPagePaths,
  MAX_FEW_SHOT_EXAMPLES,
  type StoredFewShotExample,
  type InvoiceScanContext,
  type InvoiceScanInsert,
  type InvoiceScanRow,
} from "./scans.types";

function scans() {
  return mockState("invoice-scan:scans", () => new Map<string, InvoiceScanRow>());
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

export async function findScanByHash(
  ctx: InvoiceScanContext,
  sha256: string,
): Promise<InvoiceScanRow | null> {
  const scan = selectByHash(ctx, sha256);

  return scan && scan.status !== "failed" ? { ...scan } : null;
}

export async function insertScan(
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
  });
}

export async function markScanFailed(
  ctx: InvoiceScanContext,
  id: string,
  errorMessage: string,
): Promise<InvoiceScanRow | null> {
  const scan = ownScan(ctx, id);

  if (!scan || scan.status !== "extracted") {
    return null;
  }

  return save({ ...scan, error: errorMessage, status: "failed" });
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
    throw new ApiError(409, "CONFLICT", DISCARD_NOT_ALLOWED_MESSAGE);
  }

  return save({ ...scan, status: "discarded" });
}

export async function getDailyUsage(
  ctx: InvoiceScanContext,
  limit: number,
  now: Date = new Date(),
): Promise<InvoiceScanLimits> {
  const today = getCaracasIsoDate(now);
  const used = [...scans().values()]
    .filter((scan) => scan.storeId === ctx.storeId && toCaracasDateKey(scan.createdAt) === today)
    .reduce((sum, scan) => sum + scan.pages, 0);

  return { limit, remaining: Math.max(0, limit - used), used };
}

export async function listFewShotExamples(
  ctx: InvoiceScanContext,
  supplierId: string,
  max: number = MAX_FEW_SHOT_EXAMPLES,
): Promise<StoredFewShotExample[]> {
  const count = Math.min(Math.max(Math.trunc(max), 0), MAX_FEW_SHOT_EXAMPLES);

  return [...scans().values()]
    .filter(
      (scan): scan is InvoiceScanRow & { confirmed: InvoiceExtraction } =>
        scan.storeId === ctx.storeId && scan.supplierId === supplierId && scan.confirmed !== null,
    )
    .sort(byNewest)
    .slice(0, count)
    .map((scan) => ({ confirmed: scan.confirmed, scanId: scan.id, storagePath: scan.storagePath }));
}

/** El mock no usa cliente: el primer argumento existe por paridad con `scans.server.ts`. */
export async function listExpiredScans(
  _adminClient: unknown,
  olderThanDays: number = INVOICE_SCAN_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<ExpiredScan[]> {
  const cutoff = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;

  return [...scans().values()]
    .filter((scan) => new Date(scan.createdAt).getTime() < cutoff)
    .map((scan) => ({ id: scan.id, storagePaths: invoiceScanPagePaths(scan.storagePath, scan.pages) }));
}

export async function deleteScansByIds(_adminClient: unknown, ids: readonly string[]): Promise<number> {
  return ids.filter((id) => scans().delete(id)).length;
}
