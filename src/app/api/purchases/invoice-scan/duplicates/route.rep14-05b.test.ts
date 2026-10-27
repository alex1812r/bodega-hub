/**
 * @jest-environment node
 */
/**
 * REP14-05b · `POST /api/purchases/invoice-scan/duplicates` (mock, paridad con 20261026a/19q): la
 * fecha confirmada guardada como DD/MM/AAAA («14/10/2026», 7 escaneos así en el lab) casa con la
 * fecha ISO de la revisión; un total confirmado guardado como texto con ceros («27895.00») casa con
 * 27895; una fecha o un total confirmados basura no casan y no rompen la consulta.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-rep14-05b-store";
const CATIA = "contact-market-catia";
const PREVIO = "00000000-0000-4000-8000-00000000f05b";

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

function seed(read: Partial<InvoiceExtraction>, confirmed: Record<string, unknown>) {
  putMockScanRow({
    confirmed: {
      confirmedAt: "2026-10-26T10:00:00.000Z",
      extraction: { ...extraction(read), ...confirmed },
      lines: [],
      purchaseId: "purchase-previa",
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
    purchaseId: "purchase-previa",
    status: "confirmed",
    storagePath: `${STORE}/${PREVIO}.jpg`,
    storeId: STORE,
    supplierId: CATIA,
    usagePages: 1,
  } as InvoiceScanRow);
}

const scanIds = async (response: Response) => {
  expect(response.status).toBe(200);
  return ((await response.json()).data as { scanId: string }[]).map((match) => match.scanId);
};

describe("POST /api/purchases/invoice-scan/duplicates · REP14-05b (fecha DD/MM/AAAA y total con ceros)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("fecha confirmada 14/10/2026 (leída 2026-10-12): la revisión con 2026-10-14 avisa", async () => {
    seed({ date: "2026-10-12" }, { date: "14/10/2026" });

    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-10-14", total: 24138.02 }))).toEqual([PREVIO]);
  });

  it("fecha leída 7-10-2026: la revisión con 2026-10-07 avisa", async () => {
    seed({ date: "7-10-2026" }, {});

    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-10-07", total: 24138.02 }))).toEqual([PREVIO]);
  });

  it("total confirmado como texto «27895.00» (leído 27000): la revisión con 27895 avisa", async () => {
    seed({ date: "2026-10-20", total: 27000 }, { total: "27895.00" });

    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-10-20", total: 27895 }))).toEqual([PREVIO]);
  });

  it("fecha y total confirmados basura: casa por los leídos y no rompe", async () => {
    seed({ date: "2026-10-12" }, { date: "14/10/26xx", total: "27.895,00 Bs" });

    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-10-12", total: 24138.02 }))).toEqual([PREVIO]);
    expect(await scanIds(await post({ supplierId: CATIA, date: "2026-10-14", total: 24138.02 }))).toEqual([]);
  });
});
