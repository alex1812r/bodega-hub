/**
 * @jest-environment node
 */
/**
 * REP12-06 · `POST /api/purchases/invoice-scan/duplicates`:
 * - B-qa-rep12-01-1: el tope de candidatos (50 más recientes con el mismo número) se aplicaba
 *   ANTES de filtrar por proveedor; un número repetido con otros proveedores ocultaba el duplicado.
 * - B-qa-rep12-01-2: los 400 de zod devolvían mensajes en inglés.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { PREVIOUS_SCANS_LIMIT } from "@/modules/invoice-scan/server/loadMatchContext";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-rep12-06";
const NORTE = "contact-norte";
const CAOS = "contact-caos";
const PREVIO = "00000000-0000-4000-8000-00000000e001";

function post(body: unknown) {
  return POST(
    new Request(URL, {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "almacen", "x-demo-store-id": STORE },
      method: "POST",
    }),
  );
}

function seed(id: string, createdAt: string, row: Partial<InvoiceScanRow>) {
  putMockScanRow({
    confirmed: null,
    createdAt,
    createdBy: "user-1",
    durationMs: null,
    error: null,
    extracted: {
      supplier: { name: "Proveedor" },
      number: "00001234",
      date: "2026-10-20",
      currency: "VES",
      lines: [],
      total: 464,
      confidence: 0.9,
      warnings: [],
    } as InvoiceExtraction,
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

/** Inglés de zod por defecto («Invalid input: expected …», «Unrecognized key», «Too small…»). */
const ZOD_ENGLISH = /\b(invalid|expected|received|unrecognized|too (small|big)|required)\b/i;

describe("POST /api/purchases/invoice-scan/duplicates · REP12-06", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("B-qa-rep12-01-1: más de 50 escaneos más nuevos con el mismo número de OTRO proveedor no ocultan el duplicado", async () => {
    seed(PREVIO, "2026-10-01T10:00:00.000Z", { status: "confirmed", supplierId: CAOS, purchaseId: "purchase-caos" });
    for (let index = 0; index < PREVIOUS_SCANS_LIMIT + 10; index += 1) {
      const suffix = String(index).padStart(3, "0");
      seed(`00000000-0000-4000-8000-000000f00${suffix}`, `2026-10-02T10:${suffix.slice(1)}:00.000Z`, { supplierId: NORTE });
    }

    const body = await (await post({ supplierId: CAOS, number: "00001234" })).json();

    expect(body.data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
  });

  it("B-qa-rep12-01-1 (fecha + total, sin número): más de 50 escaneos más nuevos con la misma fecha y total de OTRO proveedor no ocultan el posible duplicado", async () => {
    seed(PREVIO, "2026-10-01T10:00:00.000Z", { status: "confirmed", supplierId: CAOS, purchaseId: "purchase-caos" });
    for (let index = 0; index < PREVIOUS_SCANS_LIMIT + 10; index += 1) {
      const suffix = String(index).padStart(3, "0");
      seed(`00000000-0000-4000-8000-000000f00${suffix}`, `2026-10-02T10:${suffix.slice(1)}:00.000Z`, { supplierId: NORTE });
    }

    const body = await (await post({ supplierId: CAOS, date: "2026-10-20", total: 464 })).json();

    expect(body.data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
  });

  it.each([
    ["total como texto", { supplierId: NORTE, date: "2026-10-20", total: "5" }],
    ["campo desconocido", { supplierId: NORTE, number: "1", extra: "x" }],
    ["proveedor numérico", { supplierId: 5, number: "1" }],
    ["número numérico", { supplierId: NORTE, number: 1234 }],
    ["RIF numérico", { taxId: 123, number: "1" }],
    ["fecha numérica", { supplierId: NORTE, date: 20261020, total: 1 }],
    ["escaneo numérico", { scanId: 1, supplierId: NORTE, number: "1" }],
    ["cuerpo que no es objeto", [1, 2]],
    ["cuerpo null", "null"],
  ])("B-qa-rep12-01-2: 400 con todos los mensajes en español (%s)", async (_label, body) => {
    const response = await post(body);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("BAD_REQUEST");
    // REP12-06b: sin los detalles internos de zod (expected, keys, code…): solo el mensaje y la ruta del campo.
    const leaked = (json.error.issues ?? []).flatMap((issue: Record<string, unknown>) => Object.keys(issue).filter((key) => key !== "message" && key !== "path"));
    expect(leaked).toEqual([]);
    const messages = [json.error.message, ...(json.error.issues ?? []).map((issue: { message: string }) => issue.message)];
    expect(messages.filter((message: string) => ZOD_ENGLISH.test(message))).toEqual([]);
  });
});
