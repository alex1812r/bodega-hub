/**
 * @jest-environment node
 */
/**
 * SCN-UI-Q2 (QA final ALTO-2): con Gemini, otra foto de la misma factura (f03
 * tras confirmar f02) llegaba sin ninguna línea confirmada: el alias aprendido
 * era el `rawText` entero (cantidad, precio, importe) y el modelo no lo repite
 * igual entre fotos. El alias se aprende con una clave estable
 * (`invoiceAliasKey`) y se busca por la clave nueva y la vieja.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../contacts/services/supplierProducts.server", () => ({
  createSupplierProductPackUnit: jest.fn(),
}));

import { normalizeAlias } from "@bodega/core/invoice";

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { InvoiceExtraction } from "../contracts";

import { geminiF02, geminiF03, SECOND_SCAN_RATE } from "./__fixtures__/geminiSecondScan";
import * as mockService from "./confirmScan.mock-server";
import { finalizeInvoiceScan, precheckInvoiceScan, type LearnAliasLine } from "./confirmScan.server";
import { matchInvoice } from "./match";
import type { MatchAlias, MatchContext, MatchProduct } from "./match.types";

const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "00000000-0000-4000-8000-000000000201";
const KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const PRODUCT_IDS = geminiF02.lines.map((_, index) => `aaaaaaaa-0000-4000-8000-00000000000${index + 1}`);

function productsOf(extraction: InvoiceExtraction): MatchProduct[] {
  return extraction.lines.map((line, index) => ({
    id: PRODUCT_IDS[index],
    name: `Producto ${index + 1}`,
    sku: null,
    barcode: null,
    active: true,
    taxRateCode: null,
    // Costo por unidad coherente con el precio de la factura a la tasa del sistema.
    lastUnitCostRef: line.unitPrice / (line.unitsPerPack ?? 1) / SECOND_SCAN_RATE,
    hasRecipe: false,
  }));
}

function finalizeInput() {
  const lines = geminiF02.lines.map((line, index) => ({
    lineIndex: index,
    productId: PRODUCT_IDS[index],
    packLabel: line.unit === "caja" ? "Caja" : "Bulto",
    unitsPerPack: line.unitsPerPack,
  }));
  return {
    clientRequestId: KEY,
    items: lines.map((line) => ({ entryMode: "pack" as const, packLabel: line.packLabel, productId: line.productId, unitsPerPack: line.unitsPerPack })),
    lines,
    purchaseId: PURCHASE,
    supplierId: SUPPLIER,
  };
}

function contextWith(aliases: MatchAlias[]): MatchContext {
  return {
    storeId: DEFAULT_STORE_ID,
    supplierCandidates: [{ contactId: SUPPLIER, name: "Distribuidora Anonima", taxId: "J-000000019" }],
    supplierCatalogs: {
      [SUPPLIER]: {
        supplierProducts: PRODUCT_IDS.map((productId, index) => ({ supplierProductId: `sp-${index}`, productId, supplierSku: null })),
        aliases,
        packUnits: [],
      },
    },
    products: productsOf(geminiF02),
    fuzzy: {},
    taxRates: [{ code: "general", pct: 16, kind: "general", isDefault: true }],
    systemRate: SECOND_SCAN_RATE,
    previousScans: [],
  };
}

function toMatchAliases(lines: LearnAliasLine[]): MatchAlias[] {
  return lines.map((line) => ({
    aliasNorm: line.alias_norm,
    productId: line.product_id,
    packLabel: line.pack_label ?? null,
    unitsPerPack: line.units_per_pack ?? null,
    hits: 1,
  }));
}

/** Cliente falso de precheck + finalize que guarda las líneas de `learn_invoice_aliases`. */
function fakeClient(extracted: InvoiceExtraction) {
  const learned: LearnAliasLine[][] = [];
  const builder = {
    eq: () => builder,
    select: () => builder,
    maybeSingle: async () => ({
      data: { id: "scan-f02", status: "extracted", purchase_id: null, extracted, supplier_product_pack_units: [] },
      error: null,
    }),
  };
  const client = {
    from: jest.fn(() => builder),
    rpc: jest.fn(async (name: string, args: { p_lines?: LearnAliasLine[] }) => {
      if (name === "claim_invoice_scan") return { data: "claimed", error: null };
      if (name === "confirm_invoice_scan") return { data: true, error: null };
      if (name === "learn_invoice_aliases") {
        learned.push(args.p_lines ?? []);
        return { data: args.p_lines?.length ?? 0, error: null };
      }
      throw new Error(`RPC inesperada ${name}`);
    }),
  };
  return { client, learned };
}

describe("SCN-UI-Q2 · segundo escaneo de la misma factura con Gemini", () => {
  beforeEach(() => mockService.resetMockInvoiceScans());

  it("servidor: f02 confirmado y luego f03 (rawText distinto, misma descripción) → todas confirmadas por alias", async () => {
    const fake = fakeClient(geminiF02);
    jest.mocked(createRouteSupabaseClient).mockResolvedValue(fake.client as never);

    const scan = await precheckInvoiceScan({ clientRequestId: KEY, scanId: "scan-f02", lines: finalizeInput().lines }, DEFAULT_STORE_ID);
    await finalizeInvoiceScan(scan, finalizeInput(), DEFAULT_STORE_ID);

    expect(fake.learned).toHaveLength(1);
    const lines = matchInvoice(geminiF03, contextWith(toMatchAliases(fake.learned[0]))).lines;

    expect(lines.map((line) => [line.status, line.productId])).toEqual(PRODUCT_IDS.map((id) => ["confirmed", id]));
    expect(lines.every((line) => line.candidates?.[0]?.reason.startsWith("alias visto"))).toBe(true);
  });

  it("mock: f02 confirmado y luego f03 → todas confirmadas por alias (paridad)", async () => {
    mockService.registerMockInvoiceScan({ extracted: geminiF02, id: "scan-f02" });
    const scan = await mockService.precheckInvoiceScan({ clientRequestId: KEY, scanId: "scan-f02" }, DEFAULT_STORE_ID);
    await mockService.finalizeInvoiceScan(scan, finalizeInput(), DEFAULT_STORE_ID);

    const aliases = mockService.listMockLearnedAliases(DEFAULT_STORE_ID, SUPPLIER).map((alias) => ({
      aliasNorm: alias.aliasNorm,
      productId: alias.productId,
      packLabel: alias.packLabel,
      unitsPerPack: alias.unitsPerPack,
      hits: alias.hits,
    }));
    const lines = matchInvoice(geminiF03, contextWith(aliases)).lines;

    expect(lines.map((line) => line.status)).toEqual(PRODUCT_IDS.map(() => "confirmed"));
  });

  it("alias guardado con la clave vieja (rawText entero) se sigue encontrando", () => {
    const legacy: MatchAlias[] = geminiF03.lines.map((line, index) => ({
      aliasNorm: normalizeAlias(line.rawText),
      productId: PRODUCT_IDS[index],
      packLabel: line.unit ?? null,
      unitsPerPack: line.unitsPerPack ?? null,
      hits: 3,
    }));

    const lines = matchInvoice(geminiF03, contextWith(legacy)).lines;

    expect(lines.map((line) => line.status)).toEqual(PRODUCT_IDS.map(() => "confirmed"));
  });

  it("línea sin descripción: casa por el rawText sin cantidades ni importes", async () => {
    const withoutDescription = (extraction: InvoiceExtraction): InvoiceExtraction => ({
      ...extraction,
      lines: extraction.lines.map((line) => ({ ...line, description: "" })),
    });
    mockService.registerMockInvoiceScan({ extracted: withoutDescription(geminiF02), id: "scan-f02" });
    const scan = await mockService.precheckInvoiceScan({ clientRequestId: KEY, scanId: "scan-f02" }, DEFAULT_STORE_ID);
    await mockService.finalizeInvoiceScan(scan, finalizeInput(), DEFAULT_STORE_ID);

    const aliases = mockService.listMockLearnedAliases(DEFAULT_STORE_ID, SUPPLIER).map((alias) => ({
      aliasNorm: alias.aliasNorm,
      productId: alias.productId,
      packLabel: alias.packLabel,
      unitsPerPack: alias.unitsPerPack,
      hits: alias.hits,
    }));
    const lines = matchInvoice(withoutDescription(geminiF03), contextWith(aliases)).lines;

    expect(lines.map((line) => line.status)).toEqual(PRODUCT_IDS.map(() => "confirmed"));
  });
});
