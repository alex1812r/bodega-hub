/**
 * @jest-environment node
 */
import { mockInvoiceStorage } from "@/modules/invoice-scan/server/scanService";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

const PURCHASE_ID = "purchase-001";
const SHA = "a".repeat(64);
const STORAGE_PATH = `${DEFAULT_STORE_ID}/${SHA}/p1.jpg`;

function extraction(rawTexts: string[]) {
  return {
    confidence: 0.9,
    currency: "VES" as const,
    lines: rawTexts.map((rawText) => ({
      confidence: 0.9,
      description: rawText,
      lineTotal: 10,
      quantity: 1,
      rawText,
      unitPrice: 10,
    })),
    supplier: { name: "Distribuidora" },
    warnings: [],
  };
}

function scanRow(overrides: Partial<InvoiceScanRow> = {}): InvoiceScanRow {
  const rawTexts = ["HARINA PAN 1KG BULTO X20", "ACEITE DIANA 1L"];

  return {
    confirmed: {
      confirmedAt: "2026-10-10T12:00:00.000Z",
      extraction: extraction(rawTexts),
      lines: [
        { aliasNorm: "harina pan 1kg bulto x20", lineIndex: 0, packLabel: "Bulto", productId: "prod-drill", rawText: rawTexts[0], unitsPerPack: 20 },
        { aliasNorm: "aceite diana 1l", lineIndex: 1, productId: "prod-cable", rawText: rawTexts[1] },
      ],
      purchaseId: PURCHASE_ID,
      supplierId: "cont-supplier",
    },
    confirmedAt: "2026-10-10T12:00:00.000Z",
    createdAt: new Date().toISOString(),
    createdBy: "user-warehouse",
    durationMs: 1000,
    error: null,
    extracted: extraction(rawTexts) as unknown as InvoiceScanRow["extracted"],
    id: "11111111-1111-4111-8111-111111111111",
    imageSha256: SHA,
    inputTokens: null,
    matched: null,
    model: "mock",
    outputTokens: null,
    pages: 2,
    provider: "mock",
    purchaseId: PURCHASE_ID,
    status: "confirmed",
    storagePath: STORAGE_PATH,
    storeId: DEFAULT_STORE_ID,
    supplierId: "cont-supplier",
    usagePages: 2,
    ...overrides,
  };
}

async function uploadPages() {
  await mockInvoiceStorage.upload(STORAGE_PATH, new Uint8Array([1]), "image/jpeg");
  await mockInvoiceStorage.upload(`${DEFAULT_STORE_ID}/${SHA}/p2.jpg`, new Uint8Array([2]), "image/jpeg");
}

function get(id: string, { query = "", role = "almacen", storeId = DEFAULT_STORE_ID } = {}) {
  return GET(
    new Request(`http://localhost/api/purchases/${id}/invoice-scan${query}`, {
      headers: { "x-demo-role": role, "x-demo-store-id": storeId },
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("GET /api/purchases/[id]/invoice-scan", () => {
  beforeEach(() => {
    resetMockScanStore();
  });

  it("con escaneo confirmado devuelve líneas aprendidas con producto y empaque, y URLs firmadas", async () => {
    putMockScanRow(scanRow());
    await uploadPages();
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await get(PURCHASE_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      confirmedAt: "2026-10-10T12:00:00.000Z",
      imageExpired: false,
      learned: 2,
      pages: 2,
      scanId: "11111111-1111-4111-8111-111111111111",
    });
    expect(body.data.imageUrls).toEqual([
      expect.stringContaining(`invoice-scans/${STORAGE_PATH}?token=mock-read-300`),
      expect.stringContaining(`${DEFAULT_STORE_ID}/${SHA}/p2.jpg`),
    ]);
    expect(body.data.lines).toEqual([
      {
        lineIndex: 0,
        packLabel: "Bulto",
        productId: "prod-drill",
        productName: "Taladro percutor",
        rawText: "HARINA PAN 1KG BULTO X20",
        unitsPerPack: 20,
      },
      { lineIndex: 1, productId: "prod-cable", productName: "Cable THW 12", rawText: "ACEITE DIANA 1L" },
    ]);
    // Nunca se registran URLs ni contenido de la factura.
    const logged = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain("mock-storage");
    expect(logged).not.toContain("HARINA");
    log.mockRestore();
    warn.mockRestore();
  });

  it("con ?images=0 no firma las imágenes", async () => {
    putMockScanRow(scanRow());
    await uploadPages();

    const body = await (await get(PURCHASE_ID, { query: "?images=0" })).json();

    expect(body.data.imageUrls).toEqual([]);
    expect(body.data.imageExpired).toBe(false);
    expect(body.data.lines).toHaveLength(2);
  });

  it("sin escaneo confirmado devuelve data null", async () => {
    putMockScanRow(scanRow({ confirmed: null, confirmedAt: null, purchaseId: null, status: "extracted" }));

    const response = await get(PURCHASE_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: null });
  });

  it("una compra de otra tienda responde 404", async () => {
    putMockScanRow(scanRow());

    const response = await get(PURCHASE_ID, { storeId: "otra-tienda-09a" });

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("mock-storage");
  });

  it("una compra que no existe responde 404", async () => {
    expect((await get("purchase-inexistente")).status).toBe(404);
  });

  it("el vendedor (sin purchases.view) recibe 403", async () => {
    putMockScanRow(scanRow());

    expect((await get(PURCHASE_ID, { role: "vendedor" })).status).toBe(403);
  });

  it("el contador (purchases.view sin purchases.create) puede leerlo", async () => {
    putMockScanRow(scanRow());
    await uploadPages();

    expect((await get(PURCHASE_ID, { role: "contador" })).status).toBe(200);
  });

  it("si la imagen ya no está en el bucket marca imageExpired y no da URLs", async () => {
    putMockScanRow(scanRow({ imageSha256: "b".repeat(64), storagePath: `${DEFAULT_STORE_ID}/${"b".repeat(64)}/p1.jpg` }));

    const body = await (await get(PURCHASE_ID)).json();

    expect(body.data).toMatchObject({ imageExpired: true, imageUrls: [], learned: 2 });
  });

  it("pasados los 90 días marca imageExpired sin firmar", async () => {
    putMockScanRow(scanRow({ createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString() }));
    await uploadPages();

    const body = await (await get(PURCHASE_ID)).json();

    expect(body.data).toMatchObject({ imageExpired: true, imageUrls: [] });
  });

  it("un confirmed fuera del contrato devuelve el escaneo sin líneas", async () => {
    putMockScanRow(scanRow({ confirmed: { vieja: true } }));
    await uploadPages();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const body = await (await get(PURCHASE_ID)).json();

    expect(body.data).toMatchObject({ learned: 0, lines: [] });
    warn.mockRestore();
  });
});
