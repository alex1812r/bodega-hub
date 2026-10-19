/**
 * @jest-environment node
 */
/**
 * REP3-03d · auditoría p4 B14 / B17 y caos p3 N10 (espejo del parche
 * 20261019m-invoice-scan-release-v3.sql en el mock):
 * - B14: escaneo LIGADO por CIE-06 (la clave del reclamo creó su compra pero el
 *   confirm no llegó) y esa compra se anula → el escaneo queda libre.
 * - B17: reenviar la petición ORIGINAL (misma clave que la compra anulada) no
 *   crea compra (idempotencia: 409) y NO debe liberar ni borrar `confirmed`.
 * - N10: tras anular, el reintento de la clave original seguido de otra clave
 *   deja un estado coherente (ligado a la compra nueva).
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../contacts/services/supplierProducts.server", () => ({
  createSupplierProductPackUnit: jest.fn(),
}));
jest.mock("./confirmScan.server", () => {
  const actual = jest.requireActual<typeof import("./confirmScan.server")>("./confirmScan.server");

  return { ...actual, buildConfirmedPayload: jest.fn(actual.buildConfirmedPayload) };
});

import { createdMockPurchases } from "@/modules/purchases/services/purchaseMockStore";
import type { PurchaseMock, PurchaseStatus } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";

import {
  finalizeInvoiceScan,
  getMockInvoiceScan,
  precheckInvoiceScan,
  registerMockInvoiceScan,
  releaseInvoiceScanClaim,
  resetMockInvoiceScans,
} from "./confirmScan.mock-server";
import { buildConfirmedPayload } from "./confirmScan.server";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const KEY_1 = "1a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const KEY_2 = "2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const PURCHASE_1 = "rep3-03d-purchase-1";
const PURCHASE_2 = "rep3-03d-purchase-2";
const SCAN = "scan-rep3-03d";

const extracted: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [{ confidence: 0.9, description: "HARINA PAN", lineTotal: 1, quantity: 1, rawText: "HARINA PAN", unitPrice: 1 }],
  supplier: { name: "Proveedor" },
  warnings: [],
};

function putMockPurchase(id: string, status: PurchaseStatus) {
  const purchase = {
    createdAt: "2999-01-01T00:00:00.000Z",
    discountRef: 0,
    id,
    paidVes: 0,
    purchaseNumber: `C-${id}`,
    refRateVes: 900,
    status,
    storeId: DEFAULT_STORE_ID,
    subtotalRef: 1,
    supplierId: SUPPLIER,
    taxRef: 0,
    totalRef: 1,
    totalVes: 900,
    userId: "user-1",
  } satisfies PurchaseMock;

  createdMockPurchases().set(id, { items: [], purchase });
}

const claim = (key: string) => precheckInvoiceScan({ clientRequestId: key, scanId: SCAN }, DEFAULT_STORE_ID);

function finalize(scan: Awaited<ReturnType<typeof claim>>, purchaseId: string, key: string) {
  return finalizeInvoiceScan(
    scan,
    {
      clientRequestId: key,
      items: [{ entryMode: "unit", productId: PRODUCT }],
      lines: [{ lineIndex: 0, productId: PRODUCT }],
      purchaseId,
      supplierId: SUPPLIER,
    },
    DEFAULT_STORE_ID,
  );
}

async function confirmWith(purchaseId: string, key: string) {
  return finalize(await claim(key), purchaseId, key);
}

describe("REP3-03d · liberación v3 (mock)", () => {
  beforeEach(() => {
    resetMockInvoiceScans();
    createdMockPurchases().delete(PURCHASE_1);
    createdMockPurchases().delete(PURCHASE_2);
    registerMockInvoiceScan({ extracted, id: SCAN });
  });

  it("B14: ligado por CIE-06 sin confirm y compra anulada → otra clave lo carga en una compra nueva", async () => {
    putMockPurchase(PURCHASE_1, "pedido");
    // Corte tras create_purchase: la compra de KEY_1 existe, el confirm no llega.
    jest.mocked(buildConfirmedPayload).mockImplementationOnce(
      () => ({ extraction: null, lines: [] }) as unknown as ReturnType<typeof buildConfirmedPayload>,
    );
    await expect(confirmWith(PURCHASE_1, KEY_1)).resolves.toMatchObject({ confirmed: false });
    expect(getMockInvoiceScan(SCAN)).toMatchObject({ claimRequestId: KEY_1, status: "extracted" });

    putMockPurchase(PURCHASE_1, "cancelado");
    putMockPurchase(PURCHASE_2, "pedido");

    await expect(confirmWith(PURCHASE_2, KEY_2)).resolves.toMatchObject({ confirmed: true });
    expect(getMockInvoiceScan(SCAN)).toMatchObject({ purchaseId: PURCHASE_2, status: "confirmed" });
  });

  it("B14: ligado a una compra anulada → el reintento de su clave, rechazado, suelta el reclamo", async () => {
    putMockPurchase(PURCHASE_1, "pedido");
    jest.mocked(buildConfirmedPayload).mockImplementationOnce(
      () => ({ extraction: null, lines: [] }) as unknown as ReturnType<typeof buildConfirmedPayload>,
    );
    await confirmWith(PURCHASE_1, KEY_1);
    putMockPurchase(PURCHASE_1, "cancelado");

    await claim(KEY_1);
    await releaseInvoiceScanClaim({ clientRequestId: KEY_1, scanId: SCAN }, DEFAULT_STORE_ID);

    expect(getMockInvoiceScan(SCAN)).toMatchObject({ claimRequestId: null, status: "extracted" });
  });

  it("B14: ligado a una compra viva sigue bloqueado para otra clave", async () => {
    putMockPurchase(PURCHASE_1, "pedido");
    jest.mocked(buildConfirmedPayload).mockImplementationOnce(
      () => ({ extraction: null, lines: [] }) as unknown as ReturnType<typeof buildConfirmedPayload>,
    );
    await confirmWith(PURCHASE_1, KEY_1);

    await expect(claim(KEY_2)).rejects.toMatchObject({ message: "Esta factura ya se registró en otra compra", status: 400 });
  });

  it("B17: la petición original tras anular no libera ni borra confirmed", async () => {
    putMockPurchase(PURCHASE_1, "pedido");
    await confirmWith(PURCHASE_1, KEY_1);
    putMockPurchase(PURCHASE_1, "cancelado");

    // La ruta: precheck (reclamo) → create_purchase(KEY_1) da 409 → release.
    await claim(KEY_1).catch(() => undefined);
    await releaseInvoiceScanClaim({ clientRequestId: KEY_1, scanId: SCAN }, DEFAULT_STORE_ID);

    const row = getMockInvoiceScan(SCAN);
    expect(row).toMatchObject({ purchaseId: PURCHASE_1, status: "confirmed" });
    expect(row?.confirmed).not.toBeNull();
  });

  it("N10: reintento de la clave original y luego otra clave → ligado a la compra nueva", async () => {
    putMockPurchase(PURCHASE_1, "pedido");
    await confirmWith(PURCHASE_1, KEY_1);
    putMockPurchase(PURCHASE_1, "cancelado");

    await claim(KEY_1).catch(() => undefined);
    await releaseInvoiceScanClaim({ clientRequestId: KEY_1, scanId: SCAN }, DEFAULT_STORE_ID);
    putMockPurchase(PURCHASE_2, "pedido");

    await expect(confirmWith(PURCHASE_2, KEY_2)).resolves.toMatchObject({ confirmed: true });
    expect(getMockInvoiceScan(SCAN)).toMatchObject({ claimRequestId: null, purchaseId: PURCHASE_2, status: "confirmed" });
  });
});
