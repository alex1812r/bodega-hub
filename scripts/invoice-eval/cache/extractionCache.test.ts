/**
 * @jest-environment node
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InvoiceExtraction } from "../../../src/modules/invoice-scan/contracts";
import { buildInvoiceSystemPrompt } from "../../../src/modules/invoice-scan/server/prompt";

import type { BenchExtractInput, BenchExtractor, BenchExtractResult } from "../runner";
import type { InvoiceTruth } from "../truth";

import {
  currentPromptFingerprint,
  extractionCacheKey,
  extractionCachePath,
  sha256,
  withExtractionCache,
  type CacheFs,
  type PromptFingerprint,
} from "./extractionCache";

const EXTRACTION: InvoiceExtraction = {
  supplier: { name: "Chevere Depot", taxId: "J-508357612" },
  currency: "VES",
  lines: [
    {
      rawText: "GLUP COLA 2L [BULTO X 6]",
      description: "Glup cola 2L",
      quantity: 2,
      unit: "bulto",
      unitsPerPack: 6,
      unitPrice: 10,
      lineTotal: 20,
      confidence: 0.9,
    },
  ],
  confidence: 0.9,
  warnings: [],
} as unknown as InvoiceExtraction;

const TRUTH = { id: "f02", synthetic: false } as unknown as InvoiceTruth;
const PAGE = { data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" as const };
const FINGERPRINT: PromptFingerprint = { systemPromptHash: "p1", contractHash: "c1" };
const TARGET = { provider: "google", modelId: "gemini-2.5-flash" };

function input(overrides: Partial<BenchExtractInput> = {}): BenchExtractInput {
  return { pages: [PAGE], invoice: { id: "f02", bucket: "sinAlias", truth: TRUTH }, ...overrides };
}

function fewShotInput(ids: string[], page = PAGE, confirmed = EXTRACTION): BenchExtractInput {
  return input({
    invoice: { id: "f02", bucket: "conAlias", truth: TRUTH },
    fewShot: ids.map(() => ({ page, confirmed })),
    fewShotIds: ids,
  });
}

function memoryFs(): CacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return { files, read: (path) => files.get(path) ?? null, write: (path, text) => void files.set(path, text) };
}

function okExtractor(): jest.Mock<ReturnType<BenchExtractor>, Parameters<BenchExtractor>> {
  return jest.fn<ReturnType<BenchExtractor>, Parameters<BenchExtractor>>(async (): Promise<BenchExtractResult> => ({
    extraction: structuredClone(EXTRACTION),
    provider: "google",
    modelId: "gemini-2.5-flash",
    inputTokens: 1200,
    outputTokens: 300,
    durationMs: 4200,
    pages: 1,
  }));
}

function cacheWith(fs: CacheFs, inner: BenchExtractor, overrides: { enabled?: boolean; fingerprint?: PromptFingerprint } = {}) {
  return withExtractionCache(inner, {
    root: "C:/cache",
    ...TARGET,
    enabled: overrides.enabled ?? true,
    fingerprint: overrides.fingerprint ?? FINGERPRINT,
    fs,
    now: () => new Date("2026-10-15T23:00:00.000Z"),
  });
}

describe("extractionCacheKey", () => {
  const base = extractionCacheKey(input(), TARGET, FINGERPRINT);

  it("es estable para la misma petición", () => {
    expect(extractionCacheKey(input(), TARGET, FINGERPRINT)).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia con el prompt del sistema o el contrato", () => {
    expect(extractionCacheKey(input(), TARGET, { ...FINGERPRINT, systemPromptHash: "p2" })).not.toBe(base);
    expect(extractionCacheKey(input(), TARGET, { ...FINGERPRINT, contractHash: "c2" })).not.toBe(base);
  });

  it("cambia con un solo byte de la imagen objetivo", () => {
    const other = { ...PAGE, data: new Uint8Array([1, 2, 4]) };
    expect(extractionCacheKey(input({ pages: [other] }), TARGET, FINGERPRINT)).not.toBe(base);
  });

  it("cambia con los ids, la imagen o el formato del few-shot", () => {
    const a = extractionCacheKey(fewShotInput(["f01"]), TARGET, FINGERPRINT);
    expect(a).not.toBe(base);
    expect(extractionCacheKey(fewShotInput(["f04"]), TARGET, FINGERPRINT)).not.toBe(a);
    expect(extractionCacheKey(fewShotInput(["f01"], { ...PAGE, data: new Uint8Array([9]) }), TARGET, FINGERPRINT)).not.toBe(a);
    const otherFormat = { ...EXTRACTION, lines: [{ ...EXTRACTION.lines[0], unitsPerPack: 12 }] } as InvoiceExtraction;
    expect(extractionCacheKey(fewShotInput(["f01"], PAGE, otherFormat), TARGET, FINGERPRINT)).not.toBe(a);
  });

  it("cambia con el modelo", () => {
    expect(extractionCacheKey(input(), { ...TARGET, modelId: "gemini-3.8-flash" }, FINGERPRINT)).not.toBe(base);
  });

  it("la huella vigente sale de prompt.ts", () => {
    expect(currentPromptFingerprint().systemPromptHash).toBe(sha256(buildInvoiceSystemPrompt()));
  });

  it("ruta: <provider>/<modelId>/<id>-<pasada>-<clave>.json", () => {
    expect(extractionCachePath("C:/cache", TARGET, { id: "f02", bucket: "sinAlias" }, base)).toBe(
      join("C:/cache", "google", "gemini-2.5-flash", `f02-sinAlias-${base.slice(0, 16)}.json`),
    );
  });
});

describe("withExtractionCache", () => {
  it("miss llama y guarda; hit no llama y devuelve tokens y duración originales", async () => {
    const fs = memoryFs();
    const inner = okExtractor();
    const first = cacheWith(fs, inner);
    const fresh = await first.extractor(input());
    expect(fresh.cached).toBe(false);
    expect(first.state).toMatchObject({ hits: 0, calls: 1, errors: 0 });
    expect(fs.files.size).toBe(1);
    const [[path, text]] = [...fs.files];
    expect(path).toContain(join("google", "gemini-2.5-flash", "f02-sinAlias-"));
    const saved = JSON.parse(text) as Record<string, unknown>;
    expect(saved).toMatchObject({
      modelId: "gemini-2.5-flash",
      invoiceId: "f02",
      bucket: "sinAlias",
      inputTokens: 1200,
      outputTokens: 300,
      durationMs: 4200,
      savedAt: "2026-10-15T23:00:00.000Z",
      systemPromptHash: "p1",
    });

    const second = cacheWith(fs, inner);
    const hit = await second.extractor(input());
    expect(inner).toHaveBeenCalledTimes(1);
    expect(second.state).toMatchObject({ hits: 1, calls: 0 });
    expect(hit).toMatchObject({ cached: true, inputTokens: 1200, outputTokens: 300, durationMs: 4200, modelId: "gemini-2.5-flash" });
    expect(hit.extraction).toEqual(EXTRACTION);
  });

  it("un cambio de prompt, few-shot o imagen invalida la entrada y vuelve a llamar", async () => {
    const fs = memoryFs();
    const inner = okExtractor();
    await cacheWith(fs, inner).extractor(fewShotInput(["f01"]));
    await cacheWith(fs, inner, { fingerprint: { ...FINGERPRINT, systemPromptHash: "p2" } }).extractor(fewShotInput(["f01"]));
    await cacheWith(fs, inner).extractor(fewShotInput(["f01", "f04"]));
    await cacheWith(fs, inner).extractor(fewShotInput(["f01"], { ...PAGE, data: new Uint8Array([7]) }));
    await cacheWith(fs, inner).extractor({ ...fewShotInput(["f01"]), pages: [{ ...PAGE, data: new Uint8Array([8]) }] });
    expect(inner).toHaveBeenCalledTimes(5);
    expect(fs.files.size).toBe(5);
    // La original sigue sirviendo.
    const again = cacheWith(fs, inner);
    await again.extractor(fewShotInput(["f01"]));
    expect(again.state.hits).toBe(1);
    expect(inner).toHaveBeenCalledTimes(5);
  });

  it("los errores (429, 503) no se cachean: la siguiente corrida vuelve a llamar", async () => {
    const fs = memoryFs();
    const failing = jest.fn<ReturnType<BenchExtractor>, Parameters<BenchExtractor>>(async () => {
      throw Object.assign(new Error("cuota"), { code: "QUOTA" });
    });
    const first = cacheWith(fs, failing);
    await expect(first.extractor(input())).rejects.toMatchObject({ code: "QUOTA" });
    failing.mockImplementationOnce(async () => {
      throw Object.assign(new Error("503"), { code: "PROVIDER_ERROR" });
    });
    await expect(first.extractor(input())).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(first.state).toMatchObject({ hits: 0, calls: 0, errors: 2 });
    expect(fs.files.size).toBe(0);
    const inner = okExtractor();
    const second = cacheWith(fs, inner);
    await second.extractor(input());
    expect(inner).toHaveBeenCalledTimes(1);
    expect(second.state.calls).toBe(1);
  });

  it("--no-cache: no lee la caché, llama y sobrescribe la entrada", async () => {
    const fs = memoryFs();
    const inner = okExtractor();
    await cacheWith(fs, inner).extractor(input());
    const forced = cacheWith(fs, inner, { enabled: false });
    const result = await forced.extractor(input());
    expect(result.cached).toBe(false);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(forced.state).toMatchObject({ enabled: false, hits: 0, calls: 1 });
    expect(fs.files.size).toBe(1);
  });

  it("entrada corrupta o con otra clave: se ignora como miss", async () => {
    const fs = memoryFs();
    const inner = okExtractor();
    await cacheWith(fs, inner).extractor(input());
    const [path] = [...fs.files.keys()];
    fs.files.set(path, "{no es json");
    const corrupt = cacheWith(fs, inner);
    await corrupt.extractor(input());
    expect(corrupt.state).toMatchObject({ hits: 0, invalid: 1, calls: 1 });
    const saved = JSON.parse(fs.files.get(path) as string) as Record<string, unknown>;
    fs.files.set(path, JSON.stringify({ ...saved, key: "otra" }));
    const otherKey = cacheWith(fs, inner);
    await otherKey.extractor(input());
    expect(otherKey.state).toMatchObject({ hits: 0, invalid: 1 });
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("sin factura indicada no cachea", async () => {
    const fs = memoryFs();
    const inner = okExtractor();
    const cache = cacheWith(fs, inner);
    await cache.extractor({ pages: [PAGE] });
    await cache.extractor({ pages: [PAGE] });
    expect(inner).toHaveBeenCalledTimes(2);
    expect(fs.files.size).toBe(0);
  });

  it("en disco: escribe el archivo sin keys ni imagen y la segunda corrida es hit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-cache-"));
    const previous = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "clave-secreta-de-prueba";
    try {
      const inner = okExtractor();
      const make = () => withExtractionCache(inner, { root: dir, ...TARGET, enabled: true, fingerprint: FINGERPRINT });
      await make().extractor(input({ pages: [{ ...PAGE, data: new TextEncoder().encode("IMAGEN-SECRETA") }] }));
      const files = readdirSync(join(dir, "google", "gemini-2.5-flash"));
      expect(files).toHaveLength(1);
      const text = readFileSync(join(dir, "google", "gemini-2.5-flash", files[0]), "utf8");
      expect(text).not.toContain("clave-secreta-de-prueba");
      expect(text).not.toContain("IMAGEN-SECRETA");
      expect(text).not.toContain(Buffer.from("IMAGEN-SECRETA").toString("base64"));
      const second = make();
      await second.extractor(input({ pages: [{ ...PAGE, data: new TextEncoder().encode("IMAGEN-SECRETA") }] }));
      expect(second.state.hits).toBe(1);
      expect(inner).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previous;
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);
    }
  });
});
