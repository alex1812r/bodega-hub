/**
 * @jest-environment node
 */
import { ApiError } from "@/lib/api/apiError";
import { mockState } from "@/shared/mocks/mockStore";

import type { InvoiceExtraction } from "../contracts";
import { notAnInvoiceExtraction, singlePageExtraction } from "./__fixtures__/extractions";
import { jpegHeader } from "./__fixtures__/images";
import { InvoiceExtractionError, type ExtractInvoiceResult, type InvoicePage } from "./extract";
import { toFewShotFormat } from "./fewShot";
import { matchScan } from "./matchScan";
import { createMockInvoiceScanModel } from "./mockModel";
import * as mockRepo from "./scans.mock-server";
import { INVOICE_SCAN_STALE_ATTEMPT_MESSAGE, invoiceScanPagePaths, type InvoiceScanRow } from "./scans.types";
import {
  createInvoiceScanDeps,
  discardInvoiceScan,
  getInvoiceScanDetail,
  INVOICE_HASH_MISMATCH_MESSAGE,
  INVOICE_MIXED_TYPES_MESSAGE,
  INVOICE_READ_URL_TTL_SECONDS,
  INVOICE_SCAN_IMAGE_GONE_MESSAGE,
  INVOICE_SCAN_IN_PROGRESS_MESSAGE,
  readUploadedPages,
  scanInvoice,
  type InvoiceScanDeps,
  type InvoiceScanStorage,
} from "./scanService";
import { INVOICE_INVALID_PATH_MESSAGE, INVOICE_MAX_BYTES, sha256OfPages } from "./storage";

/** Lee la fila por hash del estado mock (también las `failed`). */
function failedRow(ctx: { storeId: string }, sha: string) {
  const rows = mockState("invoice-scan:scans", () => new Map<string, InvoiceScanRow>());
  return [...rows.values()].find((row) => row.storeId === ctx.storeId && row.imageSha256 === sha) ?? null;
}

const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";

let storeCounter = 0;

/** Tienda nueva por test: el repositorio mock vive en memoria global. */
function newContext() {
  storeCounter += 1;
  return { storeId: `scan-service-${storeCounter}`, userId: "user-1" };
}

/** JPEG válido (pasa inspectInvoiceImage) con bytes distintos por `text`. */
function page(text: string, mediaType: InvoicePage["mediaType"] = "image/jpeg"): InvoicePage {
  return { data: jpegHeader(1600, 1200, text), mediaType };
}

function extractResult(overrides: Partial<ExtractInvoiceResult> = {}): ExtractInvoiceResult {
  return {
    durationMs: 1200,
    extraction: singlePageExtraction,
    inputTokens: 900,
    modelId: "invoice-scan-mock",
    outputTokens: 300,
    pages: 1,
    provider: "mock",
    ...overrides,
  };
}

function memoryStorage(): InvoiceScanStorage & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();

  return {
    download: jest.fn(async (path: string) => {
      const data = objects.get(path);

      if (!data) {
        throw new ApiError(404, "NOT_FOUND", "no está");
      }

      return data;
    }),
    objects,
    signedReadUrl: jest.fn(async (path: string, ttl: number) => `https://signed.local/${path}?ttl=${ttl}`),
    upload: jest.fn(async (path: string, data: Uint8Array) => {
      objects.set(path, data);
    }),
  };
}

function deps(overrides: Partial<InvoiceScanDeps> = {}) {
  const storage = memoryStorage();
  const extract = jest.fn(async () => extractResult());
  const matcher = jest.fn(matchScan);
  const built: InvoiceScanDeps = {
    dailyLimit: 50,
    dataSource: "mock",
    extract,
    matcher,
    model: () => ({ model: createMockInvoiceScanModel("ok"), modelId: "invoice-scan-mock", provider: "mock" }),
    now: () => new Date(),
    repo: mockRepo,
    storage,
    ...overrides,
  };

  return { built, extract, matcher, storage };
}

describe("scanInvoice · forma multipart", () => {
  it("lee, empareja, sube cada página y guarda la fila extracted con tokens y duración", async () => {
    const ctx = newContext();
    const { built, extract, matcher, storage } = deps();
    const pages = [page("p1"), page("p2")];
    const sha = sha256OfPages(pages.map((item) => item.data));

    const response = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(response).toMatchObject({
      cached: false,
      extraction: singlePageExtraction,
      limits: { limit: 50, remaining: 48, used: 2 },
    });
    expect(response.matched.lines.every((line) => line.status === "unmatched")).toBe(true);
    expect(matcher).toHaveBeenCalledWith(singlePageExtraction, {
      dataSource: "mock",
      scanId: response.scanId,
      storeId: ctx.storeId,
    });
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ fewShot: [], pages }));
    expect([...storage.objects.keys()]).toEqual([
      `${ctx.storeId}/${sha}/p1.jpg`,
      `${ctx.storeId}/${sha}/p2.jpg`,
    ]);

    const row = await mockRepo.getScan(ctx, response.scanId);
    expect(row).toMatchObject({
      durationMs: 1200,
      error: null,
      imageSha256: sha,
      inputTokens: 900,
      outputTokens: 300,
      pages: 2,
      status: "extracted",
      storagePath: `${ctx.storeId}/${sha}/p1.jpg`,
    });
  });

  it("la misma imagen otra vez responde del caché: 0 llamadas al modelo y sin consumir cuota", async () => {
    const ctx = newContext();
    const { built, extract, storage } = deps();
    const first = await scanInvoice(built, ctx, { pages: [page("misma")], source: "upload" });
    const uploads = (storage.upload as jest.Mock).mock.calls.length;

    const second = await scanInvoice(built, ctx, { pages: [page("misma")], source: "upload" });

    expect(second).toEqual({ ...first, cached: true });
    expect(second.limits.used).toBe(1);
    expect(extract).toHaveBeenCalledTimes(1);
    expect((storage.upload as jest.Mock).mock.calls.length).toBe(uploads);
  });

  it("rechaza con 400 un sha256 que no coincide con los bytes", async () => {
    const { built, extract } = deps();

    await expect(
      scanInvoice(built, newContext(), { pages: [page("a")], sha256: "f".repeat(64), source: "upload" }),
    ).rejects.toMatchObject({ message: INVOICE_HASH_MISMATCH_MESSAGE, status: 400 });
    expect(extract).not.toHaveBeenCalled();
  });

  it("acepta el sha256 del cliente cuando coincide", async () => {
    const pages = [page("a")];
    const { built } = deps();

    await expect(
      scanInvoice(built, newContext(), {
        pages,
        sha256: sha256OfPages(pages.map((item) => item.data)),
        source: "upload",
      }),
    ).resolves.toMatchObject({ cached: false });
  });

  it("rechaza páginas con formatos distintos (la ruta de cada página se deriva de la primera)", async () => {
    const { built } = deps();

    await expect(
      scanInvoice(built, newContext(), { pages: [page("a"), page("b", "image/png")], source: "upload" }),
    ).rejects.toMatchObject({ message: INVOICE_MIXED_TYPES_MESSAGE, status: 400 });
  });
});

describe("scanInvoice · cuota diaria", () => {
  it("429 con límite y uso si las páginas no caben, sin llamar al modelo ni subir nada", async () => {
    const { built, extract, storage } = deps({ dailyLimit: 2 });
    const pages = [page("1"), page("2"), page("3")];

    const error = await scanInvoice(built, newContext(), { pages, source: "upload" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "INVOICE_SCAN_LIMIT_REACHED",
      details: { limit: 2, used: 0 },
      status: 429,
    });
    expect((error as ApiError).message).toMatch(/^Alcanzaste el límite de 2 páginas escaneadas por día/);
    expect(extract).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("cada página cuenta: con 5 de 5 entra y la siguiente ya no", async () => {
    const ctx = newContext();
    const { built } = deps({ dailyLimit: 5 });
    const pages = ["1", "2", "3", "4", "5"].map((text) => page(`pdf-${text}`));

    const response = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(response.limits).toEqual({ limit: 5, remaining: 0, used: 5 });
    await expect(scanInvoice(built, ctx, { pages: [page("otra")], source: "upload" })).rejects.toMatchObject({
      details: { limit: 5, used: 5 },
      status: 429,
    });
  });

  it("un escaneo cacheado responde aunque la cuota esté agotada", async () => {
    const ctx = newContext();
    const { built } = deps({ dailyLimit: 1 });

    await scanInvoice(built, ctx, { pages: [page("única")], source: "upload" });

    await expect(scanInvoice(built, ctx, { pages: [page("única")], source: "upload" })).resolves.toMatchObject({
      cached: true,
      limits: { remaining: 0, used: 1 },
    });
  });
});

describe("scanInvoice · fallo del proveedor", () => {
  it("guarda la fila failed con el código (sin contenido) y responde 502 en español", async () => {
    const ctx = newContext();
    const extract = jest.fn(async () => {
      throw new InvoiceExtractionError("TIMEOUT");
    });
    const { built } = deps({ extract });
    const pages = [page("caída")];

    const error = await scanInvoice(built, ctx, { pages, source: "upload" }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      code: "INVOICE_SCAN_PROVIDER_ERROR",
      details: { reason: "TIMEOUT" },
      status: 502,
    });
    expect((error as ApiError).message).toBe(
      "La lectura de la factura tardó demasiado. Intenta de nuevo; si se repite, registra la compra a mano.",
    );

    const sha = sha256OfPages(pages.map((item) => item.data));
    expect(failedRow(ctx, sha)).toMatchObject({ error: "TIMEOUT", extracted: null, status: "failed" });
    expect(await mockRepo.getDailyUsage(ctx, 50)).toMatchObject({ used: 1 });
  });

  it("un error desconocido queda como PROVIDER_ERROR y el reintento reutiliza la fila", async () => {
    const ctx = newContext();
    const failing = deps({
      extract: jest.fn(async () => {
        throw new Error("boom con datos de la factura");
      }),
    });
    const pages = [page("reintento")];

    await expect(scanInvoice(failing.built, ctx, { pages, source: "upload" })).rejects.toMatchObject({
      details: { reason: "PROVIDER_ERROR" },
      status: 502,
    });

    const failed = failedRow(ctx, sha256OfPages(pages.map((item) => item.data)));
    expect(failed).toMatchObject({ error: "PROVIDER_ERROR", status: "failed" });

    const { built } = deps({ storage: failing.storage });
    const retry = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(retry.scanId).toBe(failed?.id);
    const row = await mockRepo.getScan(ctx, retry.scanId);

    expect(row).toMatchObject({ error: null, provider: "mock", status: "extracted" });
    // Cada intento cobra sus páginas: el fallido y el reintento.
    expect(await mockRepo.getDailyUsage(ctx, 50)).toMatchObject({ used: 2 });
  });

  it("registra provider y model del modelo resuelto", async () => {
    const ctx = newContext();
    const { built } = deps({
      extract: jest.fn(async () => {
        throw new InvoiceExtractionError("QUOTA");
      }),
      model: () => ({ model: createMockInvoiceScanModel("ok"), modelId: "gemini-x", provider: "google" }),
    });
    const pages = [page("cuota")];

    await expect(scanInvoice(built, ctx, { pages, source: "upload" })).rejects.toMatchObject({ status: 502 });

    expect(failedRow(ctx, sha256OfPages(pages.map((item) => item.data)))).toMatchObject({
      error: "QUOTA",
      extracted: null,
      model: "gemini-x",
      provider: "google",
      status: "failed",
    });
  });
});

describe("scanInvoice · no es una factura", () => {
  it("se guarda igual con lines [] y el aviso del modelo", async () => {
    const ctx = newContext();
    const { built } = deps({
      extract: jest.fn(async () => extractResult({ extraction: notAnInvoiceExtraction })),
    });

    const response = await scanInvoice(built, ctx, { pages: [page("paisaje")], source: "upload" });

    expect(response.extraction.lines).toEqual([]);
    expect(response.extraction.warnings).toEqual(["No parece una factura."]);
    expect(response.matched.lines).toEqual([]);
    expect(await mockRepo.getScan(ctx, response.scanId)).toMatchObject({ status: "extracted" });
  });
});

describe("scanInvoice · forma storagePaths", () => {
  function stored(ctx: { storeId: string }, storage: ReturnType<typeof memoryStorage>, texts: string[]) {
    const pages = texts.map((text) => jpegHeader(1600, 1200, text));
    const sha = sha256OfPages(pages);
    const storagePaths = pages.map((data, index) => {
      const path = `${ctx.storeId}/${sha}/p${index + 1}.jpg`;
      storage.objects.set(path, data);
      return path;
    });

    return { sha, storagePaths };
  }

  it("descarga las páginas de la tienda, recalcula el hash y no vuelve a subirlas", async () => {
    const ctx = newContext();
    const { built, extract, storage } = deps();
    const { sha, storagePaths } = stored(ctx, storage, ["s1", "s2"]);

    const response = await scanInvoice(built, ctx, { sha256: sha, source: "storage", storagePaths });

    expect(response.cached).toBe(false);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({
        pages: [
          { data: storage.objects.get(storagePaths[0]!), mediaType: "image/jpeg" },
          { data: storage.objects.get(storagePaths[1]!), mediaType: "image/jpeg" },
        ],
      }),
    );
    expect(await mockRepo.getScan(ctx, response.scanId)).toMatchObject({
      pages: 2,
      storagePath: storagePaths[0],
    });
  });

  it("400 si una ruta es de otra tienda, sin descargar nada", async () => {
    const ctx = newContext();
    const { built, storage } = deps();
    const { sha } = stored(ctx, storage, ["x"]);

    await expect(
      scanInvoice(built, ctx, { sha256: sha, source: "storage", storagePaths: [`otra-tienda/${sha}/p1.jpg`] }),
    ).rejects.toMatchObject({ message: INVOICE_INVALID_PATH_MESSAGE, status: 400 });
    expect(storage.download).not.toHaveBeenCalled();
  });

  it.each([
    ["rutas fuera de orden", (sha: string, store: string) => [`${store}/${sha}/p2.jpg`, `${store}/${sha}/p1.jpg`]],
    ["carpeta de otro hash", (_sha: string, store: string) => [`${store}/${"e".repeat(64)}/p1.jpg`]],
  ])("400 por %s", async (_label, buildPaths) => {
    const ctx = newContext();
    const { built, storage } = deps();
    const { sha } = stored(ctx, storage, ["a", "b"]);

    await expect(
      scanInvoice(built, ctx, { sha256: sha, source: "storage", storagePaths: buildPaths(sha, ctx.storeId) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 si los bytes guardados no dan el hash declarado", async () => {
    const ctx = newContext();
    const { built, storage } = deps();
    const { sha, storagePaths } = stored(ctx, storage, ["original"]);
    storage.objects.set(storagePaths[0]!, jpegHeader(1600, 1200, "alterado"));

    await expect(
      scanInvoice(built, ctx, { sha256: sha, source: "storage", storagePaths }),
    ).rejects.toMatchObject({ message: INVOICE_HASH_MISMATCH_MESSAGE, status: 400 });
  });
});

describe("scanInvoice · few-shot de la capa 2", () => {
  const confirmed = { ...singlePageExtraction, number: "confirmada" };

  it("sin supplierId no consulta ejemplos", async () => {
    const listFewShotExamples = jest.fn(mockRepo.listFewShotExamples);
    const { built } = deps({ repo: { ...mockRepo, listFewShotExamples } });

    await scanInvoice(built, newContext(), { pages: [page("sin proveedor")], source: "upload" });

    expect(listFewShotExamples).not.toHaveBeenCalled();
  });

  it("con supplierId pasa hasta 3 ejemplos y omite los que no se descargan", async () => {
    const ctx = newContext();
    const listFewShotExamples = jest.fn(async () => [
      { extraction: confirmed, scanId: "s1", storagePath: `${ctx.storeId}/${"1".repeat(64)}/p1.png` },
      { extraction: confirmed, scanId: "s2", storagePath: `${ctx.storeId}/${"2".repeat(64)}/p1.jpg` },
    ]);
    const { built, extract, storage } = deps({ repo: { ...mockRepo, listFewShotExamples } });
    const example = new TextEncoder().encode("ejemplo");
    storage.objects.set(`${ctx.storeId}/${"1".repeat(64)}/p1.png`, example);

    await scanInvoice(built, ctx, { pages: [page("con proveedor")], source: "upload", supplierId: SUPPLIER_ID });

    expect(listFewShotExamples).toHaveBeenCalledWith(ctx, SUPPLIER_ID, 3);
    const format = toFewShotFormat(confirmed);
    expect(format.ok).toBe(true);
    expect(extract).toHaveBeenCalledWith(
      expect.objectContaining({
        fewShot: [{ format: format.ok ? format.format : null, page: { data: example, mediaType: "image/png" } }],
      }),
    );
  });

  it("omite el confirmed que no valida o tiene valores absurdos y registra solo el código (SCN-03q)", async () => {
    const ctx = newContext();
    const paths = ["1", "2", "3"].map((digit) => `${ctx.storeId}/${digit.repeat(64)}/p1.png`);
    const secret = "PROVEEDOR HACKEADO";
    const listFewShotExamples = jest.fn(async () => [
      { extraction: { supplier: secret, lines: "x" } as unknown as InvoiceExtraction, scanId: "s1", storagePath: paths[0]! },
      {
        extraction: {
          ...confirmed,
          lines: [{ ...confirmed.lines[0]!, description: secret, lineTotal: 999999, quantity: 999, unitPrice: 1 }],
        },
        scanId: "s2",
        storagePath: paths[1]!,
      },
      { extraction: confirmed, scanId: "s3", storagePath: paths[2]! },
    ]);
    const { built, extract, storage } = deps({ repo: { ...mockRepo, listFewShotExamples } });
    const example = new TextEncoder().encode("ejemplo");
    paths.forEach((path) => storage.objects.set(path, example));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await scanInvoice(built, ctx, { pages: [page("con proveedor 3q")], source: "upload", supplierId: SUPPLIER_ID });

      const fewShot = (extract.mock.calls[0] as unknown as [{ fewShot: unknown[] }])[0].fewShot;
      expect(fewShot).toHaveLength(1);
      expect(JSON.stringify(fewShot)).not.toContain(secret);
      expect(JSON.stringify(fewShot)).not.toContain(confirmed.supplier.name);
      expect(warn.mock.calls).toEqual([
        ["[invoice-scan] ejemplo few-shot descartado", { code: "INVALID_FEW_SHOT_EXAMPLE" }],
        ["[invoice-scan] ejemplo few-shot descartado", { code: "ABSURD_FEW_SHOT_EXAMPLE" }],
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("getInvoiceScanDetail y discardInvoiceScan", () => {
  it("devuelve la fila con una URL firmada de 5 minutos por página", async () => {
    const ctx = newContext();
    const { built, storage } = deps();
    const pages = [page("d1"), page("d2"), page("d3")];
    const sha = sha256OfPages(pages.map((item) => item.data));
    const { scanId } = await scanInvoice(built, ctx, { pages, source: "upload" });

    const detail = await getInvoiceScanDetail(built, ctx, scanId);

    expect(detail).toMatchObject({
      extraction: singlePageExtraction,
      pages: 3,
      purchaseId: null,
      scanId,
      status: "extracted",
    });
    expect(detail.imageUrls).toEqual(
      [1, 2, 3].map((n) => `https://signed.local/${ctx.storeId}/${sha}/p${n}.jpg?ttl=${INVOICE_READ_URL_TTL_SECONDS}`),
    );
    expect(storage.signedReadUrl).toHaveBeenCalledTimes(3);
  });

  it("lleva la compra registrada con el escaneo (SCN-08-F1)", async () => {
    const ctx = newContext();
    const { built } = deps();
    const { scanId } = await scanInvoice(built, ctx, { pages: [page("con compra")], source: "upload" });
    const row = (await mockRepo.getScan(ctx, scanId)) as InvoiceScanRow;
    const purchaseId = "00000000-0000-4000-8000-0000000000aa";
    mockRepo.putMockScanRow({ ...row, purchaseId, status: "confirmed" });

    await expect(getInvoiceScanDetail(built, ctx, scanId)).resolves.toMatchObject({ purchaseId, status: "confirmed" });
  });

  it("404 para otra tienda o un id inválido", async () => {
    const ctx = newContext();
    const { built } = deps();
    const { scanId } = await scanInvoice(built, ctx, { pages: [page("ajeno")], source: "upload" });

    await expect(getInvoiceScanDetail(built, newContext(), scanId)).rejects.toMatchObject({ status: 404 });
    await expect(getInvoiceScanDetail(built, ctx, "no-es-uuid")).rejects.toMatchObject({ status: 404 });
    await expect(discardInvoiceScan(built, newContext(), scanId)).rejects.toMatchObject({ status: 404 });
  });

  it("descarta una vez (200) y la segunda es 409", async () => {
    const ctx = newContext();
    const { built } = deps();
    const { scanId } = await scanInvoice(built, ctx, { pages: [page("descartar")], source: "upload" });

    await expect(discardInvoiceScan(built, ctx, scanId)).resolves.toEqual({ scanId, status: "discarded" });
    await expect(discardInvoiceScan(built, ctx, scanId)).rejects.toMatchObject({ status: 409 });
  });
});

describe("invoiceScanPagePaths", () => {
  it("deriva p1..pN de la ruta de la página 1", () => {
    expect(invoiceScanPagePaths(`s/${"a".repeat(64)}/p1.webp`, 2)).toEqual([
      `s/${"a".repeat(64)}/p1.webp`,
      `s/${"a".repeat(64)}/p2.webp`,
    ]);
  });

  it("una ruta con otra forma se devuelve tal cual", () => {
    expect(invoiceScanPagePaths("s/legacy.jpg", 3)).toEqual(["s/legacy.jpg"]);
  });
});

describe("readUploadedPages", () => {
  function form(files: (File | string)[], fields: Record<string, string> = {}) {
    const data = new FormData();
    files.forEach((file) => data.append("page", file));
    Object.entries(fields).forEach(([key, value]) => data.append(key, value));
    return data;
  }

  it("lee las páginas en orden con su tipo, el hash y el proveedor", async () => {
    const input = await readUploadedPages(
      form([new File(["uno"], "a.jpg", { type: "image/jpeg" }), new File(["dos"], "b.jpg", { type: "image/jpeg" })], {
        sha256: "a".repeat(64),
        supplierId: SUPPLIER_ID,
      }),
    );

    expect(input).toEqual({
      pages: [
        { data: new TextEncoder().encode("uno"), mediaType: "image/jpeg" },
        { data: new TextEncoder().encode("dos"), mediaType: "image/jpeg" },
      ],
      sha256: "a".repeat(64),
      source: "upload",
      supplierId: SUPPLIER_ID,
    });
  });

  it("413 en español si una página pasa de 1 MB", async () => {
    const big = new File([new Uint8Array(INVOICE_MAX_BYTES + 1)], "big.jpg", { type: "image/jpeg" });

    await expect(readUploadedPages(form([big]))).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: expect.stringMatching(/pesa más de 1 MB/),
      status: 413,
    });
  });

  it.each([
    ["sin páginas", () => form([])],
    ["más de 10 páginas", () => form(Array.from({ length: 11 }, () => new File(["x"], "x.jpg", { type: "image/jpeg" })))],
    ["un PDF", () => form([new File(["%PDF"], "f.pdf", { type: "application/pdf" })])],
    ["texto en vez de archivo", () => form(["no soy archivo"])],
    ["página vacía", () => form([new File([], "v.jpg", { type: "image/jpeg" })])],
  ])("400 por %s", async (_label, build) => {
    await expect(readUploadedPages(build())).rejects.toMatchObject({ status: 400 });
  });

  it("400 (ZodError) por un sha256 mal formado", async () => {
    await expect(
      readUploadedPages(form([new File(["x"], "x.jpg", { type: "image/jpeg" })], { sha256: "XYZ" })),
    ).rejects.toThrow("hash");
  });
});

describe("createInvoiceScanDeps", () => {
  it("en mock usa el repositorio y el Storage en memoria con URLs falsas", async () => {
    const built = createInvoiceScanDeps("mock");

    expect(built.repo).toBe(mockRepo);
    await expect(built.storage.signedReadUrl("s/x/p1.jpg", 300)).rejects.toMatchObject({ status: 404 });
    await built.storage.upload("s/x/p1.jpg", new Uint8Array([1]), "image/jpeg");
    await expect(built.storage.signedReadUrl("s/x/p1.jpg", 300)).resolves.toMatch(/^https:\/\/mock-storage\.local\//);
    await expect(built.storage.download("s/x/p1.jpg")).resolves.toEqual(new Uint8Array([1]));
    await expect(built.storage.download("s/x/p9.jpg")).rejects.toMatchObject({ status: 404 });
  });
});

describe("scanInvoice · reserva atómica (SCN-03h)", () => {
  /** extract que no termina hasta `release()`: simula la latencia real del modelo. */
  function gatedExtract() {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const extract = jest.fn(async () => {
      await gate;
      return extractResult();
    });

    return { extract, release: () => release() };
  }

  it("5 POST simultáneos con la misma imagen: 1 llamada al modelo, el resto 409 o caché, cuota +1", async () => {
    const ctx = newContext();
    const { extract, release } = gatedExtract();
    const { built } = deps({ extract });
    const pages = [page("carrera")];

    const pending = Array.from({ length: 5 }, () => scanInvoice(built, ctx, { pages, source: "upload" }));
    setTimeout(release, 10);
    const results = await Promise.allSettled(pending);

    expect(extract).toHaveBeenCalledTimes(1);
    const fulfilled = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const rejected = results.flatMap((result) => (result.status === "rejected" ? [result.reason as ApiError] : []));
    expect(fulfilled.filter((value) => !value.cached)).toHaveLength(1);
    rejected.forEach((error) =>
      expect(error).toMatchObject({ message: INVOICE_SCAN_IN_PROGRESS_MESSAGE, status: 409 }),
    );
    expect(fulfilled.length + rejected.length).toBe(5);
    expect(await mockRepo.getDailyUsage(ctx, 50)).toMatchObject({ used: 1 });
  });

  it("cuota atómica: con límite 2 y 5 escaneos simultáneos distintos solo pasan 2", async () => {
    const ctx = newContext();
    const { extract, release } = gatedExtract();
    const { built } = deps({ dailyLimit: 2, extract });

    const pending = [0, 1, 2, 3, 4].map((n) =>
      scanInvoice(built, ctx, { pages: [page(`cuota-${n}`)], source: "upload" }),
    );
    setTimeout(release, 10);
    const results = await Promise.allSettled(pending);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(
      results.filter((result) => result.status === "rejected" && (result.reason as ApiError).status === 429),
    ).toHaveLength(3);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(await mockRepo.getDailyUsage(ctx, 2)).toMatchObject({ used: 2 });
  });

  it("cada reintento de un escaneo failed cobra sus páginas", async () => {
    const ctx = newContext();
    const extract = jest.fn(async () => {
      throw new InvoiceExtractionError("INVALID_OUTPUT");
    });
    const { built } = deps({ dailyLimit: 3, extract });
    const pages = [page("siempre-mal")];

    for (const expectedUsed of [1, 2, 3]) {
      await expect(scanInvoice(built, ctx, { pages, source: "upload" })).rejects.toMatchObject({ status: 502 });
      expect(await mockRepo.getDailyUsage(ctx, 3)).toMatchObject({ used: expectedUsed });
    }

    await expect(scanInvoice(built, ctx, { pages, source: "upload" })).rejects.toMatchObject({ status: 429 });
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it("reescanear tras descartar vuelve a leer, cobra y devuelve un scanId utilizable", async () => {
    const ctx = newContext();
    const { built, extract } = deps();
    const pages = [page("descartada")];
    const first = await scanInvoice(built, ctx, { pages, source: "upload" });
    await discardInvoiceScan(built, ctx, first.scanId);

    const again = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(again.cached).toBe(false);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(again.limits.used).toBe(2);
    expect(await mockRepo.getScan(ctx, again.scanId)).toMatchObject({ status: "extracted" });
    await expect(discardInvoiceScan(built, ctx, again.scanId)).resolves.toMatchObject({ status: "discarded" });
  });

  it("un .exe declarado como JPEG: 400 sin subirlo, sin llamar al modelo y sin cobrar", async () => {
    const ctx = newContext();
    const { built, extract, storage } = deps();
    const exe = { data: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), mediaType: "image/jpeg" as const };

    await expect(scanInvoice(built, ctx, { pages: [exe], source: "upload" })).rejects.toMatchObject({ status: 400 });

    expect(storage.upload).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(await mockRepo.getDailyUsage(ctx, 50)).toMatchObject({ used: 0 });
  });

  it("un .exe subido por upload-url: 400 sin llamar al modelo ni cobrar", async () => {
    const ctx = newContext();
    const { built, extract, storage } = deps();
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const sha = sha256OfPages([exe]);
    const path = `${ctx.storeId}/${sha}/p1.jpg`;
    storage.objects.set(path, exe);

    await expect(
      scanInvoice(built, ctx, { sha256: sha, source: "storage", storagePaths: [path] }),
    ).rejects.toMatchObject({ status: 400 });

    expect(extract).not.toHaveBeenCalled();
    expect(await mockRepo.getDailyUsage(ctx, 50)).toMatchObject({ used: 0 });
  });

  it("pasa la señal de cancelación del cliente a la extracción", async () => {
    const { built, extract } = deps();
    const controller = new AbortController();

    await scanInvoice(built, newContext(), { pages: [page("señal")], source: "upload" }, { signal: controller.signal });

    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});

describe("scanInvoice · ruta guardada y cobro de los fallos (SCN-03l)", () => {
  it("el detalle no firma una ruta guardada fuera de la tienda de la sesión (N1)", async () => {
    const ctx = newContext();
    const { built, storage } = deps();
    const { scanId } = await scanInvoice(built, ctx, { pages: [page("ruta")], source: "upload" });
    const row = (await mockRepo.getScan(ctx, scanId)) as InvoiceScanRow;
    const foreign = `otra-tienda/${row.imageSha256}/p1.jpg`;
    const getScan = jest.fn(async () => ({ ...row, storagePath: foreign }));
    const tampered = deps({ repo: { ...mockRepo, getScan }, storage });

    await expect(getInvoiceScanDetail(tampered.built, ctx, scanId)).rejects.toMatchObject({
      message: INVOICE_INVALID_PATH_MESSAGE,
      status: 400,
    });
    expect(storage.signedReadUrl).not.toHaveBeenCalled();
  });

  it("el few-shot no descarga un ejemplo con ruta de otra tienda (N1)", async () => {
    const ctx = newContext();
    const confirmed = { ...singlePageExtraction, number: "ajena" };
    const foreign = `otra-tienda/${"9".repeat(64)}/p1.jpg`;
    const listFewShotExamples = jest.fn(async () => [{ extraction: confirmed, scanId: "s9", storagePath: foreign }]);
    const { built, extract, storage } = deps({ repo: { ...mockRepo, listFewShotExamples } });
    storage.objects.set(foreign, new TextEncoder().encode("ajena"));

    await scanInvoice(built, ctx, { pages: [page("few ajeno")], source: "upload", supplierId: SUPPLIER_ID });

    expect(storage.download).not.toHaveBeenCalledWith(foreign);
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ fewShot: [] }));
  });

  it("si Storage falla al subir (antes del modelo), la reserva queda failed y no cobra (N8)", async () => {
    const ctx = newContext();
    const { built, extract, storage } = deps();
    (storage.upload as jest.Mock).mockRejectedValueOnce(new ApiError(503, "INTERNAL_ERROR", "caído"));
    const pages = [page("storage caído")];

    await expect(scanInvoice(built, ctx, { pages, source: "upload" })).rejects.toMatchObject({ status: 503 });

    expect(extract).not.toHaveBeenCalled();
    expect(failedRow(ctx, sha256OfPages(pages.map((item) => item.data)))).toMatchObject({
      error: "UPLOAD_ERROR",
      status: "failed",
      usagePages: 0,
    });
    expect(await mockRepo.getDailyUsage(ctx, 50)).toMatchObject({ used: 0 });
  });

  it("un corte del cliente durante la lectura queda como CLIENT_ABORTED y cobra (el modelo se llamó) (N8)", async () => {
    const ctx = newContext();
    const controller = new AbortController();
    const extract = jest.fn(async () => {
      controller.abort();
      throw new InvoiceExtractionError("TIMEOUT");
    });
    const { built } = deps({ extract });
    const pages = [page("corte")];

    await expect(
      scanInvoice(built, ctx, { pages, source: "upload" }, { signal: controller.signal }),
    ).rejects.toBeTruthy();

    expect(failedRow(ctx, sha256OfPages(pages.map((item) => item.data)))).toMatchObject({
      error: "CLIENT_ABORTED",
      status: "failed",
      usagePages: 1,
    });
  });
});

describe("readUploadedPages · tope multipart (SCN-03h)", () => {
  it("413 en español que sugiere upload-url si el total pasa de 4 MB", async () => {
    const data = new FormData();
    for (let index = 0; index < 5; index += 1) {
      data.append("page", new File([new Uint8Array(900 * 1024)], `p${index}.jpg`, { type: "image/jpeg" }));
    }

    await expect(readUploadedPages(data)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: expect.stringMatching(/4 MB.*upload-url/),
      status: 413,
    });
  });
});

describe("scanInvoice · caché validado, intento vigente e imagen ausente (SCN-03n)", () => {
  function rows() {
    return mockState("invoice-scan:scans", () => new Map<string, InvoiceScanRow>());
  }

  function tamper(id: string, patch: Partial<InvoiceScanRow>) {
    rows().set(id, { ...(rows().get(id) as InvoiceScanRow), ...patch });
  }

  /**
   * Congela solo `Date`: el repositorio mock fecha las filas y cuenta la cuota
   * por día de Caracas con el reloj real, y un `createdAt` retrasado cruza al
   * día anterior si el test corre justo después de medianoche (SCN-13e).
   */
  function pinDateTo(iso: string) {
    jest.useFakeTimers({
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
      now: new Date(iso),
    });
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["con otra forma", { lines: "ilegible", x: 1 }],
    ["vacía ({} en la columna)", null],
  ])("una lectura en caché %s no se sirve: se vuelve a leer, se cobra y solo se registra el código (C4)", async (_label, extracted) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx = newContext();
    const { built, extract } = deps();
    const pages = [page(`caché roto ${String(extracted)}`)];
    const first = await scanInvoice(built, ctx, { pages, source: "upload" });
    tamper(first.scanId, { extracted: extracted as unknown as InvoiceScanRow["extracted"] });

    const again = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(again).toMatchObject({ cached: false, extraction: singlePageExtraction, scanId: first.scanId });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(again.limits.used).toBe(2);
    expect(await mockRepo.getScan(ctx, first.scanId)).toMatchObject({ extracted: singlePageExtraction, status: "extracted" });
    expect(warn).toHaveBeenCalledWith("[invoice-scan] lectura en caché fuera del contrato", {
      code: "INVALID_CACHED_EXTRACTION",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("ilegible");
    warn.mockRestore();
  });

  it.each([
    ["con otra forma", { lines: 7, x: "basura" }],
    ["con una línea sin estado válido", { lines: [{ entryMode: "unit", index: 0, issues: [], status: "ok", taxRateCode: "general" }], supplier: {}, totals: { computed: 1, mismatch: false } }],
    ["sin totales", { lines: [], supplier: {} }],
  ])("un emparejamiento en caché %s no se sirve: se re-empareja sin llamar al modelo ni cobrar (B1)", async (_label, matched) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx = newContext();
    const { built, extract, matcher } = deps();
    const pages = [page(`matched roto ${JSON.stringify(matched)}`)];
    const first = await scanInvoice(built, ctx, { pages, source: "upload" });
    tamper(first.scanId, { matched: matched as unknown as InvoiceScanRow["matched"] });

    const again = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(again).toEqual({ ...first, cached: true });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(matcher).toHaveBeenCalledTimes(2);
    expect(matcher).toHaveBeenLastCalledWith(singlePageExtraction, {
      dataSource: "mock",
      scanId: first.scanId,
      storeId: ctx.storeId,
    });
    expect(again.limits.used).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("basura");
    warn.mockRestore();
  });

  it("un emparejamiento en caché válido se sirve tal cual, sin volver a emparejar", async () => {
    const ctx = newContext();
    const { built, matcher } = deps();
    const pages = [page("matched válido")];
    await scanInvoice(built, ctx, { pages, source: "upload" });

    await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(matcher).toHaveBeenCalledTimes(1);
  });

  it("una lectura vieja no pisa la nueva: si otra reserva tomó la fila, complete responde 409 y la fila sigue con el intento nuevo (C1/C2)", async () => {
    // Mediodía en Caracas: retrasar la fila 10 min no la saca del día, así que la
    // nueva reserva acumula usagePages sobre la anterior (a las 00:05 daría 1).
    pinDateTo("2026-10-16T16:00:00.000Z");
    const ctx = newContext();
    const pages = [page("intento viejo")];
    const sha = sha256OfPages(pages.map((item) => item.data));
    const extract = jest.fn(async () => {
      // Mientras el modelo lee, la ventana caduca y otra petición vuelve a reservar.
      tamper((failedRow(ctx, sha) as InvoiceScanRow).id, { createdAt: new Date(Date.now() - 10 * 60_000).toISOString() });
      await mockRepo.reserveScan(ctx, {
        imageSha256: sha,
        limit: 50,
        model: "invoice-scan-mock",
        pages: 1,
        provider: "mock",
        storagePath: `${ctx.storeId}/${sha}/p1.jpg`,
      });
      return extractResult();
    });
    const { built } = deps({ extract });

    await expect(scanInvoice(built, ctx, { pages, source: "upload" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: INVOICE_SCAN_STALE_ATTEMPT_MESSAGE,
      status: 409,
    });
    expect(failedRow(ctx, sha)).toMatchObject({ extracted: null, status: "processing", usagePages: 2 });
  });

  it("el detalle de un escaneo cuya imagen ya no está en el bucket es 404 en español, no 503 (C6)", async () => {
    const ctx = newContext();
    const { built, storage } = deps();
    const { scanId } = await scanInvoice(built, ctx, { pages: [page("sin imagen")], source: "upload" });
    (storage.signedReadUrl as jest.Mock).mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no está"));

    await expect(getInvoiceScanDetail(built, ctx, scanId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: INVOICE_SCAN_IMAGE_GONE_MESSAGE,
      status: 404,
    });
    expect(INVOICE_SCAN_IMAGE_GONE_MESSAGE).toBe("La imagen de esta factura ya no está disponible.");
  });

  it("si Storage está caído, el detalle sigue respondiendo 503", async () => {
    const ctx = newContext();
    const { built, storage } = deps();
    const { scanId } = await scanInvoice(built, ctx, { pages: [page("storage caído detalle")], source: "upload" });
    (storage.signedReadUrl as jest.Mock).mockRejectedValueOnce(new ApiError(503, "INTERNAL_ERROR", "caído"));

    await expect(getInvoiceScanDetail(built, ctx, scanId)).rejects.toMatchObject({ status: 503 });
  });
});

describe("scanInvoice · textos opcionales vacíos (SCN-13a)", () => {
  const blankExtraction: InvoiceExtraction = {
    ...singlePageExtraction,
    lines: singlePageExtraction.lines.map((line, index) =>
      index === 0 ? { ...line, barcode: "", supplierSku: "   " } : { ...line, barcode: "7591234567890" },
    ),
    number: "  ",
    supplier: { address: "", name: singlePageExtraction.supplier.name, phone: " \t", taxId: "" },
  };

  function expectNoBlankOptionals(extraction: InvoiceExtraction | null | undefined) {
    expect(extraction?.supplier).toEqual({ name: singlePageExtraction.supplier.name });
    expect(extraction).not.toHaveProperty("number");
    expect(extraction?.lines[0]).not.toHaveProperty("barcode");
    expect(extraction?.lines[0]).not.toHaveProperty("supplierSku");
    expect(extraction?.lines[1]?.barcode).toBe("7591234567890");
  }

  it('"" o solo espacios quedan ausentes en lo emparejado, lo guardado y la respuesta', async () => {
    const ctx = newContext();
    const { built, matcher } = deps({ extract: jest.fn(async () => extractResult({ extraction: blankExtraction })) });

    const response = await scanInvoice(built, ctx, { pages: [page("blank")], source: "upload" });
    const stored = await mockRepo.getScan(ctx, response.scanId);

    expectNoBlankOptionals(matcher.mock.calls[0]?.[0]);
    expectNoBlankOptionals(stored?.extracted);
    expectNoBlankOptionals(response.extraction);
  });

  it("una fila en caché con textos vacíos se sirve ya normalizada", async () => {
    const ctx = newContext();
    const pages = [page("blank-cached")];
    const sha = sha256OfPages(pages.map((item) => item.data));
    await mockRepo.seedScanForTest(ctx, {
      extracted: blankExtraction,
      imageSha256: sha,
      model: "invoice-scan-mock",
      provider: "mock",
      storagePath: `${ctx.storeId}/${sha}/p1.jpg`,
    });
    const { built, extract } = deps();

    const response = await scanInvoice(built, ctx, { pages, source: "upload" });

    expect(response.cached).toBe(true);
    expect(extract).not.toHaveBeenCalled();
    expectNoBlankOptionals(response.extraction);
  });
});
