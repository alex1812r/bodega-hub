/**
 * @jest-environment node
 */
/**
 * REP12-06 (B-qa-rep12-01-2): los 400 de validación de las rutas del escaneo de factura no dejan
 * pasar mensajes de zod en inglés («Invalid input: expected …», «Unrecognized key», «Too small…»).
 */
jest.mock("../../../../modules/invoice-scan/server/provider", () => ({
  createInvoiceScanModel: jest.fn(),
}));
jest.mock("../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";
import { createMockInvoiceScanModel } from "@/modules/invoice-scan/server/mockModel";
import { createInvoiceScanModel } from "@/modules/invoice-scan/server/provider";

import { GET as getLastUnitCosts } from "./last-unit-costs/route";
import { POST as postScan } from "./route";
import { GET as getUploadUrl } from "./upload-url/route";

const BASE = "http://localhost/api/purchases/invoice-scan";
const HEADERS = { "x-demo-role": "almacen", "x-demo-store-id": "route-zod-rep12-06" };
const HASH = "a".repeat(64);
const ZOD_ENGLISH = /\b(invalid|expected|received|unrecognized|too (small|big)|required)\b/i;

async function englishMessages(response: Response) {
  expect(response.status).toBe(400);
  const json = await response.json();
  expect(json.error.code).toBe("BAD_REQUEST");
  const messages: string[] = [json.error.message, ...(json.error.issues ?? []).map((issue: { message: string }) => issue.message)];
  return messages.filter((message) => ZOD_ENGLISH.test(message));
}

function jsonScan(body: unknown) {
  return postScan(
    new Request(BASE, {
      body: JSON.stringify(body),
      headers: { ...HEADERS, "content-type": "application/json" },
      method: "POST",
    }),
  );
}

function multipartScan(fields: Record<string, string>) {
  const form = new FormData();
  form.append("page", new File([new Uint8Array(jpegHeader(1600, 1200, "rep12-06"))], "p1.jpg", { type: "image/jpeg" }));
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  return postScan(new Request(BASE, { body: form, headers: HEADERS, method: "POST" }));
}

describe("REP12-06 · mensajes de validación en español en invoice-scan", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    (createInvoiceScanModel as jest.Mock).mockReturnValue({
      model: createMockInvoiceScanModel(),
      modelId: "invoice-scan-mock",
      provider: "mock",
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each([
    ["sin páginas", `sha256=${HASH}&types=image/jpeg`],
    ["páginas no numéricas", `sha256=${HASH}&pages=x&types=image/jpeg`],
    ["páginas decimales", `sha256=${HASH}&pages=1.5&types=image/jpeg`],
    ["cero páginas", `sha256=${HASH}&pages=0&types=image/jpeg`],
    ["más de 10 páginas", `sha256=${HASH}&pages=11&types=image/jpeg`],
    ["tipo no permitido", `sha256=${HASH}&pages=1&types=application/pdf`],
    ["sin tipos", `sha256=${HASH}&pages=1`],
    ["sin parámetros", ""],
  ])("GET upload-url: %s", async (_label, query) => {
    expect(await englishMessages(await getUploadUrl(new Request(`${BASE}/upload-url?${query}`, { headers: HEADERS })))).toEqual([]);
  });

  it.each([
    ["sin rutas", { sha256: HASH }],
    ["rutas vacías", { sha256: HASH, storagePaths: [] }],
    ["rutas que no son lista", { sha256: HASH, storagePaths: "x" }],
    ["ruta numérica", { sha256: HASH, storagePaths: [1] }],
    ["ruta demasiado larga", { sha256: HASH, storagePaths: ["x".repeat(301)] }],
    ["más de 10 rutas", { sha256: HASH, storagePaths: Array.from({ length: 11 }, (_, index) => `p${index}.jpg`) }],
    ["proveedor vacío", { sha256: HASH, storagePaths: ["p1.jpg"], supplierId: "" }],
    ["proveedor numérico", { sha256: HASH, storagePaths: ["p1.jpg"], supplierId: 5 }],
    ["sin hash", { storagePaths: ["p1.jpg"] }],
    ["cuerpo que no es objeto", [1]],
  ])("POST JSON: %s", async (_label, body) => {
    expect(await englishMessages(await jsonScan(body))).toEqual([]);
  });

  it.each([
    ["proveedor demasiado largo", { supplierId: "x".repeat(101) }],
    ["hash inválido", { sha256: "z" }],
  ])("POST multipart: %s", async (_label, fields) => {
    expect(await englishMessages(await multipartScan(fields))).toEqual([]);
  });

  it.each([
    ["sin productos", ""],
    ["producto vacío", "productIds="],
    ["proveedor con caracteres no válidos", "productIds=p1&supplierId=../x"],
  ])("GET last-unit-costs: %s", async (_label, query) => {
    expect(
      await englishMessages(await getLastUnitCosts(new Request(`${BASE}/last-unit-costs?${query}`, { headers: HEADERS }))),
    ).toEqual([]);
  });
});
