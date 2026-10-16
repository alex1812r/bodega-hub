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
import { createMatchScan, matchScan, normalizeExtractionForMatch, type MatchScanDeps } from "./matchScan";
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
    expect(result).toEqual(matchInvoice(polarExtraction, buildContext()));
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

  it("matchScan por defecto llama a matchInvoice(extraction, await loadMatchContext(...)) (sin stub)", () => {
    const source = readFileSync(join(__dirname, "matchScan.ts"), "utf8");

    expect(source).not.toContain("PUNTO DE INTEGRACIÓN");
    expect(source).toContain("loadContext: loadMatchContext");
    expect(source).toContain("matchInvoice(extraction, await deps.loadContext(supabase, storeId, extraction, { excludeScanId: scanId }))");
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
