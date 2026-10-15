/**
 * @jest-environment node
 */
/**
 * SCN-05b · `loadMatchContext`: arma el `MatchContext` con la RPC de candidatos
 * (20261019d) y consultas filtradas SIEMPRE por la tienda del servidor.
 */
import type { InvoiceExtraction } from "../contracts";

import { loadMatchContext, MATCH_CANDIDATES_RPC, taxRateKind, type MatchContextSupabaseClient } from "./loadMatchContext";
import { matchInvoice } from "./match";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SUPPLIER_ID = "11111111-1111-4111-8111-222222222222";
const HARINA_ID = "22222222-2222-4222-8222-222222222222";
const MALTA_ID = "33333333-3333-4333-8333-333333333333";
const ARROZ_ID = "44444444-4444-4444-8444-444444444444";
const CAJA_ID = "55555555-5555-4555-8555-555555555555";
const SP_HARINA_ID = "66666666-6666-4666-8666-666666666666";
const PACK_ID = "77777777-7777-4777-8777-777777777777";

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
type Result = { data: unknown; error: unknown };
type TableHandler = (query: Query) => Result;

/** Cliente con cadenas thenables: cada consulta queda registrada en `queries`. */
function createSupabaseStub(options: {
  candidates: unknown;
  candidatesError?: unknown;
  tables?: Record<string, TableHandler>;
  rpcs?: Record<string, unknown>;
}) {
  const queries: Query[] = [];
  const rpc = jest.fn(async (name: string) => {
    if (name === MATCH_CANDIDATES_RPC) {
      return { data: options.candidatesError ? null : options.candidates, error: options.candidatesError ?? null };
    }
    return { data: options.rpcs?.[name] ?? [], error: null };
  });

  const from = jest.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const run = (): Result => options.tables?.[table]?.(query) ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "not", "ilike", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        query.calls.push({ method, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => {
      query.calls.push({ method: "maybeSingle", args: [] });
      return run();
    };
    chain.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject);
    return chain;
  });

  return { client: { from, rpc } as unknown as MatchContextSupabaseClient, from, rpc, queries };
}

function argsOf(query: Query, method: string): unknown[][] {
  return query.calls.filter((call) => call.method === method).map((call) => call.args);
}

function hasEq(query: Query, column: string, value: unknown): boolean {
  return argsOf(query, "eq").some(([col, val]) => col === column && val === value);
}

function queriesOf(queries: Query[], table: string): Query[] {
  return queries.filter((query) => query.table === table);
}

const extraction: InvoiceExtraction = {
  supplier: { name: "Distribuidora  Ñandú, C.A.", taxId: "J-12345678-9" },
  number: "00-0123",
  currency: "VES",
  lines: [
    {
      rawText: "HARINA PAN 1KG X20 (G)",
      description: "Harina PAN 1kg",
      quantity: 1,
      unit: "caja",
      unitsPerPack: 20,
      unitPrice: 900,
      lineTotal: 900,
      supplierSku: "HP-01",
      confidence: 0.9,
    },
    {
      rawText: "MALTA POLAR 355ML",
      description: "Malta Polar 355ml",
      quantity: 6,
      unitPrice: 50,
      lineTotal: 300,
      barcode: "759 1234",
      confidence: 0.8,
    },
  ],
  confidence: 0.85,
  warnings: [],
};

const candidates = {
  suppliers: [
    { contact_id: SUPPLIER_ID, name: "Distribuidora Ñandú", tax_id: "J-12345678-9", score: 0.91, tax_id_match: true },
    { contact_id: OTHER_SUPPLIER_ID, name: "Distribuidora Andes", tax_id: null, score: "0.42", tax_id_match: false },
  ],
  supplier_id: SUPPLIER_ID,
  lines: [
    { ordinal: 1, product_id: HARINA_ID, score: 0.8, via: "name" },
    { ordinal: 2, product_id: ARROZ_ID, score: "0.61", via: "alias" },
    { ordinal: 9, product_id: ARROZ_ID, score: 0.7, via: "name" },
    { ordinal: 2, product_id: MALTA_ID, score: 0.7, via: "otro" },
  ],
};

const productRow = (id: string, name: string, extra: Partial<Record<string, unknown>> = {}) => ({
  id,
  name,
  sku: `SKU-${name}`,
  barcode: null,
  is_active: true,
  category: { tax_rate: { code: "general" } },
  ...extra,
});

function fullTables(): Record<string, TableHandler> {
  return {
    app_settings: () => ({ data: { default_tax_rate_id: "rate-general" }, error: null }),
    exchange_rates: () => ({ data: { rate_ves: "45.5", created_at: "2026-10-15T12:00:00Z" }, error: null }),
    invoice_scans: () => ({
      data: [
        { id: "scan-1", supplier_id: null, number: "0123", supplier_tax_id: "J123456789", matched_contact_id: SUPPLIER_ID },
        { id: "scan-2", supplier_id: OTHER_SUPPLIER_ID, number: "123", supplier_tax_id: null, matched_contact_id: null },
      ],
      error: null,
    }),
    supplier_products: () => ({
      data: [
        {
          id: SP_HARINA_ID,
          product_id: HARINA_ID,
          supplier_sku: "HP-01",
          is_preferred: true,
          supplier_product_pack_units: [
            { id: PACK_ID, label: "Caja x20", units_per_pack: 20, is_default: true, is_active: true },
            { id: "pack-old", label: "Caja x10", units_per_pack: 10, is_default: false, is_active: false },
          ],
        },
      ],
      error: null,
    }),
    supplier_product_aliases: () => ({
      data: [{ alias_norm: "caja surtida", product_id: CAJA_ID, pack_label: "CAJA", units_per_pack: 12, hits: 3 }],
      error: null,
    }),
    product_pack_conversions: () => ({ data: [{ pack_product_id: CAJA_ID }], error: null }),
    products: (query) => {
      const select = String(argsOf(query, "select")[0]?.[0] ?? "");
      if (select.startsWith("id, purchase_items")) {
        const bySupplier = hasEq(query, "purchase_items.purchases.supplier_id", SUPPLIER_ID);
        return {
          data: bySupplier
            ? [{ id: HARINA_ID, purchase_items: [{ unit_cost_ref: "0.95" }] }]
            : [
                { id: HARINA_ID, purchase_items: [{ unit_cost_ref: 1.2 }] },
                { id: MALTA_ID, purchase_items: [{ unit_cost_ref: 1.1 }] },
                { id: ARROZ_ID, purchase_items: [] },
              ],
          error: null,
        };
      }
      const byBarcode = argsOf(query, "in").some(([column]) => column === "barcode");
      if (byBarcode) {
        return { data: [productRow(MALTA_ID, "Malta Polar", { barcode: "7591234" })], error: null };
      }
      return {
        data: [
          productRow(HARINA_ID, "Harina PAN"),
          productRow(ARROZ_ID, "Arroz Mary", { is_active: false, category: { tax_rate: null } }),
          productRow(CAJA_ID, "Caja surtida", { category: null }),
        ],
        error: null,
      };
    },
  };
}

const taxRateRows = [
  { id: "rate-exento", code: "exento", pct: "0.00", is_active: true },
  { id: "rate-general", code: "general", pct: 16, is_active: true },
  { id: "rate-lujo", code: "lujo", pct: "31", is_active: true },
  { id: "rate-old", code: "reducida", pct: 8, is_active: false },
];

describe("loadMatchContext", () => {
  it("arma el contexto completo: proveedores, catálogo, productos, difusos, alícuotas, tasa y escaneos previos", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: fullTables(),
      rpcs: { tax_rates_for_store: taxRateRows },
    });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);

    expect(ctx.storeId).toBe(STORE_ID);
    expect(ctx.supplierCandidates).toEqual([
      { contactId: SUPPLIER_ID, name: "Distribuidora Ñandú", taxId: "J-12345678-9", score: 0.91 },
      { contactId: OTHER_SUPPLIER_ID, name: "Distribuidora Andes", taxId: null, score: 0.42 },
    ]);
    expect(ctx.supplierCatalogs).toEqual({
      [SUPPLIER_ID]: {
        supplierProducts: [
          { supplierProductId: SP_HARINA_ID, productId: HARINA_ID, supplierSku: "HP-01", isPreferred: true },
        ],
        aliases: [{ aliasNorm: "caja surtida", productId: CAJA_ID, packLabel: "CAJA", unitsPerPack: 12, hits: 3 }],
        packUnits: [{ id: PACK_ID, productId: HARINA_ID, label: "Caja x20", unitsPerPack: 20, isDefault: true }],
      },
    });
    // Ordinal 1-based de la RPC -> índice 0-based; fuera de rango o via desconocida se descartan.
    expect(ctx.fuzzy).toEqual({
      0: [{ productId: HARINA_ID, score: 0.8, via: "name" }],
      1: [{ productId: ARROZ_ID, score: 0.61, via: "alias" }],
    });

    const byId = new Map(ctx.products.map((product) => [product.id, product]));
    expect([...byId.keys()].sort()).toEqual([HARINA_ID, MALTA_ID, ARROZ_ID, CAJA_ID].sort());
    expect(byId.get(HARINA_ID)).toEqual({
      id: HARINA_ID,
      name: "Harina PAN",
      sku: "SKU-Harina PAN",
      barcode: null,
      active: true,
      taxRateCode: "general",
      lastUnitCostRef: 0.95, // la del proveedor gana a la de cualquiera (1,2)
      linkedToSupplier: true,
      hasRecipe: false,
    });
    expect(byId.get(MALTA_ID)).toMatchObject({ barcode: "7591234", lastUnitCostRef: 1.1, linkedToSupplier: false });
    expect(byId.get(ARROZ_ID)).toMatchObject({ active: false, taxRateCode: null, lastUnitCostRef: null });
    expect(byId.get(CAJA_ID)).toMatchObject({ taxRateCode: null, hasRecipe: true });

    expect(ctx.taxRates).toEqual([
      { code: "exento", pct: 0, kind: "exento", isDefault: false },
      { code: "general", pct: 16, kind: "general", isDefault: true },
      { code: "lujo", pct: 31, kind: "otra", isDefault: false },
    ]);
    expect(ctx.systemRate).toBe(45.5);
    expect(ctx.previousScans).toEqual([
      { scanId: "scan-1", supplierId: SUPPLIER_ID, supplierTaxId: "J123456789", number: "0123" },
      { scanId: "scan-2", supplierId: OTHER_SUPPLIER_ID, supplierTaxId: null, number: "123" },
    ]);
  });

  it("llama la RPC con textos normalizados y sin tienda del cliente; toda consulta filtra por store_id", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: fullTables(),
      rpcs: { tax_rates_for_store: taxRateRows },
    });

    await loadMatchContext(stub.client, STORE_ID, extraction);

    expect(stub.rpc).toHaveBeenCalledWith(MATCH_CANDIDATES_RPC, {
      p_supplier_name: "distribuidora nandu c a",
      p_supplier_tax_id: "J-12345678-9",
      p_texts: ["harina pan 1kg x20 g", "malta polar 355ml"],
      p_descriptions: ["harina pan 1kg", "malta polar 355ml"],
      p_limit: 5,
    });
    expect(stub.rpc).toHaveBeenCalledWith("tax_rates_for_store", { p_store_id: STORE_ID });

    expect(stub.queries.length).toBeGreaterThan(0);
    for (const query of stub.queries) {
      expect(hasEq(query, "store_id", STORE_ID)).toBe(true);
    }

    const [catalog] = queriesOf(stub.queries, "supplier_products");
    expect(hasEq(catalog, "supplier_id", SUPPLIER_ID)).toBe(true);
    expect(hasEq(catalog, "is_active", true)).toBe(true);
    expect(hasEq(catalog, "supplier_product_pack_units.is_active", true)).toBe(true);
    const [aliases] = queriesOf(stub.queries, "supplier_product_aliases");
    expect(hasEq(aliases, "supplier_id", SUPPLIER_ID)).toBe(true);

    const [scans] = queriesOf(stub.queries, "invoice_scans");
    expect(argsOf(scans, "ilike")).toEqual([["extracted->>number", "%123"]]);
    expect(argsOf(scans, "not")).toEqual([["status", "in", "(discarded,failed)"]]);

    const barcodeQuery = queriesOf(stub.queries, "products").find((query) =>
      argsOf(query, "in").some(([column]) => column === "barcode"),
    );
    expect(argsOf(barcodeQuery!, "in")).toEqual([["barcode", ["759 1234", "7591234"]]]);

    const lastCostQueries = queriesOf(stub.queries, "products").filter((query) =>
      String(argsOf(query, "select")[0]?.[0]).startsWith("id, purchase_items"),
    );
    expect(lastCostQueries).toHaveLength(2);
    for (const query of lastCostQueries) {
      expect(hasEq(query, "purchase_items.purchases.store_id", STORE_ID)).toBe(true);
      expect(hasEq(query, "purchase_items.purchases.status", "recibido")).toBe(true);
    }

    const [recipes] = queriesOf(stub.queries, "product_pack_conversions");
    expect(hasEq(recipes, "is_active", true)).toBe(true);
  });

  it("sin proveedor, sin número y sin barcodes no consulta catálogo, escaneos ni barcode", async () => {
    const stub = createSupabaseStub({
      candidates: { suppliers: [], supplier_id: null, lines: [] },
      tables: { exchange_rates: () => ({ data: null, error: null }) },
    });
    const bare: InvoiceExtraction = {
      ...extraction,
      number: undefined,
      lines: extraction.lines.map((line) => ({ ...line, barcode: undefined })),
    };

    const ctx = await loadMatchContext(stub.client, STORE_ID, bare);

    expect(ctx).toEqual({
      storeId: STORE_ID,
      supplierCandidates: [],
      supplierCatalogs: {},
      products: [],
      fuzzy: {},
      taxRates: [],
      systemRate: undefined,
      previousScans: [],
    });
    const tables = stub.queries.map((query) => query.table);
    expect(tables).not.toContain("supplier_products");
    expect(tables).not.toContain("supplier_product_aliases");
    expect(tables).not.toContain("invoice_scans");
    expect(tables).not.toContain("products");
  });

  it("excludeScanId saca el escaneo actual (ya guardado) de previousScans para que no sea duplicado de sí mismo", async () => {
    const tables = fullTables();
    const allScans = tables.invoice_scans;
    // La base honra `.neq('id', …)`: el stub filtra igual.
    tables.invoice_scans = (query) => {
      const result = allScans(query);
      const excluded = argsOf(query, "neq")
        .filter(([column]) => column === "id")
        .map(([, value]) => value);
      return { ...result, data: (result.data as Array<{ id: string }>).filter((row) => !excluded.includes(row.id)) };
    };
    const stub = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction, { excludeScanId: "scan-1" });

    const [scans] = queriesOf(stub.queries, "invoice_scans");
    expect(argsOf(scans, "neq")).toEqual([["id", "scan-1"]]);
    expect(ctx.previousScans.map((scan) => scan.scanId)).toEqual(["scan-2"]);
    expect(matchInvoice(extraction, ctx).duplicateOfScanId).not.toBe("scan-1");

    // Sin la opción, la firma de tres argumentos no filtra por id.
    const plain = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });
    await loadMatchContext(plain.client, STORE_ID, extraction);
    expect(argsOf(queriesOf(plain.queries, "invoice_scans")[0], "neq")).toEqual([]);
  });

  it("propaga el error de la RPC (PT403 de rol sin purchases.create)", async () => {
    const stub = createSupabaseStub({
      candidates: null,
      candidatesError: { code: "PT403", message: "No autorizado para emparejar facturas" },
    });

    await expect(loadMatchContext(stub.client, STORE_ID, extraction)).rejects.toMatchObject({ status: 403 });
  });

  it("el contexto cargado alimenta matchInvoice: proveedor por RIF, SKU del proveedor con empaque y barcode", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: fullTables(),
      rpcs: { tax_rates_for_store: taxRateRows },
    });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);
    const match = matchInvoice(extraction, ctx);

    expect(match.supplier.contactId).toBe(SUPPLIER_ID);
    expect(match.lines[0]).toMatchObject({ status: "confirmed", productId: HARINA_ID, entryMode: "pack", packUnitId: PACK_ID });
    expect(match.lines[1].productId).toBe(MALTA_ID);
    expect(match.rate?.system).toBe(45.5);
    expect(match.duplicateOfScanId).toBe("scan-1");
  });
});

describe("taxRateKind", () => {
  it("clasifica por código semilla y, si no, por porcentaje", () => {
    expect(taxRateKind("exento", 0)).toBe("exento");
    expect(taxRateKind("reducida", 8)).toBe("reducida");
    expect(taxRateKind("iva-16", 16)).toBe("general");
    expect(taxRateKind("iva-8", 8)).toBe("reducida");
    expect(taxRateKind("cero", 0)).toBe("exento");
    expect(taxRateKind("lujo", 31)).toBe("otra");
  });
});
