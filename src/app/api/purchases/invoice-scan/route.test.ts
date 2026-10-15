/**
 * @jest-environment node
 */

jest.mock("../../../../modules/invoice-scan/server/provider", () => ({
  createInvoiceScanModel: jest.fn(),
}));
jest.mock("../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import type { MockLanguageModelV4 } from "ai/test";

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { jpegHeader } from "@/modules/invoice-scan/server/__fixtures__/images";
import { createMockInvoiceScanModel } from "@/modules/invoice-scan/server/mockModel";
import { createInvoiceScanModel } from "@/modules/invoice-scan/server/provider";
import { INVOICE_SCAN_REAL_SESSION_MESSAGE } from "@/modules/invoice-scan/server/requireScanSession";
import type { InvoiceScanRow } from "@/modules/invoice-scan/server/scans.types";
import { sha256OfPages } from "@/modules/invoice-scan/server/storage";
import { mockState } from "@/shared/mocks/mockStore";

import { POST } from "./route";

const URL_BASE = "http://localhost/api/purchases/invoice-scan";

let model: MockLanguageModelV4;
let counter = 0;

/** Tienda e imagen únicas por test: el mock vive en memoria global. */
function fresh() {
  counter += 1;
  return { image: `factura-${counter}-${Date.now()}`, storeId: `route-scan-${counter}` };
}

/** JPEG válido (pasa inspectInvoiceImage) con bytes distintos por `text`. */
function bytes(text: string) {
  return jpegHeader(1600, 1200, text);
}

function multipart(store: string, pages: string[], fields: Record<string, string> = {}, role = "almacen") {
  const form = new FormData();
  pages.forEach((text, index) =>
    form.append("page", new File([new Uint8Array(bytes(text))], `p${index + 1}.jpg`, { type: "image/jpeg" })),
  );
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));

  return new Request(URL_BASE, {
    body: form,
    headers: { "x-demo-role": role, "x-demo-store-id": store },
    method: "POST",
  });
}

function jsonRequest(store: string, body: string) {
  return new Request(URL_BASE, {
    body,
    headers: { "content-type": "application/json", "x-demo-role": "almacen", "x-demo-store-id": store },
    method: "POST",
  });
}

function rowByHash(storeId: string, sha: string) {
  const rows = mockState("invoice-scan:scans", () => new Map<string, InvoiceScanRow>());
  return [...rows.values()].find((row) => row.storeId === storeId && row.imageSha256 === sha) ?? null;
}

describe("POST /api/purchases/invoice-scan", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    model = createMockInvoiceScanModel();
    (createInvoiceScanModel as jest.Mock).mockReturnValue({
      model,
      modelId: "invoice-scan-mock",
      provider: "mock",
    });
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("responde 401 sin sesión", async () => {
    process.env.ALLOW_DEMO_AUTH = "false";
    const { image, storeId } = fresh();

    expect((await POST(multipart(storeId, [image]))).status).toBe(401);
  });

  it("con datos en Supabase, la sesión demo (ALLOW_DEMO_AUTH) responde 401 sin tocar la base ni el modelo (caos-4 M2)", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    process.env.ALLOW_DEMO_AUTH = "true";
    (createAdminSupabaseClient as jest.Mock).mockClear();
    const { image } = fresh();

    const response = await POST(multipart("00000000-0000-4000-8000-000000000001", [image], {}, "admin"));

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe(INVOICE_SCAN_REAL_SESSION_MESSAGE);
    expect(createAdminSupabaseClient).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("responde 403 al vendedor (sin purchases.create)", async () => {
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [image], {}, "vendedor"));

    expect(response.status).toBe(403);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("200 con extraction, matched y limits", async () => {
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [image]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      cached: false,
      extraction: { currency: "VES", lines: expect.any(Array) },
      limits: { limit: 50, remaining: 49, used: 1 },
      matched: { lines: expect.any(Array), supplier: {}, totals: { computed: expect.any(Number) } },
      scanId: expect.any(String),
    });
    expect(body.data.extraction.lines).toHaveLength(2);
    expect(body.data.matched.lines).toHaveLength(2);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("la misma imagen otra vez responde del caché sin llamar al modelo", async () => {
    const { image, storeId } = fresh();
    const first = await (await POST(multipart(storeId, [image]))).json();
    const callsAfterFirst = model.doGenerateCalls.length;

    const response = await POST(multipart(storeId, [image]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ ...first.data, cached: true });
    expect(model.doGenerateCalls.length - callsAfterFirst).toBe(0);
  });

  it("429 en español con límite 2 y 3 páginas", async () => {
    process.env.INVOICE_SCAN_DAILY_LIMIT = "2";
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [`${image}-1`, `${image}-2`, `${image}-3`]));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatchObject({
      code: "INVOICE_SCAN_LIMIT_REACHED",
      details: { limit: 2, used: 0 },
      message: expect.stringMatching(/^Alcanzaste el límite de 2 páginas escaneadas por día/),
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("un PDF de 5 páginas hace 5 llamadas y cuenta 5 en la cuota", async () => {
    process.env.INVOICE_SCAN_DAILY_LIMIT = "5";
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [1, 2, 3, 4, 5].map((n) => `${image}-p${n}`)));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.limits).toEqual({ limit: 5, remaining: 0, used: 5 });
    expect(model.doGenerateCalls).toHaveLength(5);

    const other = fresh();
    process.env.INVOICE_SCAN_DAILY_LIMIT = "4";
    const blocked = await POST(multipart(other.storeId, [1, 2, 3, 4, 5].map((n) => `${other.image}-p${n}`)));

    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.details).toEqual({ limit: 4, used: 0 });
  });

  it("modo error: 502 en español, fila failed y el reintento reutiliza la misma fila", async () => {
    process.env.INVOICE_SCAN_MOCK_MODE = "error";
    const { image, storeId } = fresh();
    const sha = sha256OfPages([bytes(image)]);

    const failed = await POST(multipart(storeId, [image]));
    const row = rowByHash(storeId, sha);

    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatchObject({
      code: "INVOICE_SCAN_PROVIDER_ERROR",
      message: expect.stringMatching(/servicio de IA no está disponible/),
    });
    expect(row).toMatchObject({ error: "PROVIDER_ERROR", status: "failed" });

    process.env.INVOICE_SCAN_MOCK_MODE = "ok";
    const retry = await POST(multipart(storeId, [image]));

    expect(retry.status).toBe(200);
    expect((await retry.json()).data.scanId).toBe(row?.id);
    expect(rowByHash(storeId, sha)).toMatchObject({ error: null, status: "extracted" });
  });

  it("modo empty: lines [] con el aviso del modelo", async () => {
    process.env.INVOICE_SCAN_MOCK_MODE = "empty";
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [image]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.extraction.lines).toEqual([]);
    expect(body.data.extraction.warnings).toEqual(["No parece una factura."]);
    expect(body.data.matched.lines).toEqual([]);
  });

  it("400 si el sha256 no coincide con las páginas", async () => {
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [image], { sha256: "f".repeat(64) }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/hash de la factura no coincide/);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("acepta el sha256 correcto del cliente", async () => {
    const { image, storeId } = fresh();

    const response = await POST(multipart(storeId, [image], { sha256: sha256OfPages([bytes(image)]) }));

    expect(response.status).toBe(200);
  });

  it("413 en español si una página pasa de 1 MB", async () => {
    const { storeId } = fresh();
    const form = new FormData();
    form.append("page", new File([new Uint8Array(1_048_577)], "big.jpg", { type: "image/jpeg" }));

    const response = await POST(
      new Request(URL_BASE, {
        body: form,
        headers: { "x-demo-role": "almacen", "x-demo-store-id": storeId },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: expect.stringMatching(/pesa más de 1 MB/),
    });
  });

  it("400 si una ruta de Storage es de otra tienda", async () => {
    const { image, storeId } = fresh();
    const sha = sha256OfPages([bytes(image)]);

    const response = await POST(
      jsonRequest(storeId, JSON.stringify({ sha256: sha, storagePaths: [`otra-tienda/${sha}/p1.jpg`] })),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("La ruta de la factura no es válida.");
  });

  it("forma JSON: 404 si la página no se subió a Storage", async () => {
    const { image, storeId } = fresh();
    const sha = sha256OfPages([bytes(image)]);

    const response = await POST(
      jsonRequest(storeId, JSON.stringify({ sha256: sha, storagePaths: [`${storeId}/${sha}/p1.jpg`] })),
    );

    expect(response.status).toBe(404);
  });

  it("si el cliente corta, la llamada al modelo se cancela, responde 502 sin esperar al timeout y queda CLIENT_ABORTED", async () => {
    process.env.INVOICE_SCAN_MOCK_MODE = "timeout";
    const { image, storeId } = fresh();
    const controller = new AbortController();
    const base = multipart(storeId, [image]);
    const request = new Request(base, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    const response = await POST(request);

    expect(response.status).toBe(502);
    expect(rowByHash(storeId, sha256OfPages([bytes(image)]))).toMatchObject({
      error: "CLIENT_ABORTED",
      status: "failed",
      usagePages: 1,
    });
  }, 5000);

  it("413 en español que sugiere upload-url si el multipart pasa de 4 MB en total", async () => {
    const { storeId } = fresh();
    const form = new FormData();
    for (let index = 0; index < 5; index += 1) {
      form.append("page", new File([new Uint8Array(900 * 1024)], `p${index}.jpg`, { type: "image/jpeg" }));
    }

    const response = await POST(
      new Request(URL_BASE, {
        body: form,
        headers: { "x-demo-role": "almacen", "x-demo-store-id": storeId },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: expect.stringMatching(/4 MB.*upload-url/),
    });
  });

  it("413 por content-length de más de 4 MB sin leer el cuerpo", async () => {
    const { image, storeId } = fresh();
    const base = multipart(storeId, [image]);
    const headers = new Headers(base.headers);
    headers.set("content-length", String(4 * 1024 * 1024 + 1));

    const response = await POST(new Request(base, { headers }));

    expect(response.status).toBe(413);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("400 sin cobrar si la página no es una imagen (un .exe declarado como JPEG)", async () => {
    const { storeId } = fresh();
    const form = new FormData();
    form.append("page", new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "factura.jpg", { type: "image/jpeg" }));

    const response = await POST(
      new Request(URL_BASE, {
        body: form,
        headers: { "x-demo-role": "almacen", "x-demo-store-id": storeId },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("forma JSON: 400 con un cuerpo que no es JSON o sin rutas", async () => {
    const { storeId } = fresh();

    const empty = await POST(jsonRequest(storeId, JSON.stringify({ sha256: "a".repeat(64), storagePaths: [] })));
    const broken = await POST(jsonRequest(storeId, "{roto"));

    expect(empty.status).toBe(400);
    expect(broken.status).toBe(400);
  });
});
