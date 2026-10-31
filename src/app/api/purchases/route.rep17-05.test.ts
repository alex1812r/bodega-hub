/**
 * @jest-environment node
 */
/**
 * REP17-05 · B-p18A-1 (caos p18 A, N38b; D70(f)): el reintento del mismo intento (misma `clientRequestId`, mismo
 * cuerpo) tras purgarse el escaneo respondía 400 «Escaneo no encontrado» aunque la compra con esa clave existía:
 * `precheckInvoiceScan` corría antes del replay de `create_purchase`. El replay va primero: devuelve la compra
 * original (201) con el escaneo sin confirmar en esta llamada; un escaneo inexistente sin compra previa sigue en 400.
 */

import { registerMockInvoiceScan, resetMockInvoiceScans } from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { deleteScansByIds } from "@/modules/invoice-scan/server/scans.mock-server";
import { createdMockPurchases } from "@/modules/purchases/services/purchaseMockStore";

import { POST } from "./route";

const SCAN_ID = "5a0e1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b17";
const PURCHASE_KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c17";
const OTHER_KEY = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e17";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";

const extracted = {
  confidence: 0.9,
  currency: "VES",
  lines: [{ confidence: 0.9, description: "REF.MALTA 1.5", lineTotal: 1020, quantity: 1, rawText: "REF.MALTA 1.5", unitPrice: 1020 }],
  supplier: { name: "Distribuidora Lab" },
  warnings: [],
};

function body(clientRequestId: string) {
  return {
    clientRequestId,
    discountRef: 0,
    discountVes: 0,
    invoiceScanId: SCAN_ID,
    invoiceScanLines: [{ lineIndex: 0, productId: PRODUCT_A }],
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
}

function post(payload: unknown) {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

function createdCount() {
  return createdMockPurchases().size;
}

describe("REP17-05 · B-p18A-1: replay de POST /api/purchases tras purgarse el escaneo", () => {
  beforeEach(() => {
    resetMockInvoiceScans();
    registerMockInvoiceScan({ extracted, id: SCAN_ID });
  });

  it("la misma clave devuelve la compra original (201), no 400 «Escaneo no encontrado»", async () => {
    const before = createdCount();
    const first = await post(body(PURCHASE_KEY));
    expect(first.status).toBe(201);
    const original = (await first.json()) as { data: { id: string } };

    await deleteScansByIds(null, [SCAN_ID]);

    const replay = await post(body(PURCHASE_KEY));
    const replayed = (await replay.json()) as { data: { id: string; invoiceScan?: { confirmed: boolean } } };
    expect(replay.status).toBe(201);
    expect(replayed.data.id).toBe(original.data.id);
    expect(replayed.data.invoiceScan).toEqual({ confirmed: false, learned: null });
    expect(createdCount()).toBe(before + 1);
  });

  it("sin compra previa con la clave, el escaneo purgado sigue en 400 y no crea nada", async () => {
    await deleteScansByIds(null, [SCAN_ID]);
    const before = createdCount();

    const response = await post(body(OTHER_KEY));
    expect(response.status).toBe(400);
    expect(createdCount()).toBe(before);
  });
});
