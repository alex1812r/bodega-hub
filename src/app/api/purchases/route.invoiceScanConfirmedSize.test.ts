/**
 * @jest-environment node
 */
/**
 * REP2-02 (caos C2-M1 · auditoría B11): el tope de 128 KB solo medía la extracción
 * corregida; `confirmed` suma por línea el rawText GUARDADO, aliasNorm, productId y
 * packLabel. `confirm_invoice_scan` lo rechazaba (> 256 KB) DESPUÉS de crear la
 * compra y el escaneo quedaba en limbo. Ahora: 400 en español sin compra.
 */

import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import {
  getMockInvoiceScan,
  registerMockInvoiceScan,
  resetMockInvoiceScans,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { createdMockPurchases } from "@/modules/purchases/services/purchaseMockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const KEY_1 = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const KEY_2 = "9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
const HEADERS = { "x-demo-role": "almacen", "x-demo-store-id": DEFAULT_STORE_ID };

const purchase = {
  discountRef: 0,
  discountVes: 0,
  items: [
    {
      costCurrency: "ref",
      entryMode: "pack",
      packCostRef: 2,
      packCostVes: 1020,
      packCount: 1,
      packLabel: "Bulto",
      productId: PRODUCT_A,
      subtotalRef: 2,
      subtotalVes: 1020,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 0.33,
      unitCostVes: 170,
      unitsPerPack: 6,
    },
  ],
  refRateVes: 510,
  subtotalRef: 2,
  subtotalVes: 1020,
  supplierId: "cont-supplier",
  taxRef: 0,
  taxVes: 0,
};

function extractionOf(rawText: (index: number) => string, description: (index: number) => string): InvoiceExtraction {
  return {
    confidence: 0.9,
    currency: "VES",
    lines: Array.from({ length: 300 }, (_, index) => ({
      confidence: 0.9,
      description: description(index),
      lineTotal: 12.5,
      quantity: 1,
      rawText: rawText(index),
      unitPrice: 12.5,
    })),
    supplier: { name: "Proveedor" },
    warnings: [],
  };
}

function linesWith(packLabel: string) {
  return Array.from({ length: 300 }, (_, lineIndex) => ({ lineIndex, packLabel, productId: PRODUCT_A, unitsPerPack: 6 }));
}

function buy(body: unknown) {
  return POST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...HEADERS },
      method: "POST",
    }),
  );
}

describe("POST /api/purchases · tamaño de confirmed (REP2-02 · auditoría B11)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockInvoiceScans();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("300 líneas con rawText guardado largo + packLabel de 100 € y corregida bajo 128 KB → 400 sin crear la compra ni reclamar", async () => {
    // Guardada: 300 líneas con rawText de 400 caracteres (fuera del tope nuevo del
    // escaneo, como una fila anterior a él). Corregida: textos cortos, < 128 KB.
    const stored = registerMockInvoiceScan({
      extracted: extractionOf((index) => `L${index} ${"x".repeat(395)}`, (index) => `Producto ${index}`),
    });
    const corrected = extractionOf((index) => `Producto ${index}`, (index) => `Producto ${index}`);
    const before = createdMockPurchases().size;

    const response = await buy({
      ...purchase,
      clientRequestId: KEY_1,
      invoiceScanExtraction: corrected,
      invoiceScanId: stored.id,
      invoiceScanLines: linesWith("€".repeat(100)),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "La confirmación de la factura es demasiado grande. Vincula menos líneas, acorta las etiquetas de empaque o divide la compra.",
    );
    expect(createdMockPurchases().size).toBe(before);
    expect(getMockInvoiceScan(stored.id)).toMatchObject({ claimRequestId: null, purchaseId: null, status: "extracted" });
  });

  it("300 líneas normales siguen confirmándose (201, confirmed true)", async () => {
    const extracted = extractionOf(
      (index) => `${index + 1} HARINA PAN BLANCA 1KG X 20 UND 12,50`,
      (index) => `HARINA PAN BLANCA 1KG ${index + 1}`,
    );
    const stored = registerMockInvoiceScan({ extracted });

    const response = await buy({
      ...purchase,
      clientRequestId: KEY_2,
      invoiceScanExtraction: extracted,
      invoiceScanId: stored.id,
      invoiceScanLines: linesWith("Bulto de 20"),
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.data.invoiceScan.confirmed).toBe(true);
    expect(getMockInvoiceScan(stored.id)).toMatchObject({ status: "confirmed" });
  });
});
