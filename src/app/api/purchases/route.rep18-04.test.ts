/**
 * @jest-environment node
 */
/**
 * REP18-04 · B-p19-1 (auditoría p19, D75(e)): el 409 del replay ya no soltaba el reclamo del escaneo. Con la clave K
 * que ya creó su compra (luego anulada) y el escaneo S reclamado por K, reintentar K con `invoiceScanId=S` hace que
 * `create_purchase` responda 409 (otra huella). Desde REP17-05 ese `createPurchase` del replay corría fuera del
 * `try` que suelta el reclamo en los 4xx, y S quedaba `extracted` con `claim=K` (en p18 / B17 quedaba sin reclamo).
 */

import { ApiError } from "@/lib/api/apiError";
import {
  getMockInvoiceScan,
  precheckInvoiceScan,
  registerMockInvoiceScan,
  resetMockInvoiceScans,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

jest.mock("../../../modules/purchases/services/purchases.mock-server", () => {
  const actual = jest.requireActual<
    typeof import("../../../modules/purchases/services/purchases.mock-server")
  >("../../../modules/purchases/services/purchases.mock-server");

  return { ...actual, createPurchase: jest.fn(actual.createPurchase) };
});

const createPurchase = jest.mocked(purchasesMockServer.createPurchase);

const SCAN_ID = "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b18";
const PURCHASE_KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c18";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const SCAN_LINES = [{ lineIndex: 0, productId: PRODUCT_A }];

const extracted = {
  confidence: 0.9,
  currency: "VES",
  lines: [{ confidence: 0.9, description: "REF.MALTA 1.5", lineTotal: 1020, quantity: 1, rawText: "REF.MALTA 1.5", unitPrice: 1020 }],
  supplier: { name: "Distribuidora Lab" },
  warnings: [],
};

const base = {
  clientRequestId: PURCHASE_KEY,
  discountRef: 0,
  discountVes: 0,
  items: [
    {
      costCurrency: "ref",
      entryMode: "unit",
      productId: PRODUCT_A,
      quantity: 1,
      subtotalRef: 2,
      subtotalVes: 1020,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 2,
      unitCostVes: 1020,
    },
  ],
  refRateVes: 510,
  subtotalRef: 2,
  subtotalVes: 1020,
  supplierId: "cont-supplier",
  taxRef: 0,
  taxVes: 0,
};

function post(payload: unknown) {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

describe("REP18-04 · B-p19-1: el 409 del replay suelta el reclamo del escaneo", () => {
  beforeEach(() => {
    resetMockInvoiceScans();
    registerMockInvoiceScan({ extracted, id: SCAN_ID });
  });

  it("clave con compra anulada + escaneo reclamado por ella → 409 y el escaneo queda sin reclamo", async () => {
    await precheckInvoiceScan({ clientRequestId: PURCHASE_KEY, lines: SCAN_LINES, scanId: SCAN_ID }, DEFAULT_STORE_ID);
    expect(getMockInvoiceScan(SCAN_ID)?.claimRequestId).toBe(PURCHASE_KEY);

    const first = await post(base);
    expect(first.status).toBe(201);
    const { data } = (await first.json()) as { data: { id: string } };
    purchasesMockServer.cancelPurchase(data.id, DEFAULT_STORE_ID);

    // `create_purchase` con la misma clave y otra huella: 409 sin crear nada.
    createPurchase.mockImplementationOnce(() => {
      throw new ApiError(409, "CONFLICT", "La clave de idempotencia ya se usó con otra compra.");
    });

    const replay = await post({ ...base, invoiceScanId: SCAN_ID, invoiceScanLines: SCAN_LINES });
    expect(replay.status).toBe(409);
    expect(getMockInvoiceScan(SCAN_ID)?.status).toBe("extracted");
    expect(getMockInvoiceScan(SCAN_ID)?.claimRequestId).toBeNull();
  });
});
