/**
 * @jest-environment node
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InvoiceExtraction } from "../../src/modules/invoice-scan/contracts";

import {
  acquireLabLock,
  assertFillMissingMatches,
  createOracleExtractor,
  displayPath,
  modelProviderFor,
  parseReplaySource,
  resolveAiKeys,
  summaryLines,
  type RunMeta,
  applyModelEnv,
  assertLocalSupabaseUrl,
  assertResolvedModel,
  loadLabSupabase,
  parseArgs,
  readAiKeys,
  releaseLabLock,
  runBaseName,
  toProductionExtractor,
  withQuotaCut,
  withResolvedModel,
  QUOTA_CUT_CODE,
} from "./run";
import { ORACLE_BANNER } from "./report";
import type { BenchExtractInput, BenchExtractResult, BenchExtractor, BenchResult } from "./runner";

const KEYS_FILE = [
  "# producción",
  "NEXT_PUBLIC_SUPABASE_URL=https://prod.supabase.co",
  "SUPABASE_SERVICE_ROLE_KEY=service-secreto",
  'GOOGLE_GENERATIVE_AI_API_KEY="g-key"',
  "ANTHROPIC_API_KEY = a-key",
  "GOOGLE_GENERATIVE_AI_API_KEY_OLD=no",
  "XANTHROPIC_API_KEY=no",
  "",
].join("\r\n");

describe("readAiKeys", () => {
  it("solo toma las dos keys de IA y nada más del archivo", () => {
    const keys = readAiKeys(KEYS_FILE);
    expect(keys).toEqual({ GOOGLE_GENERATIVE_AI_API_KEY: "g-key", ANTHROPIC_API_KEY: "a-key" });
    expect(JSON.stringify(keys)).not.toContain("service-secreto");
    expect(JSON.stringify(keys)).not.toContain("prod.supabase.co");
  });
});

describe("applyModelEnv", () => {
  it("deja solo la key del proveedor pedido, borra la heredada del otro y no filtra el resto", () => {
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: "heredada", PATH: "x" };
    applyModelEnv(env, { provider: "google", model: "gemini-2.5-flash" }, readAiKeys(KEYS_FILE));
    expect(env).toEqual({
      PATH: "x",
      GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
      INVOICE_SCAN_PROVIDER: "google",
      INVOICE_SCAN_MODEL: "gemini-2.5-flash",
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it("mock no necesita keys y aborta si falta la del proveedor real", () => {
    const env: Record<string, string | undefined> = { GOOGLE_GENERATIVE_AI_API_KEY: "heredada" };
    applyModelEnv(env, { provider: "mock" }, {});
    expect(env).toEqual({ INVOICE_SCAN_PROVIDER: "mock" });
    expect(() => applyModelEnv({}, { provider: "anthropic" }, { GOOGLE_GENERATIVE_AI_API_KEY: "g" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("assertLocalSupabaseUrl / loadLabSupabase", () => {
  it("acepta 127.0.0.1 y localhost; rechaza cualquier otro host", () => {
    expect(assertLocalSupabaseUrl("http://127.0.0.1:14321")).toBe("http://127.0.0.1:14321");
    expect(assertLocalSupabaseUrl("http://localhost:54321")).toBe("http://localhost:54321");
    expect(() => assertLocalSupabaseUrl("https://abc.supabase.co")).toThrow(/abc\.supabase\.co/);
    expect(() => assertLocalSupabaseUrl("http://127.0.0.1.evil.com")).toThrow(/solo corre contra/);
    expect(() => assertLocalSupabaseUrl(undefined)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => assertLocalSupabaseUrl("no-url")).toThrow(/no es una URL/);
  });

  it("solo lee .env.stock-lab (no el .example) y valida la URL", () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-eval-env-"));
    try {
      writeFileSync(join(dir, ".env.stock-lab.example"), "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1\nNEXT_PUBLIC_SUPABASE_ANON_KEY=k\n");
      expect(() => loadLabSupabase(dir)).toThrow(/No existe/);
      writeFileSync(join(dir, ".env.stock-lab"), "NEXT_PUBLIC_SUPABASE_URL=https://prod.example.com\nNEXT_PUBLIC_SUPABASE_ANON_KEY=k\n");
      expect(() => loadLabSupabase(dir)).toThrow(/prod\.example\.com/);
      writeFileSync(join(dir, ".env.stock-lab"), "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:14321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\n");
      expect(() => loadLabSupabase(dir)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
      writeFileSync(
        join(dir, ".env.stock-lab"),
        "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:14321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\nSUPABASE_SERVICE_ROLE_KEY=sr\n",
      );
      expect(loadLabSupabase(dir)).toEqual({ url: "http://127.0.0.1:14321", anonKey: "anon", serviceRoleKey: "sr" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseArgs", () => {
  it("lee todos los flags y aplica defaults", () => {
    const options = parseArgs(
      ["--provider", "google", "--model=gemini-3.8-flash", "--only", "f01, f02", "--no-fewshot", "--concurrency", "3", "--out", "out", "--label", "prueba A"],
      "C:\\base",
    );
    expect(options).toMatchObject({
      provider: "google",
      model: "gemini-3.8-flash",
      only: ["f01", "f02"],
      fewShot: false,
      concurrency: 3,
      label: "prueba A",
    });
    expect(options.out).toBe(join("C:\\base", "out"));
    const defaults = parseArgs(["--provider", "mock"]);
    expect(defaults.fewShot).toBe(true);
    expect(defaults.concurrency).toBe(2);
    expect(defaults.model).toBeUndefined();
    expect(defaults.out).toBe(join(__dirname, "runs"));
    expect(defaults.keysEnv).toMatch(/control-ventas[\\/]\.env\.local$/);
  });

  it("rechaza provider ausente o inválido, flags desconocidos y valores faltantes", () => {
    expect(() => parseArgs([])).toThrow(/--provider es obligatorio/);
    expect(() => parseArgs(["--provider", "openai"])).toThrow(/no es válido/);
    expect(() => parseArgs(["--provider", "mock", "--foo"])).toThrow(/desconocido/);
    expect(() => parseArgs(["--provider", "mock", "--model"])).toThrow(/necesita un valor/);
    expect(() => parseArgs(["--provider", "mock", "--concurrency", "0"])).toThrow(/entero/);
  });
});

describe("assertResolvedModel", () => {
  it("aborta si la factory cae a otro proveedor, a mock o a otro modelo", () => {
    expect(() => assertResolvedModel({ provider: "google", model: "gemini-2.5-flash" }, { provider: "mock", modelId: "invoice-scan-mock" })).toThrow(
      /resolvió "mock"/,
    );
    expect(() => assertResolvedModel({ provider: "anthropic" }, { provider: "google", modelId: "gemini-2.5-flash" })).toThrow(/resolvió "google"/);
    expect(() => assertResolvedModel({ provider: "google", model: "gemini-3.8-flash" }, { provider: "google", modelId: "gemini-2.5-flash" })).toThrow(
      /gemini-2\.5-flash/,
    );
    expect(() => assertResolvedModel({ provider: "mock" }, { provider: "mock", modelId: "invoice-scan-mock" })).not.toThrow();
    expect(() => assertResolvedModel({ provider: "anthropic" }, { provider: "anthropic", modelId: "claude-haiku-4-5" })).not.toThrow();
  });
});

describe("cerrojo del lab", () => {
  it("toma, rechaza si está ocupado y solo libera el propio", () => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-eval-lock-"));
    const path = join(dir, "sub", "lab.lock");
    try {
      const stamp = acquireLabLock(path, new Date("2026-10-16T01:30:00Z"));
      expect(stamp).toBe("evaluacion-bench 21:30");
      expect(() => acquireLabLock(path)).toThrow(/ocupado.*evaluacion-bench 21:30/);
      releaseLabLock(path, "otro");
      expect(existsSync(path)).toBe(true);
      releaseLabLock(path, stamp);
      expect(existsSync(path)).toBe(false);
      writeFileSync(path, "caos-4 10:00\n");
      expect(() => acquireLabLock(path)).toThrow(/caos-4 10:00/);
      expect(readFileSync(path, "utf8")).toBe("caos-4 10:00\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const EXTRACTION: InvoiceExtraction = {
  supplier: { name: "Chevere Depot", taxId: "J-508357612" },
  currency: "VES",
  lines: [
    { rawText: "GLUP COLA 2L [BULTO X 6]", description: "Glup cola 2L", quantity: 2, unit: "bulto", unitsPerPack: 6, unitPrice: 10, lineTotal: 20, confidence: 0.9 },
  ],
  confidence: 0.9,
  warnings: [],
} as unknown as InvoiceExtraction;

function result(): BenchExtractResult {
  return { extraction: EXTRACTION, provider: "google", modelId: "m", inputTokens: 1, outputTokens: 1, durationMs: 1, pages: 1 };
}

const PAGE = { data: new Uint8Array([1]), mediaType: "image/jpeg" as const };

describe("toProductionExtractor", () => {
  it("pasa el few-shot como formato saneado (sin cabecera) y descarta los inválidos", async () => {
    const extract = jest.fn(async () => result());
    const model = { provider: "google", modelId: "m" } as unknown as Parameters<typeof toProductionExtractor>[1];
    const extractor = toProductionExtractor(extract as never, model);
    await extractor({ pages: [PAGE], fewShot: [{ page: PAGE, confirmed: EXTRACTION }, { confirmed: { ...EXTRACTION, lines: [] } }] });
    const call = extract.mock.calls[0] as unknown as [{ fewShot: { format: { currency: string; lines: unknown[] } }[]; model: unknown }];
    expect(call[0].model).toBe(model);
    expect(call[0].fewShot).toHaveLength(1);
    expect(call[0].fewShot[0].format.currency).toBe("VES");
    expect(JSON.stringify(call[0].fewShot)).not.toContain("Chevere");
  });
});

describe("withQuotaCut", () => {
  const input: BenchExtractInput = { pages: [PAGE] };
  const quota = () => Object.assign(new Error("cuota"), { code: "QUOTA" });

  it("corta tras 3 QUOTA seguidas sin volver a llamar al modelo", async () => {
    const inner = jest.fn<ReturnType<BenchExtractor>, Parameters<BenchExtractor>>(async () => {
      throw quota();
    });
    const guard = withQuotaCut(inner);
    for (let i = 0; i < 3; i += 1) await expect(guard.extractor(input)).rejects.toMatchObject({ code: "QUOTA" });
    await expect(guard.extractor(input)).rejects.toMatchObject({ code: QUOTA_CUT_CODE });
    expect(inner).toHaveBeenCalledTimes(3);
    expect(guard.state).toMatchObject({ cut: true, skipped: 1 });
  });

  it("un éxito o un error distinto reinicia la racha", async () => {
    const outcomes = ["q", "q", "ok", "q", "q", "x", "q", "q"];
    const inner: BenchExtractor = async () => {
      const next = outcomes.shift();
      if (next === "ok") return result();
      throw next === "q" ? quota() : new Error("otro");
    };
    const guard = withQuotaCut(inner);
    for (let i = 0; i < 8; i += 1) await guard.extractor(input).catch(() => undefined);
    expect(guard.state.cut).toBe(false);
  });
});

describe("withResolvedModel", () => {
  it("rellena proveedor/modelo solo si el runner no los supo (todas fallaron)", () => {
    const base = { meta: { provider: "desconocido", modelId: "desconocido" } } as unknown as BenchResult;
    expect(withResolvedModel(base, { provider: "google", modelId: "gemini-3.8-flash" }).meta).toMatchObject({
      provider: "google",
      modelId: "gemini-3.8-flash",
    });
    const known = { meta: { provider: "google", modelId: "gemini-2.5-flash" } } as unknown as BenchResult;
    expect(withResolvedModel(known, { provider: "google", modelId: "otro" })).toBe(known);
  });
});

describe("runBaseName", () => {
  it("fecha de Caracas, proveedor, modelo y etiqueta", () => {
    expect(runBaseName({ date: new Date("2026-10-16T02:00:00Z"), provider: "google", model: "gemini-3.8-flash", label: "Sin Few Shot" })).toBe(
      "2026-10-15-google-gemini-3.8-flash-sin-few-shot",
    );
    expect(runBaseName({ date: new Date("2026-10-16T12:00:00Z"), provider: "mock", model: "invoice-scan-mock" })).toBe("2026-10-16-mock-invoice-scan-mock");
  });
});

describe("modos oráculo y replay (SCN-10l)", () => {
  it("parseArgs: oráculo sin few-shot; replay sin provider; --fill-missing exige provider y model", () => {
    expect(parseArgs(["--provider", "oracle"])).toMatchObject({ provider: "oracle", fewShot: false, fillMissing: false });
    const replay = parseArgs(["--replay", "runs/x.json"], "C:\\base");
    expect(replay.replay).toBe(join("C:\\base", "runs/x.json"));
    expect(replay.provider).toBeUndefined();
    expect(parseArgs(["--replay", "x.json", "--fill-missing", "--provider", "google", "--model", "m"])).toMatchObject({
      fillMissing: true,
      provider: "google",
      model: "m",
    });
    expect(() => parseArgs(["--provider", "google", "--fill-missing"])).toThrow(/solo vale con --replay/);
    expect(() => parseArgs(["--replay", "x.json", "--fill-missing", "--provider", "google"])).toThrow(/exige --provider y --model/);
    expect(() => parseArgs(["--replay", "x.json", "--provider", "google"])).toThrow(/no llama a ningún modelo/);
    expect(() => parseArgs(["--replay", "x.json", "--provider", "oracle"])).toThrow(/modos distintos/);
    expect(() => parseArgs(["--replay", "x.json", "--no-fewshot"])).toThrow(/corrida de origen/);
    expect(() => parseArgs(["--provider", "oracle", "--model", "m"])).toThrow(/no usa --model/);
  });

  it("no se leen keys en oráculo, replay sin --fill-missing ni mock; sí con llamadas reales", () => {
    const base = { keysEnv: "C:\keys.env", fillMissing: false };
    const readFile = jest.fn(() => KEYS_FILE);
    expect(resolveAiKeys({ ...base, provider: "oracle" }, readFile)).toEqual({});
    expect(resolveAiKeys({ ...base, replay: "x.json" }, readFile)).toEqual({});
    expect(resolveAiKeys({ ...base, provider: "mock" }, readFile)).toEqual({});
    expect(readFile).not.toHaveBeenCalled();
    expect(modelProviderFor({ provider: "oracle", fillMissing: false })).toBeNull();
    expect(modelProviderFor({ replay: "x.json", fillMissing: false })).toBeNull();
    expect(resolveAiKeys({ ...base, replay: "x.json", fillMissing: true, provider: "google" }, readFile).GOOGLE_GENERATIVE_AI_API_KEY).toBe("g-key");
    expect(resolveAiKeys({ ...base, provider: "anthropic" }, readFile).ANTHROPIC_API_KEY).toBe("a-key");
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenCalledWith("C:\keys.env");
  });

  it("oráculo: devuelve la verdad sin tokens ni duración", async () => {
    const truth = { id: "f01", extraction: EXTRACTION } as unknown as NonNullable<BenchExtractInput["invoice"]>["truth"];
    const out = await createOracleExtractor()({ pages: [PAGE], invoice: { id: "f01", bucket: "sinAlias", truth } });
    expect(out).toEqual({ extraction: EXTRACTION, provider: "oracle", modelId: "verdad", inputTokens: null, outputTokens: null, durationMs: 0, pages: 1 });
    await expect(createOracleExtractor()({ pages: [PAGE] })).rejects.toThrow(/no indicó la factura/);
  });

  it("parseReplaySource valida el archivo y --fill-missing exige el mismo proveedor/modelo", () => {
    expect(() => parseReplaySource({ foo: 1 }, "x.json")).toThrow(/no es un run.json/);
    const source = parseReplaySource(
      {
        meta: { provider: "google", modelId: "gemini-2.5-flash", fewShot: false },
        perInvoice: [
          { id: "f01", bucket: "sinAlias", predicted: EXTRACTION, tokens: { input: 5, output: 6 }, durationMs: 7 },
          { id: "f02", bucket: "sinAlias", predicted: null },
        ],
      },
      "x.json",
    );
    expect([...source.entries.keys()]).toEqual(["f01:sinAlias"]);
    expect(source.entries.get("f01:sinAlias")).toMatchObject({ inputTokens: 5, outputTokens: 6, durationMs: 7 });
    expect(() => assertFillMissingMatches({ provider: "google", model: "gemini-2.5-flash" }, source)).not.toThrow();
    expect(() => assertFillMissingMatches({ provider: "google", model: "gemini-3.8-flash" }, source)).toThrow(/--model gemini-2.5-flash/);
    expect(() => assertFillMissingMatches({ provider: "anthropic", model: "gemini-2.5-flash" }, source)).toThrow(/--provider google/);
  });

  it("nombre de archivo, resumen y JSON marcan el modo", () => {
    const date = new Date("2026-10-15T15:00:00Z");
    expect(runBaseName({ date, provider: "oracle", model: "verdad", mode: "oracle" })).toBe("2026-10-15-oraculo-solo-emparejamiento");
    expect(runBaseName({ date, provider: "google", model: "gemini-2.5-flash", mode: "replay" })).toBe("2026-10-15-replay-google-gemini-2.5-flash");

    const agg = (rate: number) => ({
      headerFieldRate: 1,
      linesDetectedRate: 1,
      exactRate: 1,
      matchOkRate: rate,
      confirmedWrongRate: 0,
    });
    const result = {
      meta: { provider: "oracle", modelId: "verdad", date: date.toISOString(), fewShot: false, invoices: { real: 1, synthetic: 0 } },
      perInvoice: [],
      pairs: [],
      global: {
        all: {
          byBucket: { sinAlias: agg(0.5), conAlias: agg(0.9) },
          total: { p95DurationMs1Page: 0, avgCostUsd: null, inputTokens: 0, outputTokens: 0 },
        },
      },
      targets: { ok: true, checks: [] },
    } as unknown as BenchResult;
    const meta: RunMeta = { mode: "oracle", notice: ORACLE_BANNER, requested: { provider: "oracle" }, fewShot: false, quotaCut: false, quotaSkipped: 0 };
    const lines = summaryLines(result, meta, { markdownPath: "x.md" });
    expect(lines[0]).toContain(ORACLE_BANNER);
    expect(lines.find((l) => l.startsWith("Cabecera"))).toContain("n/a (oráculo)");
    expect(lines.find((l) => l.startsWith("Exactitud"))).toContain("n/a (oráculo)");
    expect(lines.find((l) => l.startsWith("Emparejadas OK"))).toContain("50.0%");
    expect(lines.find((l) => l.startsWith("p95"))).toContain("n/a (oráculo)");

    const replayMeta: RunMeta = {
      mode: "replay",
      requested: {},
      fewShot: true,
      quotaCut: false,
      quotaSkipped: 0,
      replay: { source: "runs/o.json", sourceProvider: "google", sourceModel: "m", fillMissing: false, replayed: 3, missing: 1, filled: 0, usage: "de la corrida original" },
    };
    const replayLines = summaryLines(result, replayMeta, { markdownPath: "x.md" });
    expect(replayLines[0]).toBe("REPLAY de runs/o.json: reutilizadas 3, sin extracción 1");
    expect(replayLines.find((l) => l.startsWith("$/factura"))).toContain("(de la corrida original)");
    expect(displayPath(join(__dirname, "runs", "a.json"), join(__dirname, "..", ".."))).toBe("scripts/invoice-eval/runs/a.json");
  });
});
