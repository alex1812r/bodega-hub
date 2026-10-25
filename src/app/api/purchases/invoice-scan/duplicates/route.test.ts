/**
 * @jest-environment node
 */
/**
 * REP12-01 (M-p12-1, M-p12A-1; D52 + D53) · `POST /api/purchases/invoice-scan/duplicates`:
 * solo lectura. Con el proveedor ELEGIDO en la revisión (y el contacto y el RIF leídos),
 * número o fecha + total, devuelve los escaneos de la tienda que serían la misma factura
 * (misma regla que `matched.duplicateOfScanId`). Por POST: el número es texto de la factura
 * y no va en la URL (D35). Permiso `purchases.create`.
 */
import type { InvoiceExtraction } from "@/modules/invoice-scan/contracts";
import { putMockScanRow, resetMockScanStore } from "@/modules/invoice-scan/server/scans.mock-server";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";
import { mockContacts } from "@/shared/mocks/erp-data";

import { POST } from "./route";

const URL = "http://localhost/api/purchases/invoice-scan/duplicates";
const STORE = "route-duplicates-store";
const NORTE = "contact-norte";
const CAOS = "contact-caos";
const PREVIO = "00000000-0000-4000-8000-00000000d001";
const ACTUAL = "00000000-0000-4000-8000-00000000d002";

function post(body: unknown, role = "almacen", storeId = STORE) {
  return POST(
    new Request(URL, {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": role, "x-demo-store-id": storeId },
      method: "POST",
    }),
  );
}

function extraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    supplier: { name: "Distribuidora Caos Global C.A." },
    number: "DUP12-1",
    date: "2026-10-20",
    currency: "VES",
    lines: [],
    total: 464,
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

describe("POST /api/purchases/invoice-scan/duplicates", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    resetMockScanStore();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each([
    ["admin", 200],
    ["almacen", 200],
    ["contador", 403],
    ["vendedor", 403],
  ])("responde a %s con %i (permiso purchases.create)", async (role, status) => {
    expect((await post({ supplierId: NORTE, number: "1" }, role)).status).toBe(status);
  });

  it("sin sesión responde 401", async () => {
    const originalDemoAuth = process.env.ALLOW_DEMO_AUTH;
    process.env.ALLOW_DEMO_AUTH = "false";
    const response = await POST(
      new Request(URL, { body: "{}", headers: { "content-type": "application/json" }, method: "POST" }),
    );

    process.env.ALLOW_DEMO_AUTH = originalDemoAuth;

    expect(response.status).toBe(401);
  });

  it("f19/D2: 1.ª compra con el proveedor elegido a mano (nada leído); el actual elige el mismo → duplicado", async () => {
    seed(PREVIO, { status: "confirmed", supplierId: NORTE, purchaseId: "purchase-1" });
    seed(ACTUAL, {});

    const response = await post({ scanId: ACTUAL, supplierId: NORTE, number: "dup12-1", date: "2026-10-20", total: 464 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: [{ scanId: PREVIO, purchaseId: "purchase-1", number: "DUP12-1", date: "2026-10-20" }],
    });
  });

  it("D3d: 1.ª compra con otro proveedor, leído el mismo contacto → duplicado por el leído", async () => {
    seed(PREVIO, {
      status: "confirmed",
      supplierId: NORTE,
      purchaseId: "purchase-1",
      matched: { supplier: { contactId: CAOS }, lines: [], totals: { computed: 464, mismatch: false } },
    });

    const body = await (await post({ supplierId: CAOS, contactId: CAOS, number: "DUP12-1" })).json();

    expect(body.data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
  });

  it("D5: sin coincidencia de número exacto, número a un carácter con misma fecha y total → posible duplicado", async () => {
    seed(PREVIO, { status: "confirmed", supplierId: NORTE, purchaseId: "purchase-1" });

    const body = await (await post({ supplierId: NORTE, number: "DUP12-2", date: "2026-10-20", total: 464 })).json();

    expect(body.data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
  });

  it("otro proveedor y otro RIF: sin duplicados; el propio escaneo nunca cuenta", async () => {
    seed(PREVIO, { status: "confirmed", supplierId: NORTE, purchaseId: "purchase-1" });

    expect((await (await post({ supplierId: CAOS, number: "DUP12-1" })).json()).data).toEqual([]);
    expect((await (await post({ scanId: PREVIO, supplierId: NORTE, number: "DUP12-1" })).json()).data).toEqual([]);
  });

  describe("RIF del proveedor elegido o del previo, resuelto desde contacts de la tienda (D53)", () => {
    const CON_RIF = "contact-rep12-rif";
    const RIF = "J-40999888-1";

    function addContact(storeId: string) {
      mockContacts.push({
        address: "",
        email: "",
        id: CON_RIF,
        isActive: true,
        name: "Proveedor con RIF",
        phone: "",
        storeId,
        taxId: RIF,
        type: "proveedor",
      });
    }

    afterEach(() => {
      for (let index = mockContacts.length - 1; index >= 0; index -= 1) {
        if (mockContacts[index].id === CON_RIF) {
          mockContacts.splice(index, 1);
        }
      }
    });

    it("RIF del proveedor ELEGIDO actual = RIF leído del escaneo previo → duplicado", async () => {
      addContact(STORE);
      seed(PREVIO, {
        status: "confirmed",
        supplierId: NORTE,
        purchaseId: "purchase-1",
        extracted: extraction({ supplier: { name: "Otro nombre", taxId: "J409998881" } }),
      });

      const body = await (await post({ supplierId: CON_RIF, number: "DUP12-1" })).json();

      expect(body.data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
    });

    it("RIF del proveedor elegido del previo = RIF leído actual → duplicado", async () => {
      addContact(STORE);
      seed(PREVIO, { status: "confirmed", supplierId: CON_RIF, purchaseId: "purchase-1" });

      const body = await (await post({ supplierId: NORTE, taxId: "j-40999888-1", number: "DUP12-1" })).json();

      expect(body.data.map((match: { scanId: string }) => match.scanId)).toEqual([PREVIO]);
    });

    it("el contacto de otra tienda no aporta su RIF", async () => {
      addContact("otra-tienda");
      seed(PREVIO, {
        status: "confirmed",
        supplierId: NORTE,
        purchaseId: "purchase-1",
        extracted: extraction({ supplier: { name: "Otro nombre", taxId: RIF } }),
      });

      expect((await (await post({ supplierId: CON_RIF, number: "DUP12-1" })).json()).data).toEqual([]);
    });
  });

  it.each([
    ["no es JSON", "{"],
    ["sin proveedor ni número", {}],
    ["sin número ni fecha + total", { supplierId: NORTE }],
    ["proveedor con caracteres no válidos", { supplierId: "../x", number: "1" }],
    ["escaneo que no es uuid", { scanId: "scan-1", supplierId: NORTE, number: "1" }],
    ["número demasiado largo", { supplierId: NORTE, number: "1".repeat(65) }],
    ["fecha no ISO", { supplierId: NORTE, date: "20/10/2026", total: 1 }],
    ["total negativo", { supplierId: NORTE, date: "2026-10-20", total: -1 }],
    ["campo desconocido", { supplierId: NORTE, number: "1", extra: "x" }],
  ])("responde 400 con un cuerpo inválido (%s)", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BAD_REQUEST");
  });
});
