/**
 * @jest-environment node
 */
/**
 * INT-01 · `matchScan` ya no es el stub de Extracción: empareja con
 * `matchInvoice` sobre el contexto de la tienda (Supabase: `loadMatchContext`
 * con la sesión del usuario; mock: `loadMockMatchContext`), excluyendo el
 * escaneo reservado de su propia detección de duplicados.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mockContacts, mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";
import { buildContext, buildExtraction, buildLine, SUPPLIER_POLAR } from "./__fixtures__/match/context";
import { singlePageExtraction } from "./__fixtures__/extractions";
import { resetMockInvoiceScans } from "./confirmScan.mock-server";
import type { MatchContextSupabaseClient } from "./loadMatchContext";
import { matchInvoice } from "./match";
import {
  createMatchScan,
  matchScan,
  normalizeExtractionForMatch,
  withCandidateSkus,
  type MatchScanDeps,
} from "./matchScan";
import { loadMockMatchContext } from "./matchContext.mock-server";
import { seedScanForTest } from "./scans.mock-server";

const supabase = { rpc: jest.fn(), from: jest.fn() } as unknown as MatchContextSupabaseClient;

function deps(overrides: Partial<MatchScanDeps> = {}) {
  return {
    createClient: jest.fn(async () => supabase),
    loadContext: jest.fn(async () => buildContext()),
    loadMockContext: jest.fn(() => buildContext()),
    ...overrides,
  } satisfies MatchScanDeps;
}

const polarExtraction = buildExtraction({
  lines: [buildLine({ supplierSku: "MAL-POLAR", rawText: "MALTA POLAR 355ML", quantity: 12, unitPrice: 50, lineTotal: 600 })],
});

describe("matchScan (Supabase)", () => {
  it("devuelve matchInvoice sobre loadMatchContext con la tienda de la sesión y excludeScanId del escaneo", async () => {
    const injected = deps();
    const matcher = createMatchScan(injected);

    const result = await matcher(polarExtraction, { dataSource: "supabase", scanId: "scan-9", storeId: "store-1" });

    expect(injected.createClient).toHaveBeenCalledTimes(1);
    expect(injected.loadContext).toHaveBeenCalledWith(supabase, "store-1", polarExtraction, { excludeScanId: "scan-9" });
    expect(injected.loadMockContext).not.toHaveBeenCalled();
    // REP-04: los candidatos llevan además el sku del producto del contexto.
    expect(result).toEqual(withCandidateSkus(matchInvoice(polarExtraction, buildContext()), buildContext().products));
    // No es el stub: el proveedor se resuelve y la línea sale emparejada.
    expect(result.supplier.contactId).toBe(SUPPLIER_POLAR);
    expect(result.lines[0]?.status).not.toBe("unmatched");
  });

  it("un fallo al cargar el contexto se propaga (scanService lo cierra como MATCH_ERROR)", async () => {
    const matcher = createMatchScan(deps({ loadContext: jest.fn(async () => Promise.reject(new Error("rpc caída"))) }));

    await expect(matcher(polarExtraction, { dataSource: "supabase", scanId: "s", storeId: "t" })).rejects.toThrow("rpc caída");
  });

  it("taxId vacío de Gemini (\"\" o espacios) llega a loadMatchContext y a matchInvoice como ausente", async () => {
    const loadContext = jest.fn<ReturnType<MatchScanDeps["loadContext"]>, Parameters<MatchScanDeps["loadContext"]>>(
      async () => buildContext(),
    );
    const matcher = createMatchScan(deps({ loadContext }));

    for (const taxId of ["", "   "]) {
      loadContext.mockClear();
      const extraction: InvoiceExtraction = { ...polarExtraction, supplier: { name: "Polar", taxId } };

      await matcher(extraction, { dataSource: "supabase", scanId: "s", storeId: "t" });

      const passed = loadContext.mock.calls[0]![2];
      expect(passed.supplier).toEqual({ name: "Polar" });
      expect("taxId" in passed.supplier).toBe(false);
    }
  });

  it("REP-01-F1: el proveedor elegido (supplierId) se da por resuelto y sus alias aprendidos confirman la línea", async () => {
    const extraction = buildExtraction({ supplier: { name: "Distribuidora Sintética El Ávila" } });
    const matcher = createMatchScan(deps());

    const free = await matcher(extraction, { dataSource: "supabase", scanId: "s", storeId: "t" });
    const chosen = await matcher(extraction, { dataSource: "supabase", scanId: "s", storeId: "t", supplierId: SUPPLIER_POLAR });
    const unknown = await matcher(extraction, { dataSource: "supabase", scanId: "s", storeId: "t", supplierId: "sup-otro" });

    expect(free.supplier.contactId).toBeUndefined();
    expect(free.lines[0]?.status).not.toBe("confirmed");
    expect(chosen.supplier.contactId).toBe(SUPPLIER_POLAR);
    expect(chosen.lines[0]).toMatchObject({ productId: "p-malta", status: "confirmed" });
    // Un proveedor que no está entre los candidatos no cambia nada.
    expect(unknown).toEqual(free);
  });

  it("matchScan por defecto llama a matchInvoice(extraction, await loadMatchContext(...)) (sin stub)", () => {
    const source = readFileSync(join(__dirname, "matchScan.ts"), "utf8");

    expect(source).not.toContain("PUNTO DE INTEGRACIÓN");
    expect(source).toContain("loadContext: loadMatchContext");
    expect(source).toContain("await deps.loadContext(supabase, storeId, extraction, { excludeScanId: scanId })");
    expect(source).toContain("withCandidateSkus(matchInvoice(extraction, context), context.products)");
  });
});

describe("normalizeExtractionForMatch", () => {
  it("conserva un RIF con contenido y la misma referencia", () => {
    expect(normalizeExtractionForMatch(singlePageExtraction)).toBe(singlePageExtraction);
  });

  it("quita el RIF vacío sin tocar el resto de la cabecera", () => {
    const normalized = normalizeExtractionForMatch({ ...singlePageExtraction, supplier: { name: "X", taxId: "" } });

    expect(normalized).toEqual({ ...singlePageExtraction, supplier: { name: "X" } });
  });

  it.each(["", "   ", "\t\n"])(
    "SCN-13a: número, teléfono, dirección, barcode y supplierSku %j quedan ausentes; el resto intacto",
    (blank) => {
      const [first, second, ...rest] = singlePageExtraction.lines;
      const input: InvoiceExtraction = {
        ...singlePageExtraction,
        lines: [
          { ...first!, barcode: blank, supplierSku: blank },
          { ...second!, barcode: "7591234567890", supplierSku: blank },
          ...rest,
        ],
        number: blank,
        supplier: { address: blank, name: "X", phone: blank, taxId: "J-1" },
      };

      const normalized = normalizeExtractionForMatch(input);
      const { number: _number, ...withoutNumber } = singlePageExtraction;
      void _number;

      expect(normalized).toEqual({
        ...withoutNumber,
        lines: [first, { ...second, barcode: "7591234567890" }, ...rest],
        supplier: { name: "X", taxId: "J-1" },
      });
      expect("number" in normalized).toBe(false);
      expect(["address", "phone"].some((key) => key in normalized.supplier)).toBe(false);
      expect(["barcode", "supplierSku"].some((key) => key in normalized.lines[0]!)).toBe(false);
      expect("supplierSku" in normalized.lines[1]!).toBe(false);
      // Idempotente y sin mutar la entrada.
      expect(normalizeExtractionForMatch(normalized)).toBe(normalized);
      expect(input.number).toBe(blank);
      expect(input.lines[0]!.barcode).toBe(blank);
    },
  );

  it("SCN-13a: el emparejamiento recibe sin barcode/supplierSku/número vacíos", async () => {
    const loadContext = jest.fn<ReturnType<MatchScanDeps["loadContext"]>, Parameters<MatchScanDeps["loadContext"]>>(
      async () => buildContext(),
    );
    const matcher = createMatchScan(deps({ loadContext }));
    const extraction: InvoiceExtraction = {
      ...singlePageExtraction,
      lines: singlePageExtraction.lines.map((line) => ({ ...line, barcode: " ", supplierSku: "" })),
      number: "",
    };

    await matcher(extraction, { dataSource: "supabase", scanId: "s", storeId: "t" });

    const passed = loadContext.mock.calls[0]![2];
    expect("number" in passed).toBe(false);
    expect(passed.lines.every((line) => !("barcode" in line) && !("supplierSku" in line))).toBe(true);
  });
});

describe("matchScan (mock)", () => {
  beforeEach(() => resetMockInvoiceScans());

  it("usa loadMockMatchContext con la tienda y el escaneo excluido", async () => {
    const injected = deps();

    await createMatchScan(injected)(polarExtraction, { dataSource: "mock", scanId: "scan-1", storeId: "store-1" });

    expect(injected.loadMockContext).toHaveBeenCalledWith("store-1", polarExtraction, {
      excludeScanId: "scan-1",
    });
    expect(injected.createClient).not.toHaveBeenCalled();
  });

  it("con el catálogo mock resuelve el proveedor por RIF y propone el producto por nombre", async () => {
    const supplier = mockContacts.find(
      (contact) => (contact.storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID && contact.type !== "cliente" && contact.taxId,
    )!;
    const product = mockProducts.find((row) => (row.storeId ?? DEFAULT_STORE_ID) === DEFAULT_STORE_ID && row.isActive)!;
    const extraction = buildExtraction({
      supplier: { name: supplier.name, taxId: supplier.taxId },
      lines: [buildLine({ rawText: product.name.toUpperCase(), description: product.name, supplierSku: undefined })],
    });

    const result = await matchScan(extraction, { dataSource: "mock", scanId: "s", storeId: DEFAULT_STORE_ID });

    expect(result.supplier.contactId).toBe(supplier.id);
    expect(result.lines[0]?.status).not.toBe("unmatched");
    expect([result.lines[0]?.productId, ...(result.lines[0]?.candidates ?? []).map((c) => c.productId)]).toContain(product.id);
  });

  it("taxId vacío en mock: el proveedor no se resuelve por un RIF vacío de otro contacto", () => {
    const context = loadMockMatchContext(DEFAULT_STORE_ID, normalizeExtractionForMatch({
      ...singlePageExtraction,
      supplier: { name: "Nadie Se Llama Así S.A.", taxId: "" },
    }));

    expect(context.supplierCandidates).toEqual([]);
  });

  it("los escaneos previos con el mismo número salen como duplicados, salvo el propio", async () => {
    const ctx = { storeId: DEFAULT_STORE_ID, userId: "user-1" };
    const seed = (sha: string) =>
      seedScanForTest(ctx, {
        extracted: { ...singlePageExtraction, number: "0001234" },
        imageSha256: sha.repeat(64),
        model: "mock",
        provider: "mock",
        storagePath: `${DEFAULT_STORE_ID}/${sha.repeat(64)}/p1.jpg`,
      });
    const previous = await seed("a");
    const own = await seed("b");

    const context = loadMockMatchContext(DEFAULT_STORE_ID, singlePageExtraction, { excludeScanId: own.id });

    expect(context.previousScans.map((scan) => scan.scanId)).toEqual([previous.id]);
    expect(matchInvoice(singlePageExtraction, context).duplicateOfScanId).toBe(previous.id);
  });
});

describe("matchScan · SKU de los candidatos (REP-04 · D24-d, caos B2)", () => {
  it("cada candidato lleva el sku del producto del contexto; sin sku no se añade", async () => {
    const base = buildContext();
    const context = {
      ...base,
      products: [
        ...base.products,
        { id: "p-jab-1", name: "Jabon Azul 250g", sku: "JAB-01", barcode: null, active: true, taxRateCode: "general", hasRecipe: false },
        { id: "p-jab-2", name: "Jabon Azul 250g", sku: null, barcode: null, active: true, taxRateCode: "general", hasRecipe: false },
      ],
      fuzzy: {
        0: [
          { productId: "p-jab-1", score: 0.73, via: "name" as const },
          { productId: "p-jab-2", score: 0.73, via: "name" as const },
        ],
      },
    };
    const extraction = buildExtraction({ lines: [buildLine({ rawText: "JABON AZUL 250", description: "Jabon azul 250" })] });
    const matcher = createMatchScan(deps({ loadContext: jest.fn(async () => context) }));

    const result = await matcher(extraction, { dataSource: "supabase", scanId: "s", storeId: "t" });

    const candidates = result.lines[0]?.candidates ?? [];
    expect(candidates.find((candidate) => candidate.productId === "p-jab-1")?.sku).toBe("JAB-01");
    const noSku = candidates.find((candidate) => candidate.productId === "p-jab-2");
    expect(noSku).toBeDefined();
    expect(noSku && "sku" in noSku).toBe(false);
  });
});
