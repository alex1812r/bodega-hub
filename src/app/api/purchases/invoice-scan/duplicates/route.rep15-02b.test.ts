/**
 * @jest-environment node
 */
/**
 * REP15-02b (QA REP15-02, B-qa1502-1) · `POST /api/purchases/invoice-scan/duplicates` (mock, paridad con
 * 20261026a): un número confirmado con un blanco Unicode, tabulador o punto AL FINAL es el mismo número
 * (`normalizeInvoiceNumber`) y la consulta por número lo encuentra. En SQL lo cubre `invoice_number_key`.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-rep15-02b-store";
const CATIA = "contact-market-catia";
const PREVIO = "00000000-0000-4000-8000-0000000f1502";

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
    date: "2026-10-12",
    currency: "VES",
    lines: [],
    total: 24138.02,
    confidence: 0.9,
    warnings: [],
    ...overrides,
  } as InvoiceExtraction;
}

function seed(supplierId: string, read: Partial<InvoiceExtraction>, confirmed: Record<string, unknown>) {
  putMockScanRow({
    confirmed: {
      confirmedAt: "2026-10-26T10:00:00.000Z",
      extraction: { ...extraction(read), ...confirmed },
      lines: [],
      purchaseId: "purchase-previa",
      supplierId,
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
    purchaseId: "purchase-previa",
    status: "confirmed",
    storagePath: `${STORE}/${PREVIO}.jpg`,
    storeId: STORE,
    supplierId,
    usagePages: 1,
  } as InvoiceScanRow);
}

const scanIds = async (response: Response) => {
  expect(response.status).toBe(200);
  return ((await response.json()).data as { scanId: string }[]).map((match) => match.scanId);
};

describe("POST /api/purchases/invoice-scan/duplicates · REP15-02b", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each([
    ["NBSP al final", "QA-R15-0203\u00a0"],
    ["U+3000 al final", "QA-R15-0203\u3000"],
    ["tabulador al final", "QA-R15-0203\t"],
    ["U+202F al final y NBSP en medio", "QA\u00a0R15-0203\u202f"],
    ["punto al final", "QA-R15-0203."],
  ])("número confirmado con %s: la consulta por número lo encuentra (B-qa1502-1)", async (_label, number) => {
    seed(CATIA, { number: "00001234" }, { number });

    expect(await scanIds(await post({ supplierId: CATIA, number: "QAR15-0203" }))).toEqual([PREVIO]);
  });

  it("control: otro número no casa", async () => {
    seed(CATIA, { number: "00001234" }, { number: "QA-R15-0203\u00a0" });

    expect(await scanIds(await post({ supplierId: CATIA, number: "QAR15-0204" }))).toEqual([]);
  });
});
