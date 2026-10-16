/**
 * @jest-environment node
 */
/**
 * SCN-13a · Paridad del modo mock: el escaneo que guarda `POST /api/purchases/invoice-scan`
 * es el mismo que confirma `POST /api/purchases` (un solo almacén), también si
 * vino del caché por hash, y el descarte o un reclamo vigente se respetan igual
 * que en la base (20261019b / 20261019k).
 */

jest.mock("../../../modules/invoice-scan/server/provider", () => ({
  createInvoiceScanModel: jest.fn(),
}));
jest.mock("../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { MockLanguageModelV4 } from "ai/test";

import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { singlePageExtraction } from "@/modules/invoice-scan/server/__fixtures__/extractions";
import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";
import {
  getMockInvoiceScan,
  listMockLearnedAliases,
  precheckInvoiceScan,
  resetMockInvoiceScans,
} from "@/modules/invoice-scan/server/confirmScan.mock-server";
import { createMockInvoiceScanModel } from "@/modules/invoice-scan/server/mockModel";
import { createInvoiceScanModel } from "@/modules/invoice-scan/server/provider";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST as discardPOST } from "./invoice-scan/[id]/discard/route";
import { POST as scanPOST } from "./invoice-scan/route";
import { POST as purchasePOST } from "./route";

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
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
    {
      costCurrency: "ref",
      entryMode: "unit",
      productId: PRODUCT_B,
      quantity: 2,
      subtotalRef: 2,
      subtotalVes: 1020,
      taxRate: 0,
      taxRef: 0,
      taxVes: 0,
      unitCostRef: 1,
      unitCostVes: 510,
    },
  ],
  refRateVes: 510,
  subtotalRef: 4,
  subtotalVes: 2040,
  supplierId: "cont-supplier",
  taxRef: 0,
  taxVes: 0,
};

const invoiceScanLines = [
  { lineIndex: 0, packLabel: "Bulto", productId: PRODUCT_A, unitsPerPack: 6 },
  { lineIndex: 1, productId: PRODUCT_B },
];

let counter = 0;

function scan(image: string) {
  const form = new FormData();
  form.append("page", new File([new Uint8Array(jpegHeader(1600, 1200, image))], "p1.jpg", { type: "image/jpeg" }));

  return scanPOST(new Request("http://localhost/api/purchases/invoice-scan", { body: form, headers: HEADERS, method: "POST" }));
}

function buy(body: unknown) {
  return purchasePOST(
    new Request("http://localhost/api/purchases", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...HEADERS },
      method: "POST",
    }),
  );
}

function discard(id: string) {
  return discardPOST(
    new Request(`http://localhost/api/purchases/invoice-scan/${id}/discard`, { headers: HEADERS, method: "POST" }),
    { params: Promise.resolve({ id }) },
  );
}

function useModel(model: MockLanguageModelV4) {
  (createInvoiceScanModel as jest.Mock).mockReturnValue({ model, modelId: "invoice-scan-mock", provider: "mock" });
}

describe("modo mock · escaneo → compra (SCN-13a)", () => {
  const originalEnv = { ...process.env };
  let image: string;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockInvoiceScans();
    useModel(createMockInvoiceScanModel("ok"));
    counter += 1;
    image = `flujo-${counter}-${Date.now()}`;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("el escaneo recién leído (provider mock) se confirma en la compra: 201 con confirmed true", async () => {
    const scanned = await scan(image);
    const { scanId } = (await scanned.json()).data;

    const response = await buy({ ...purchase, clientRequestId: KEY_1, invoiceScanId: scanId, invoiceScanLines });
    const payload = await response.json();

    expect(scanned.status).toBe(200);
    expect(response.status).toBe(201);
    expect(payload.data.invoiceScan).toEqual({ confirmed: true, learned: 2 });
    expect(getMockInvoiceScan(scanId)).toMatchObject({
      purchaseId: payload.data.id,
      status: "confirmed",
      storeId: DEFAULT_STORE_ID,
    });
    expect(getMockInvoiceScan(scanId)?.confirmed?.extraction).toEqual(singlePageExtraction);
    expect(listMockLearnedAliases(DEFAULT_STORE_ID, "cont-supplier")).toHaveLength(2);
  });

  it("caché por hash: la misma foto devuelve el mismo scanId, se confirma, y después sigue en caché sin reconfirmar", async () => {
    const first = (await (await scan(image)).json()).data;
    const again = (await (await scan(image)).json()).data;

    const response = await buy({ ...purchase, clientRequestId: KEY_1, invoiceScanId: again.scanId, invoiceScanLines });
    const afterConfirm = (await (await scan(image)).json()).data;
    const otherPurchase = await buy({ ...purchase, clientRequestId: KEY_2, invoiceScanId: again.scanId, invoiceScanLines });

    expect(again).toMatchObject({ cached: true, scanId: first.scanId });
    expect(response.status).toBe(201);
    expect((await response.json()).data.invoiceScan.confirmed).toBe(true);
    expect(afterConfirm).toMatchObject({ cached: true, scanId: first.scanId });
    expect(otherPurchase.status).toBe(400);
  });

  it("escaneo descartado por el BFF: la compra con ese invoiceScanId da 400 sin confirmar", async () => {
    const { scanId } = (await (await scan(image)).json()).data;
    const discarded = await discard(scanId);

    const response = await buy({ ...purchase, clientRequestId: KEY_1, invoiceScanId: scanId, invoiceScanLines });

    expect(discarded.status).toBe(200);
    expect(response.status).toBe(400);
    expect(getMockInvoiceScan(scanId)).toMatchObject({ purchaseId: null, status: "discarded" });
  });

  it("descarte con un reclamo vigente de Emparejamiento: 409 y el escaneo sigue extracted (20261019k)", async () => {
    const { scanId } = (await (await scan(image)).json()).data;
    await precheckInvoiceScan({ clientRequestId: KEY_1, scanId }, DEFAULT_STORE_ID);

    const discarded = await discard(scanId);

    expect(discarded.status).toBe(409);
    expect(getMockInvoiceScan(scanId)).toMatchObject({ claimRequestId: KEY_1, status: "extracted" });
  });

  it('"" o solo espacios en los textos opcionales: ausentes en lo guardado, lo respondido y lo confirmado', async () => {
    const blank: InvoiceExtraction = {
      ...singlePageExtraction,
      lines: singlePageExtraction.lines.map((line) => ({ ...line, barcode: "", supplierSku: "  " })),
      number: "",
      supplier: { address: " ", name: singlePageExtraction.supplier.name, phone: "", taxId: "  " },
    };
    useModel(
      new MockLanguageModelV4({
        doGenerate: async () => ({
          content: [{ text: JSON.stringify(blank), type: "text" }],
          finishReason: { raw: "stop", unified: "stop" },
          usage: {
            inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
            outputTokens: { reasoning: 0, text: 0, total: 0 },
          },
          warnings: [],
        }),
      }),
    );

    const scanned = (await (await scan(image)).json()).data;
    const stored = getMockInvoiceScan(scanned.scanId)?.extracted as InvoiceExtraction;
    const response = await buy({ ...purchase, clientRequestId: KEY_1, invoiceScanId: scanned.scanId, invoiceScanLines });

    for (const extraction of [scanned.extraction as InvoiceExtraction, stored]) {
      expect(extraction.supplier).toEqual({ name: singlePageExtraction.supplier.name });
      expect("number" in extraction).toBe(false);
      expect(extraction.lines.every((line) => !("barcode" in line) && !("supplierSku" in line))).toBe(true);
    }
    expect(response.status).toBe(201);
    expect(getMockInvoiceScan(scanned.scanId)?.confirmed?.extraction?.supplier).toEqual({
      name: singlePageExtraction.supplier.name,
    });
  });
});
