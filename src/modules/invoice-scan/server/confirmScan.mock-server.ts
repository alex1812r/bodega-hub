/**
 * SCN-06 · Mock con paridad de `confirmScan.server.ts` (escaneo dentro de
 * `POST /api/purchases`). Mismas reglas que las RPC `confirm_invoice_scan` y
 * `learn_invoice_aliases` (20261019b):
 * - escaneo ajeno o inexistente → 400; confirmado con otra compra → 400;
 *   descartado/fallido → 400; replay con el mismo `clientRequestId` → pasa y no
 *   vuelve a aprender;
 * - aprendizaje por (tienda, proveedor, alias): mismo producto → `hits + 1`,
 *   producto distinto → reasigna el mismo registro con `hits = 1` (caos 6.10);
 *   dentro de una confirmación gana la última línea de cada alias.
 *
 * Diferencias asumidas: el replay se reconoce por la `clientRequestId` con la que
 * se confirmó el escaneo (en la base, por `purchases.client_request_id`; mismo
 * significado) y no se comprueba que `productId` sea un producto de la tienda
 * (la RPC ignora los ajenos).
 *
 * Punto de integración: el mock de Extracción (`POST /api/purchases/invoice-scan`
 * en modo mock) debe llamar a `registerMockInvoiceScan` con el `scanId`, la tienda
 * y la `extraction` que devuelve, para que la compra pueda confirmarlo aquí. Hasta
 * entonces solo los tests registran escaneos.
 */
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  assertScanUsable,
  buildConfirmedPayload,
  buildLearnLines,
  readExtractedRawTexts,
  type ConfirmedInvoiceScan,
  type FinalizeInvoiceScanInput,
  type InvoiceScanOutcome,
  type InvoiceScanStatus,
  type PrecheckedInvoiceScan,
} from "./confirmScan.server";

export type MockInvoiceScan = {
  /** Clave de idempotencia de la compra con la que se confirmó (replay). */
  confirmedClientRequestId: string | null;
  confirmed: ConfirmedInvoiceScan | null;
  extracted: unknown;
  id: string;
  purchaseId: string | null;
  status: InvoiceScanStatus;
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

function scans() {
  return mockState("invoice-scan:confirm:scans", () => new Map<string, MockInvoiceScan>());
}

function aliases() {
  return mockState("invoice-scan:confirm:aliases", () => new Map<string, MockLearnedAlias>());
}

function aliasKey(storeId: string, supplierId: string, aliasNorm: string) {
  return `${storeId}:${supplierId}:${aliasNorm}`;
}

/** Registra (o reemplaza) un escaneo mock. Ver el punto de integración arriba. */
export function registerMockInvoiceScan(scan: {
  extracted: unknown;
  id?: string;
  purchaseId?: string | null;
  status?: InvoiceScanStatus;
  storeId?: string;
}): MockInvoiceScan {
  const stored: MockInvoiceScan = {
    confirmed: null,
    confirmedClientRequestId: null,
    extracted: scan.extracted,
    id: scan.id ?? crypto.randomUUID(),
    purchaseId: scan.purchaseId ?? null,
    status: scan.status ?? "extracted",
    storeId: scan.storeId ?? DEFAULT_STORE_ID,
  };

  scans().set(stored.id, stored);
  return stored;
}

export function getMockInvoiceScan(id: string): MockInvoiceScan | undefined {
  return scans().get(id);
}

/** Alias aprendidos de la tienda (opcionalmente de un proveedor). */
export function listMockLearnedAliases(storeId: string, supplierId?: string): MockLearnedAlias[] {
  return [...aliases().values()].filter(
    (alias) => alias.storeId === storeId && (!supplierId || alias.supplierId === supplierId),
  );
}

/** Solo tests: vacía escaneos y alias. */
export function resetMockInvoiceScans() {
  scans().clear();
  aliases().clear();
}

export async function precheckInvoiceScan(
  input: { clientRequestId?: string; scanId: string },
  storeId: string,
): Promise<PrecheckedInvoiceScan> {
  const stored = scans().get(input.scanId);
  const scan = stored && stored.storeId === storeId ? stored : null;
  const replayPurchaseId =
    scan?.status === "confirmed" &&
    input.clientRequestId &&
    scan.confirmedClientRequestId === input.clientRequestId
      ? scan.purchaseId
      : null;
  const { replay } = assertScanUsable(scan, replayPurchaseId);
  const usable = scan as MockInvoiceScan;

  return {
    id: usable.id,
    purchaseId: usable.purchaseId,
    rawTexts: readExtractedRawTexts(usable.extracted),
    replay,
  };
}

/** Espejo de `learn_invoice_aliases`: devuelve cuántos alias tocó. */
function learnMockAliases(storeId: string, supplierId: string, confirmed: ConfirmedInvoiceScan) {
  const lastByAlias = new Map(buildLearnLines(confirmed.lines).map((line) => [line.alias_norm, line]));
  const store = aliases();

  for (const line of lastByAlias.values()) {
    const key = aliasKey(storeId, supplierId, line.alias_norm);
    const previous = store.get(key);
    const sameProduct = previous?.productId === line.product_id;

    store.set(key, {
      aliasNorm: line.alias_norm,
      hits: previous && sameProduct ? previous.hits + 1 : 1,
      packLabel: sameProduct ? (line.pack_label ?? previous?.packLabel ?? null) : line.pack_label,
      productId: line.product_id,
      storeId,
      supplierId,
      unitsPerPack: sameProduct
        ? (line.units_per_pack ?? previous?.unitsPerPack ?? null)
        : line.units_per_pack,
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

  const stored = scans().get(scan.id);

  // Mismo rechazo que confirm_invoice_scan: ausente/ajeno o ya no `extracted`.
  if (!stored || stored.storeId !== storeId || stored.status !== "extracted") {
    console.error("[invoice-scan] confirm falló; la compra quedó creada", { scanId: scan.id });
    return { confirmed: stored?.purchaseId === input.purchaseId, learned: null };
  }

  const confirmed = buildConfirmedPayload(readExtractedRawTexts(stored.extracted), input);

  stored.status = "confirmed";
  stored.confirmed = confirmed;
  stored.purchaseId = input.purchaseId;
  stored.confirmedClientRequestId = input.clientRequestId ?? null;

  return { confirmed: true, learned: learnMockAliases(storeId, input.supplierId, confirmed) };
}
