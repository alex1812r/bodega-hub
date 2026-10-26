/**
 * @jest-environment node
 */
/**
 * REP14-01 (M-p15-1, D63) · `POST /api/purchases/invoice-scan/duplicates`: la regla compara el
 * número EFECTIVO de cada escaneo previo, el confirmado por el usuario
 * (`confirmed.extraction.number`) si existe y no está vacío, y si no el leído. f12 en p15: la 1.ª
 * compra se confirmó tecleando 00001028 (el modelo no lo leyó); al teclear 00001028 en el 2.º
 * escaneo el aviso desaparecía y la factura se registraba dos veces.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-rep14-store";
const CATIA = "contact-market-catia";
const PREVIO = "00000000-0000-4000-8000-00000000e001";
const ACTUAL = "00000000-0000-4000-8000-00000000e002";

function post(body: unknown) {
  return POST(
    new Request(URL, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "admin", "x-demo-store-id": STORE },
      method: "POST",
    }),
  );
}

function extraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    supplier: { name: "Market Catia" },
    number: "",
    date: "2026-10-08",
    currency: "VES",
    lines: [],
    total: 315708.83,
    confidence: 0.9,
    warnings: [],
    ...overrides,
  } as InvoiceExtraction;
}

function seed(id: string, row: Partial<InvoiceScanRow>) {
  putMockScanRow({
    confirmed: null,
    createdAt: new Date().toISOString(),
    createdBy: "user-1",
    durationMs: null,
    error: null,
    extracted: extraction(),
    id,
    imageSha256: id.padEnd(64, "0"),
    inputTokens: null,
    matched: null,
    model: "mock",
    outputTokens: null,
    pages: 1,
    provider: "mock",
    purchaseId: null,
    status: "extracted",
    storagePath: `${STORE}/${id}.jpg`,
    storeId: STORE,
    supplierId: null,
    usagePages: 1,
    ...row,
  } as InvoiceScanRow);
}

function confirmedWith(number: string, overrides: Partial<InvoiceExtraction> = {}) {
  return {
    status: "confirmed",
    supplierId: CATIA,
    purchaseId: "purchase-f12",
    confirmed: {
      confirmedAt: "2026-10-26T10:00:00.000Z",
      extraction: extraction({ number, ...overrides }),
      lines: [],
      purchaseId: "purchase-f12",
      supplierId: CATIA,
    },
  } as Partial<InvoiceScanRow>;
}

describe("POST /api/purchases/invoice-scan/duplicates · REP14-01 (número efectivo, D63)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("f12: previo sin número leído y confirmado 00001028; el actual teclea 00001028 → duplicado", async () => {
    seed(PREVIO, { ...confirmedWith("00001028"), extracted: extraction({ number: "" }) });
    seed(ACTUAL, { extracted: extraction({ number: "00901028" }) });

    const response = await post({ scanId: ACTUAL, supplierId: CATIA, number: "00001028", date: "2026-10-08", total: 315708.83 });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([
      { scanId: PREVIO, purchaseId: "purchase-f12", number: "00001028", date: "2026-10-08" },
    ]);
  });

  it("previo leído X y confirmado Y: cuenta Y (también sin fecha ni total en la consulta)", async () => {
    seed(PREVIO, { ...confirmedWith("00001028"), extracted: extraction({ number: "00901028" }) });

    const byConfirmed = await post({ supplierId: CATIA, number: "00001028" });
    expect((await byConfirmed.json()).data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);

    const byRead = await post({ supplierId: CATIA, number: "00901028" });
    expect((await byRead.json()).data).toEqual([]);
  });

  it("confirmado con número vacío: cuenta el leído", async () => {
    seed(PREVIO, { ...confirmedWith("  "), extracted: extraction({ number: "00001028" }) });

    const response = await post({ supplierId: CATIA, number: "00001028" });

    expect((await response.json()).data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
  });
});
