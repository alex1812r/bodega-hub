/**
 * SCN-06 · Mock con paridad de `confirmScan.server.ts` (escaneo dentro de
 * `POST /api/purchases`). Mismas reglas que las RPC `confirm_invoice_scan` y
 * `learn_invoice_aliases` (20261019b):
 * - escaneo ajeno o inexistente → 400; confirmado con otra compra → 400;
 *   descartado/fallido → 400; replay con el mismo `clientRequestId` → pasa y no
 *   vuelve a aprender;
 * - reclamo por intento (`claim_invoice_scan`, SCN-06-F1): `precheckInvoiceScan`
 *   reclama el escaneo; otro intento con reclamo vigente (5 min) → 400 sin crear;
 *   `releaseInvoiceScanClaim` lo suelta; `finalizeInvoiceScan` solo confirma con
 *   el reclamo de su clave;
 * - aprendizaje por (tienda, proveedor, alias): mismo producto → `hits + 1`,
 *   producto distinto → reasigna el mismo registro con `hits = 1` (caos 6.10);
 *   dentro de una confirmación gana la última línea de cada alias.
 *
 * Diferencias asumidas: el replay se reconoce por la `clientRequestId` con la que
 * se confirmó el escaneo (en la base, por `purchases.client_request_id`; mismo
 * significado) y no se comprueba que `productId` sea un producto de la tienda
 * (la RPC ignora los ajenos). M1 (SCN-06-F2): el mock rechaza la compra ya
 * ligada a otro escaneo; no guarda `client_request_id` por compra, pero sí
 * rechaza (SCN-06-F3) una compra creada antes del reclamo (la clave ya había
 * creado una compra vieja sin escaneo).
 *
 * Almacén (SCN-13a): las filas son las de `scans.mock-server.ts`, el mismo almacén
 * donde `POST /api/purchases/invoice-scan` guarda el escaneo en modo mock (con su
 * caché por hash y su descarte), así que una compra mock confirma el escaneo que
 * acaba de leer. Las columnas del reclamo viven al lado (`mockScanClaim`).
 * `registerMockInvoiceScan` solo siembra filas para tests.
 */
import { findMockPurchase } from "@/modules/purchases/services/purchaseMockStore";
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { ApiError } from "@/lib/api/apiError";

import {
  assertScanUsable,
  buildConfirmedPayload,
  buildLearnLines,
  INVOICE_SCAN_CLAIM_CLOCK_SKEW_MS,
  INVOICE_SCAN_CLAIM_TTL_MS,
  INVOICE_SCAN_CLAIMED_MESSAGE,
  INVOICE_SCAN_KEY_REUSED_MESSAGE,
  readExtractedRawTexts,
  readStoredExtraction,
  type ConfirmedInvoiceScan,
  type FinalizeInvoiceScanInput,
  type InvoiceScanClaimInput,
  type InvoiceScanOutcome,
  type InvoiceScanStatus,
  type PrecheckedInvoiceScan,
} from "./confirmScan.server";
import {
  findMockScanRow,
  listMockScansOfStore,
  mockScanClaim,
  putMockScanRow,
  resetMockScanStore,
} from "./scans.mock-server";
import type { InvoiceScanRow, InvoiceScanStatus as InvoiceScanRowStatus } from "./scans.types";

/** Vista de una fila del almacén compartido con las columnas de su reclamo. */
export type MockInvoiceScan = {
  /** Intento que tiene el reclamo (`claim_request_id`). */
  claimRequestId: string | null;
  /** Momento del último reclamo en ms (`claimed_at`): mide la caducidad. */
  claimedAt: number | null;
  /** Primer reclamo de la clave vigente en ms (`claim_started_at`, SCN-06-F3 / INT-01). */
  claimStartedAt: number | null;
  /** Clave de idempotencia de la compra con la que se confirmó (replay). */
  confirmedClientRequestId: string | null;
  confirmed: ConfirmedInvoiceScan | null;
  extracted: unknown;
  id: string;
  purchaseId: string | null;
  status: InvoiceScanRowStatus;
  storeId: string;
};

export type MockLearnedAlias = {
  aliasNorm: string;
  hits: number;
  packLabel: string | null;
  productId: string;
  storeId: string;
  supplierId: string;
  unitsPerPack: number | null;
};

function aliases() {
  return mockState("invoice-scan:confirm:aliases", () => new Map<string, MockLearnedAlias>());
}

function aliasKey(storeId: string, supplierId: string, aliasNorm: string) {
  return `${storeId}:${supplierId}:${aliasNorm}`;
}

/** Fila del almacén compartido (copia) si es de la tienda. */
function ownRow(id: string, storeId: string) {
  const row = findMockScanRow(id);

  return row && row.storeId === storeId ? row : null;
}

function clearClaim(id: string) {
  const claim = mockScanClaim(id);
  claim.claimRequestId = null;
  claim.claimedAt = null;
  claim.claimStartedAt = null;
}

function toView(id: string): MockInvoiceScan | undefined {
  const row = findMockScanRow(id);

  if (!row) {
    return undefined;
  }

  const claim = mockScanClaim(id);

  return {
    claimRequestId: claim.claimRequestId,
    claimStartedAt: claim.claimStartedAt,
    claimedAt: claim.claimedAt,
    confirmed: (row.confirmed ?? null) as ConfirmedInvoiceScan | null,
    confirmedClientRequestId: claim.confirmedClientRequestId,
    extracted: row.extracted,
    id: row.id,
    purchaseId: row.purchaseId,
    status: row.status,
    storeId: row.storeId,
  };
}

/**
 * SOLO TESTS: siembra (o reemplaza) un escaneo en el almacén compartido sin pasar
 * por la extracción. El BFF crea las filas con `reserveScan` + `completeScan`.
 */
export function registerMockInvoiceScan(scan: {
  extracted: unknown;
  id?: string;
  purchaseId?: string | null;
  status?: InvoiceScanStatus;
  storeId?: string;
}): MockInvoiceScan {
  const id = scan.id ?? crypto.randomUUID();
  const storeId = scan.storeId ?? DEFAULT_STORE_ID;
  // Hash único: la fila sembrada no choca con el caché de una foto real.
  const sha256 = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");

  putMockScanRow({
    confirmed: null,
    confirmedAt: null,
    createdAt: new Date().toISOString(),
    createdBy: "mock-register",
    durationMs: null,
    error: null,
    // Los tests siembran también lecturas fuera del contrato (D10): se guardan tal cual.
    extracted: scan.extracted as InvoiceScanRow["extracted"],
    id,
    imageSha256: sha256,
    inputTokens: null,
    matched: null,
    model: "invoice-scan-mock",
    outputTokens: null,
    pages: 1,
    provider: "mock",
    purchaseId: scan.purchaseId ?? null,
    status: scan.status ?? "extracted",
    storagePath: `${storeId}/${sha256}/p1.jpg`,
    storeId,
    supplierId: null,
    usagePages: 0,
  });
  clearClaim(id);
  mockScanClaim(id).confirmedClientRequestId = null;

  return toView(id) as MockInvoiceScan;
}

export function getMockInvoiceScan(id: string): MockInvoiceScan | undefined {
  return toView(id);
}

/** Alias aprendidos de la tienda (opcionalmente de un proveedor). */
export function listMockLearnedAliases(storeId: string, supplierId?: string): MockLearnedAlias[] {
  return [...aliases().values()].filter(
    (alias) => alias.storeId === storeId && (!supplierId || alias.supplierId === supplierId),
  );
}

/** Solo tests: vacía el almacén compartido de escaneos (filas y reclamos) y los alias. */
export function resetMockInvoiceScans() {
  resetMockScanStore();
  aliases().clear();
}

export async function precheckInvoiceScan(
  input: InvoiceScanClaimInput,
  storeId: string,
): Promise<PrecheckedInvoiceScan> {
  const scan = ownRow(input.scanId, storeId);
  const claim = scan ? mockScanClaim(scan.id) : null;
  const replayPurchaseId =
    scan?.status === "confirmed" && claim?.confirmedClientRequestId === input.clientRequestId
      ? scan.purchaseId
      : null;
  const { replay } = assertScanUsable(scan, replayPurchaseId);
  const usable = scan as NonNullable<typeof scan>;
  const usableClaim = claim as NonNullable<typeof claim>;

  // Espejo del UPDATE condicional de claim_invoice_scan (sin await en medio: atómico).
  if (!replay) {
    const now = Date.now();
    const claimFree =
      usableClaim.claimRequestId === null ||
      usableClaim.claimRequestId === input.clientRequestId ||
      usableClaim.claimedAt === null ||
      usableClaim.claimedAt < now - INVOICE_SCAN_CLAIM_TTL_MS;

    if (!claimFree) {
      throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_CLAIMED_MESSAGE);
    }

    // INT-01 (caos-5 B4): cada reclamo renueva la caducidad; el mismo intento
    // conserva el momento de su primer reclamo (SCN-06-F3).
    if (usableClaim.claimRequestId !== input.clientRequestId || usableClaim.claimStartedAt === null) {
      usableClaim.claimStartedAt = now;
    }
    usableClaim.claimedAt = now;
    usableClaim.claimRequestId = input.clientRequestId;
  }

  return {
    extraction: readStoredExtraction(usable.extracted),
    id: usable.id,
    purchaseId: usable.purchaseId,
    rawTexts: readExtractedRawTexts(usable.extracted),
    replay,
  };
}

/** Espejo de `release_invoice_scan_claim`: no-op si el reclamo no es de esa clave. */
export async function releaseInvoiceScanClaim(
  input: InvoiceScanClaimInput,
  storeId: string,
): Promise<void> {
  const stored = ownRow(input.scanId, storeId);

  if (stored?.status === "extracted" && mockScanClaim(stored.id).claimRequestId === input.clientRequestId) {
    clearClaim(stored.id);
  }
}

/**
 * Espejo de `learn_invoice_aliases`: devuelve cuántos alias tocó. Con el mismo
 * producto, una clave de empaque presente (aunque sea `null`) sobrescribe y una
 * ausente conserva (SCN-06-F2 · A1).
 */
function learnMockAliases(
  storeId: string,
  supplierId: string,
  confirmed: ConfirmedInvoiceScan,
  items: FinalizeInvoiceScanInput["items"],
) {
  const lastByAlias = new Map(buildLearnLines(confirmed.lines, items).map((line) => [line.alias_norm, line]));
  const store = aliases();

  for (const line of lastByAlias.values()) {
    const key = aliasKey(storeId, supplierId, line.alias_norm);
    const previous = store.get(key);
    const sameProduct = previous?.productId === line.product_id;
    const keep = <T,>(hasKey: boolean, next: T | null | undefined, kept: T | null | undefined) =>
      hasKey || !sameProduct ? (next ?? null) : (kept ?? null);

    store.set(key, {
      aliasNorm: line.alias_norm,
      hits: previous && sameProduct ? previous.hits + 1 : 1,
      packLabel: keep("pack_label" in line, line.pack_label, previous?.packLabel),
      productId: line.product_id,
      storeId,
      supplierId,
      unitsPerPack: keep("units_per_pack" in line, line.units_per_pack, previous?.unitsPerPack),
    });
  }

  return lastByAlias.size;
}

export async function finalizeInvoiceScan(
  scan: PrecheckedInvoiceScan,
  input: FinalizeInvoiceScanInput,
  storeId: string,
): Promise<InvoiceScanOutcome> {
  if (scan.replay) {
    return { confirmed: scan.purchaseId === input.purchaseId, learned: null };
  }

  const stored = ownRow(scan.id, storeId);
  const claim = stored ? mockScanClaim(stored.id) : null;

  // Mismo rechazo que confirm_invoice_scan: ausente/ajeno, ya no `extracted` o
  // reclamado por otro intento.
  if (
    !stored ||
    !claim ||
    stored.status !== "extracted" ||
    !input.clientRequestId ||
    claim.claimRequestId !== input.clientRequestId
  ) {
    console.error("[invoice-scan] confirm falló; la compra quedó creada", { scanId: scan.id });
    return { confirmed: stored?.purchaseId === input.purchaseId, learned: null };
  }

  // SCN-06-F2 · M1: compra ya ligada a otro escaneo (la clave se reutilizó y el mock
  // de compras devolvió la compra vieja) → suelta el reclamo y 400. SCN-06-F3: lo
  // mismo si la compra se creó antes del reclamo (compra vieja sin escaneo).
  const linkedElsewhere = listMockScansOfStore(storeId).some(
    (other) => other.id !== stored.id && other.purchaseId === input.purchaseId,
  );
  const purchaseCreatedAt = Date.parse(findMockPurchase(input.purchaseId)?.createdAt ?? "");
  const createdBeforeClaim =
    claim.claimStartedAt === null ||
    (Number.isFinite(purchaseCreatedAt) &&
      purchaseCreatedAt < claim.claimStartedAt - INVOICE_SCAN_CLAIM_CLOCK_SKEW_MS);

  if (linkedElsewhere || createdBeforeClaim) {
    clearClaim(stored.id);
    throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_KEY_REUSED_MESSAGE);
  }

  const confirmed = buildConfirmedPayload(
    { extraction: readStoredExtraction(stored.extracted), rawTexts: readExtractedRawTexts(stored.extracted) },
    input,
  );

  // Como confirm_invoice_scan (D10): sin extracción no hay confirmación válida.
  if (!confirmed.extraction) {
    console.error("[invoice-scan] confirm falló; la compra quedó creada", { scanId: scan.id });
    return { confirmed: false, learned: null };
  }

  // Como confirm_invoice_scan: status, confirmed, purchase_id, confirmed_at y supplier_id.
  putMockScanRow({
    ...stored,
    confirmed,
    confirmedAt: new Date().toISOString(),
    purchaseId: input.purchaseId,
    status: "confirmed",
    supplierId: input.supplierId,
  });
  clearClaim(stored.id);
  claim.confirmedClientRequestId = input.clientRequestId;

  return { confirmed: true, learned: learnMockAliases(storeId, input.supplierId, confirmed, input.items) };
}
