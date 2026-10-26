/**
 * @jest-environment node
 */
/**
 * REP14-05 (M-qa1401-1, mismo criterio que D63) · `POST /api/purchases/invoice-scan/duplicates`:
 * un escaneo previo casa por fecha + total si casa su fecha/total LEÍDOS o los EFECTIVOS (los
 * confirmados en `confirmed.extraction` si no están vacíos, si no los leídos). QA REP14-01 §5b
 * (s5, s6): previo de Market Catia sin número con la fecha o el total corregidos al confirmar; la
 * revisión con el valor corregido daba n=0 y la factura se podía registrar dos veces.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-rep14-05-store";
const CATIA = "contact-market-catia";
const PREVIO = "00000000-0000-4000-8000-00000000f005";

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
    date: "2020-07-05",
    currency: "VES",
    lines: [],
    total: 7705.05,
    confidence: 0.9,
    warnings: [],
    ...overrides,
  } as InvoiceExtraction;
}

function seed(read: Partial<InvoiceExtraction>, confirmed: Partial<InvoiceExtraction>) {
  putMockScanRow({
    confirmed: {
      confirmedAt: "2026-10-26T10:00:00.000Z",
      extraction: extraction({ ...read, ...confirmed }),
      lines: [],
      purchaseId: "purchase-s5",
      supplierId: CATIA,
    },
    createdAt: new Date().toISOString(),
    createdBy: "user-1",
    durationMs: null,
    error: null,
    extracted: extraction(read),
    id: PREVIO,
    imageSha256: PREVIO.padEnd(64, "0"),
    inputTokens: null,
    matched: null,
    model: "mock",
    outputTokens: null,
    pages: 1,
    provider: "mock",
    purchaseId: "purchase-s5",
    status: "confirmed",
    storagePath: `${STORE}/${PREVIO}.jpg`,
    storeId: STORE,
    supplierId: CATIA,
    usagePages: 1,
  } as InvoiceScanRow);
}

const scanIds = async (response: Response) =>
  ((await response.json()).data as { scanId: string }[]).map((match) => match.scanId);

describe("POST /api/purchases/invoice-scan/duplicates · REP14-05 (fecha y total confirmados)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("s5: fecha leída 2020-07-05 y confirmada 2026-07-05; la revisión con la fecha corregida avisa", async () => {
    seed({ date: "2020-07-05" }, { date: "2026-07-05" });

    const corrected = await post({ supplierId: CATIA, date: "2026-07-05", total: 7705.05 });
    expect(corrected.status).toBe(200);
    expect(await scanIds(corrected)).toEqual([PREVIO]);
    expect(await scanIds(await post({ supplierId: CATIA, date: "2020-07-05", total: 7705.05 }))).toEqual([PREVIO]);
  });

  it("s6: total leído 7760.06 y confirmado 7706.06; con el total corregido avisa, y con el leído también", async () => {
    seed({ date: "2026-07-06", total: 7760.06 }, { total: 7706.06 });

    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-07-06", total: 7706.06 }))).toEqual([PREVIO]);
    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-07-06", total: 7760.06 }))).toEqual([PREVIO]);
  });

  it("el cuerpo devuelve la fecha efectiva (la confirmada), como el número", async () => {
    seed({ date: "2020-07-05" }, { date: "2026-07-05" });

    expect((await (await post({ supplierId: CATIA, date: "2026-07-05", total: 7705.05 })).json()).data).toEqual([
      { scanId: PREVIO, purchaseId: "purchase-s5", number: "", date: "2026-07-05" },
    ]);
  });

  it("ni la fecha leída ni la confirmada: no avisa", async () => {
    seed({ date: "2020-07-05" }, { date: "2026-07-05" });

    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-07-07", total: 7705.05 }))).toEqual([]);
  });
});
