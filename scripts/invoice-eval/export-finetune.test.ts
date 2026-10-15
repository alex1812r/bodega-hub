/**
 * @jest-environment node
 *
 * SCN-12 · exportador del dataset de ajuste supervisado de Gemini (Vertex AI).
 * Parte pura (sin base) + una corrida contra la base LAB (tienda `eval-facturas`,
 * la siembra `npx tsx scripts/invoice-eval/seed-lab.ts`). Sin lab, esa parte se salta.
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";

import { invoiceExtractionSchema, type InvoiceExtraction } from "../../src/modules/invoice-scan/contracts";
import { tryConnect } from "../stock-lab/db-test-utils";
import { assertAllowedWriteHost, loadStockLabEnv } from "../stock-lab/env";

import {
  INVOICE_SCANS_BUCKET,
  SYSTEM_INSTRUCTION,
  buildTuningExample,
  estimateTokens,
  invoiceScanPagePaths,
  loadExportEnv,
  mimeTypeFromHeader,
  parseArgs,
  reconstructExtraction,
  runExport,
  splitTrainValidation,
  validationPath,
  type InvoiceScanExportRow,
} from "./export-finetune";
import { loadScenarioIds } from "./seed-lab";

const STORE = "11111111-2222-4333-8444-555555555555";
const SHA = "a".repeat(64);
const PRODUCT = "99999999-8888-4777-8666-555555555555";
const PREFIX = "gs://mi-bucket/invoice-scans";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extraction(): InvoiceExtraction {
  return {
    supplier: { name: "CHEVERE DEPOT, C.A", taxId: "508357612" },
    number: "00006894",
    date: "2026-10-12",
    currency: "VES",
    printedRate: 875.65,
    lines: [
      {
        rawText: "GLUP COLA 2L [BULTO X 6,00]",
        description: "Glup cola 2L",
        quantity: 1,
        unit: "bulto",
        unitsPerPack: 6,
        unitPrice: 5726.75,
        lineTotal: 5726.75,
        confidence: 0.9,
      },
      {
        rawText: "HARINA PAN 1KG BULTO",
        description: "Harina PAN 1kg",
        quantity: 2,
        unit: "bulto",
        unitPrice: 1200,
        lineTotal: 2400,
        confidence: 0.6,
      },
    ],
    total: 8126.75,
    confidence: 0.8,
    warnings: [],
  };
}

function confirmedLines(ext: InvoiceExtraction, overrides: Record<number, number | null> = {}) {
  return {
    confirmedAt: "2026-10-15T12:00:00.000Z",
    purchaseId: randomUUID(),
    supplierId: randomUUID(),
    lines: ext.lines.map((line, lineIndex) => ({
      lineIndex,
      productId: PRODUCT,
      packLabel: null,
      unitsPerPack: lineIndex in overrides ? overrides[lineIndex] : (line.unitsPerPack ?? null),
      aliasNorm: line.rawText.toLowerCase(),
      rawText: line.rawText,
    })),
  };
}

function row(partial: Partial<InvoiceScanExportRow> = {}): InvoiceScanExportRow {
  const ext = extraction();
  return {
    id: randomUUID(),
    storage_path: `${STORE}/${SHA}/p1.jpg`,
    pages: 1,
    extracted: ext,
    confirmed: confirmedLines(ext),
    ...partial,
  };
}

describe("buildTuningExample (puro)", () => {
  it("fila confirmada → línea JSONL con la forma exacta de Vertex y JSON válido sin ids internos", () => {
    const result = buildTuningExample(row(), { gcsPrefix: `${PREFIX}/` });
    if (!result.ok) throw new Error(result.reason);

    const parsed = JSON.parse(result.line) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["systemInstruction", "contents"]);
    expect(parsed.systemInstruction).toEqual({ parts: [{ text: SYSTEM_INSTRUCTION }] });
    expect(result.line).not.toContain("\n");

    const [user, model] = result.example.contents;
    expect(result.example.contents).toHaveLength(2);
    expect(user.role).toBe("user");
    expect(user.parts).toEqual([
      { fileData: { mimeType: "image/jpeg", fileUri: `${PREFIX}/${STORE}/${SHA}/p1.jpg` } },
      { text: "Extrae la factura de esta imagen como JSON." },
    ]);
    expect(model.role).toBe("model");
    expect(model.parts).toHaveLength(1);
    for (const part of [...user.parts, ...model.parts]) {
      expect(Object.keys(part)).toHaveLength(1);
    }

    const answer = JSON.parse(model.parts[0].text) as unknown;
    expect(invoiceExtractionSchema.safeParse(answer).success).toBe(true);
    expect(model.parts[0].text).not.toMatch(UUID);
    expect(model.parts[0].text).not.toMatch(/productId|supplierId|purchaseId|aliasNorm|lineIndex/);
    expect(result.source).toBe("confirmed-lines");
  });

  it("multipágina: una parte fileData por página, en orden, y luego la instrucción", () => {
    const result = buildTuningExample(row({ storage_path: `${STORE}/${SHA}/p1.png`, pages: 3 }), {
      gcsPrefix: PREFIX,
    });
    if (!result.ok) throw new Error(result.reason);
    const parts = result.example.contents[0].parts;
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3)).toEqual(
      [1, 2, 3].map((page) => ({
        fileData: { mimeType: "image/png", fileUri: `${PREFIX}/${STORE}/${SHA}/p${page}.png` },
      })),
    );
    expect(parts[3]).toEqual({ text: "Extrae la factura de estas 3 páginas (en orden) como un único JSON." });
    expect(result.imagePaths).toEqual(invoiceScanPagePaths(`${STORE}/${SHA}/p1.png`, 3));
  });

  it("aplica el empaque confirmado y conserva cantidades y precios leídos", () => {
    const ext = extraction();
    const result = reconstructExtraction({ extracted: ext, confirmed: confirmedLines(ext, { 1: 12 }) });
    if (!result.ok) throw new Error(result.reason);
    expect(result.extraction.lines[1]).toMatchObject({ unitsPerPack: 12, quantity: 2, unitPrice: 1200, lineTotal: 2400 });
    // null (modo unidad) no borra el empaque leído.
    const unitMode = reconstructExtraction({ extracted: ext, confirmed: confirmedLines(ext, { 0: null }) });
    if (!unitMode.ok) throw new Error(unitMode.reason);
    expect(unitMode.extraction.lines[0]?.unitsPerPack).toBe(6);
  });

  it("confirmed con forma InvoiceExtraction se usa tal cual y pierde las claves ajenas al schema", () => {
    const corrected = { ...extraction(), total: 9000, productId: PRODUCT };
    const result = buildTuningExample(row({ confirmed: corrected }), { gcsPrefix: PREFIX });
    if (!result.ok) throw new Error(result.reason);
    expect(result.source).toBe("extraction");
    const answer = JSON.parse(result.example.contents[1].parts[0].text) as InvoiceExtraction;
    expect(answer.total).toBe(9000);
    expect(answer).not.toHaveProperty("productId");
  });

  it.each([
    ["confirmed no cubre todas las líneas", () => {
      const ext = extraction();
      const confirmed = confirmedLines(ext);
      confirmed.lines.pop();
      return row({ extracted: ext, confirmed });
    }, /no cubre todas las líneas/],
    ["rawText distinto", () => {
      const ext = extraction();
      const confirmed = confirmedLines(ext);
      confirmed.lines[0]!.rawText = "OTRA COSA";
      return row({ extracted: ext, confirmed });
    }, /rawText/],
    ["índice fuera de extracted", () => {
      const ext = extraction();
      const confirmed = confirmedLines(ext);
      confirmed.lines.push({ ...confirmed.lines[0]!, lineIndex: 9 });
      return row({ extracted: ext, confirmed });
    }, /no existe/],
    ["extracted inválido", () => row({ extracted: { lines: [] } }), /extracted no cumple/],
    ["forma desconocida", () => row({ confirmed: { foo: 1 } }), /forma desconocida/],
    ["más de 30 páginas", () => row({ storage_path: `${STORE}/${SHA}/p1.jpg`, pages: 31 }), /30 imágenes/],
    ["multipágina sin convención", () => row({ storage_path: `${STORE}/factura.jpg`, pages: 2 }), /convención/],
    ["ruta con ..", () => row({ storage_path: `${STORE}/../x/p1.jpg` }), /storage_path inválido/],
    ["formato no admitido", () => row({ storage_path: `${STORE}/${SHA}/p1.gif` }), /formato/],
    ["id interno en la salida", () => {
      const ext = extraction();
      ext.lines[0]!.description = `ver ${PRODUCT}`;
      return row({ extracted: ext, confirmed: ext });
    }, /id interno/],
  ])("omite la fila no reconstruible: %s", (_label, make, reason) => {
    const result = buildTuningExample(make(), { gcsPrefix: PREFIX });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it("exige --gcs-prefix gs:// y usa el MIME de cabecera si se descargó", () => {
    expect(() => buildTuningExample(row(), { gcsPrefix: "https://x/y" })).toThrow(/gs:\/\//);
    const path = `${STORE}/${SHA}/p1.jpg`;
    const result = buildTuningExample(row(), { gcsPrefix: PREFIX, mimeOverrides: { [path]: "image/png" } });
    if (!result.ok) throw new Error(result.reason);
    expect(result.example.contents[0].parts[0]).toEqual({ fileData: { mimeType: "image/png", fileUri: `${PREFIX}/${path}` } });
    expect(mimeTypeFromHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(mimeTypeFromHeader(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });

  it("omite un ejemplo que supera 131.072 tokens estimados", () => {
    const ext = extraction();
    ext.warnings = ["x".repeat(400_000)];
    const result = buildTuningExample(row({ extracted: ext, confirmed: ext }), { gcsPrefix: PREFIX });
    expect(result.ok).toBe(false);
    const small = buildTuningExample(row(), { gcsPrefix: PREFIX });
    if (!small.ok) throw new Error(small.reason);
    expect(estimateTokens(small.example)).toBeLessThan(131_072);
  });
});

describe("splitTrainValidation y CLI (puro)", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({ id: `scan-${index}` }));

  it("es determinista por hash del id e independiente del orden", () => {
    const first = splitTrainValidation(items, 0.1);
    const second = splitTrainValidation([...items].reverse(), 0.1);
    expect(new Set(second.validation.map((item) => item.id))).toEqual(new Set(first.validation.map((item) => item.id)));
    expect(first.train.length + first.validation.length).toBe(1000);
    expect(first.validation.length).toBeGreaterThan(60);
    expect(first.validation.length).toBeLessThan(140);
    expect(splitTrainValidation(items, 0).validation).toHaveLength(0);
    expect(() => splitTrainValidation(items, 1)).toThrow();
  });

  it("parseArgs valida opciones obligatorias y defaults", () => {
    expect(() => parseArgs(["--gcs-prefix", PREFIX])).toThrow(/--store/);
    expect(() => parseArgs(["--store", "x"])).toThrow(/--gcs-prefix/);
    expect(() => parseArgs(["--store", "x", "--gcs-prefix", "s3://b"])).toThrow(/gs:\/\//);
    expect(() => parseArgs(["--store", "x", "--gcs-prefix", PREFIX, "--since", "15/10/2026"])).toThrow(/YYYY-MM-DD/);
    const options = parseArgs(["--store", "eval-facturas", `--gcs-prefix=${PREFIX}`, "--out", "x.jsonl"]);
    expect(options).toMatchObject({ store: "eval-facturas", validationRatio: 0.1, envFile: ".env.stock-lab", allowRemote: false });
    expect(options.out).toBe(resolve("x.jsonl"));
    expect(options.downloadDir).toBeUndefined();
    expect(validationPath("/tmp/a.jsonl")).toBe("/tmp/a.validation.jsonl");
    expect(parseArgs(["--store", "x", "--gcs-prefix", PREFIX]).out).toMatch(/\.notes[\\/]factura-escaneo/);
  });
});

describe("loadExportEnv (puro)", () => {
  const dir = mkdtempSync(join(tmpdir(), "scn12-env-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function envFile(url: string): string {
    const path = join(dir, `env-${randomUUID()}`);
    writeFileSync(path, `NEXT_PUBLIC_SUPABASE_URL=${url}\nSUPABASE_SERVICE_ROLE_KEY=secreto-que-no-se-imprime\n`);
    return path;
  }

  it("exige --allow-remote para una URL no local, avisa y nunca imprime la clave", () => {
    const warn = jest.fn();
    const remote = envFile("https://abc.supabase.co");
    expect(() => loadExportEnv(remote, false, { log: jest.fn(), warn })).toThrow(/--allow-remote/);
    expect(loadExportEnv(remote, true, { log: jest.fn(), warn }).supabaseUrl).toBe("https://abc.supabase.co");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/REMOTA/));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secreto");
    expect(() => loadExportEnv(envFile("http://127.0.0.1:14321"), false, { log: jest.fn(), warn: jest.fn() })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Contra la base LAB
// ---------------------------------------------------------------------------

function labEnv(): Record<string, string> | null {
  try {
    const env = loadStockLabEnv(resolve(__dirname, "../.."));
    if (!env.STOCK_LAB_DB_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    assertAllowedWriteHost(env.STOCK_LAB_DB_URL, env.STOCK_TEST_ALLOW_WRITES_HOST, env);
    assertAllowedWriteHost(env.NEXT_PUBLIC_SUPABASE_URL ?? "", env.STOCK_TEST_ALLOW_WRITES_HOST, env);
    return env;
  } catch {
    return null;
  }
}

const PROBE = [
  'const { Client } = require("pg");',
  "const c = new Client({ connectionString: process.env.PROBE_URL, connectionTimeoutMillis: 2000 });",
  "c.connect()",
  "  .then(() => c.query(\"select to_regclass('public.invoice_scans') is not null and exists (select 1 from public.stores where slug = 'eval-facturas') as ok\"))",
  '  .then((r) => { process.stdout.write(r.rows[0].ok ? "ok" : "no"); return c.end(); })',
  '  .catch(() => process.stdout.write("no"))',
  "  .then(() => process.exit(0));",
].join("\n");

const LAB = labEnv();
const labReady =
  LAB !== null &&
  spawnSync(process.execPath, ["-e", PROBE], {
    cwd: resolve(__dirname, "../.."),
    encoding: "utf8",
    timeout: 6000,
    env: { ...process.env, PROBE_URL: LAB.STOCK_LAB_DB_URL },
  }).stdout?.trim() === "ok";

if (!labReady) {
  console.warn("Base lab sin invoice_scans o sin la tienda eval-facturas: se salta la corrida contra el lab de export-finetune.");
}

const describeLab = labReady ? describe : describe.skip;

describeLab("runExport contra la base lab (tienda eval-facturas)", () => {
  let db: Client | null = null;
  let admin: SupabaseClient;
  const ids: string[] = [];
  const objects: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "scn12-"));
  const silent = { log: () => undefined, warn: () => undefined };

  beforeAll(async () => {
    const env = LAB!;
    db = await tryConnect(env.STOCK_LAB_DB_URL!);
    if (!db) throw new Error("La base lab no responde");
    admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const scenario = await loadScenarioIds(admin);
    if (!scenario.userId) throw new Error("El escenario no tiene usuario admin");

    const ext = extraction();
    const fixtures = [
      { pages: 1, ext: "jpg", confirmed: { ...ext, total: 9000 }, at: "2099-01-01T12:00:00-04:00" },
      { pages: 2, ext: "png", confirmed: confirmedLines(ext, { 1: 12 }), at: "2099-01-02T12:00:00-04:00" },
    ];
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

    for (const fixture of fixtures) {
      const sha = randomBytes(32).toString("hex");
      const path = `${scenario.storeId}/${sha}/p1.${fixture.ext}`;
      const inserted = await db.query<{ id: string }>(
        `insert into public.invoice_scans
           (store_id, created_by, image_sha256, storage_path, pages, provider, model, extracted, matched,
            confirmed, status, created_at, confirmed_at)
         values ($1, $2, $3, $4, $5, 'test', 'scn-12', $6, '{}'::jsonb, $7, 'confirmed', $8, $8)
         returning id`,
        [scenario.storeId, scenario.userId, sha, path, fixture.pages, JSON.stringify(ext), JSON.stringify(fixture.confirmed), fixture.at],
      );
      ids.push(inserted.rows[0]!.id);
      for (const page of invoiceScanPagePaths(path, fixture.pages)) {
        const upload = await admin.storage.from(INVOICE_SCANS_BUCKET).upload(page, fixture.ext === "jpg" ? jpeg : png, {
          contentType: fixture.ext === "jpg" ? "image/jpeg" : "image/png",
          upsert: true,
        });
        if (upload.error) throw new Error(`upload: ${upload.error.message}`);
        objects.push(page);
      }
    }
  });

  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from(INVOICE_SCANS_BUCKET).remove(objects);
    if (db) {
      if (ids.length > 0) await db.query("delete from public.invoice_scans where id = any($1::uuid[])", [ids]);
      await db.end();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("exporta 2 líneas JSONL válidas y descarga las 3 páginas", async () => {
    const out = join(dir, "train.jsonl");
    const summary = await runExport(
      {
        store: "eval-facturas",
        gcsPrefix: PREFIX,
        out,
        since: "2099-01-01",
        validationRatio: 0,
        downloadDir: join(dir, "img"),
        envFile: resolve(__dirname, "../../.env.stock-lab"),
        allowRemote: false,
      },
      silent,
    );

    expect(summary).toMatchObject({ rows: 2, examples: 2, images: 3, downloaded: 3, skipped: [] });
    expect(summary.warnings.join(" ")).toMatch(/100–500/);
    const lines = readFileSync(out, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const example = JSON.parse(line) as { contents: { parts: { text?: string }[] }[] };
      const answer = example.contents[1]!.parts[0]!.text!;
      expect(invoiceExtractionSchema.safeParse(JSON.parse(answer)).success).toBe(true);
      expect(answer).not.toMatch(UUID);
    }
    expect(lines[1]).toContain('\\"unitsPerPack\\":12');
    for (const object of objects) expect(existsSync(join(dir, "img", object))).toBe(true);
  });
});
