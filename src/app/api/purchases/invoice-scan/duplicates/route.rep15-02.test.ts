/**
 * @jest-environment node
 */
/**
 * REP15-02 · `POST /api/purchases/invoice-scan/duplicates` (mock, paridad con 20261026a):
 * - B-p16-1: la fecha confirmada con espacios Unicode o tabuladores (también en medio) casa con la
 *   fecha ISO de la revisión, como la compra bl del lab con «05/06/2025\u00a0».
 * - B-p16Q-2: un RIF de relleno («J-00000000-0») no hace «mismo proveedor» entre proveedores
 *   distintos (QA p16: Market Catia + J-00000000-0 devolvía 3 escaneos de Farmatodo).
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-rep15-02-store";
const CATIA = "contact-market-catia";
const FARMATODO = "contact-farmatodo";
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

describe("POST /api/purchases/invoice-scan/duplicates · REP15-02", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each([
    ["NBSP al final", "05/06/2025\u00a0"],
    ["tabulador al final", "05/06/2025\t"],
    ["U+3000 y NBSP en medio", "05/\u300006/\u00a02025"],
  ])("fecha confirmada con %s: la revisión con 2025-06-05 avisa (B-p16-1)", async (_label, date) => {
    seed(CATIA, { date: "2026-10-12" }, { date });

    expect(await scanIds(await post({ supplierId: CATIA, date: "2025-06-05", total: 24138.02 }))).toEqual([PREVIO]);
  });

  it("RIF de relleno en los dos lados y proveedores distintos: no es duplicado (B-p16Q-2)", async () => {
    seed(FARMATODO, { number: "00362952", supplier: { name: "Farmatodo", taxId: "J-00000000-0" } }, {});

    expect(await scanIds(await post({ supplierId: CATIA, taxId: "J-00000000-0", number: "00362952" }))).toEqual([]);
    expect(
      await scanIds(await post({ supplierId: CATIA, taxId: "J-00000000-0", date: "2026-10-12", total: 24138.02 })),
    ).toEqual([]);
  });

  it("control: el mismo proveedor con RIF de relleno sigue avisando por su id", async () => {
    seed(FARMATODO, { number: "00362952", supplier: { name: "Farmatodo", taxId: "J-00000000-0" } }, {});

    expect(await scanIds(await post({ supplierId: FARMATODO, taxId: "J-00000000-0", number: "00362952" }))).toEqual([
      PREVIO,
    ]);
  });
});
