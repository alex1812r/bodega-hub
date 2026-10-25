/**
 * @jest-environment node
 */
/**
 * SCN-05b · `loadMatchContext`: arma el `MatchContext` con la RPC de candidatos
 * (20261019d) y consultas filtradas SIEMPRE por la tienda del servidor.
 */
import { roundMoney } from "@bodega/core/currency";

import { DOLAR_API_OFFICIAL_SOURCE } from "@/lib/exchange-rates/constants";
import { getCurrentExchangeRate, readCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.server";

import type { InvoiceExtraction } from "../contracts";

import {
  loadMatchContext,
  MATCH_BARCODE_PRODUCTS_RPC,
  MATCH_CANDIDATES_RPC,
  MATCH_EXACT_ALIASES_RPC,
  MATCH_PREVIOUS_SCANS_RPC,
  taxRateKind,
  type MatchContextSupabaseClient,
} from "./loadMatchContext";
import { matchInvoice } from "./match";
import { MISSING_RATE_WARNING, NO_RATE_PRICE_ISSUE } from "./match/money";
import { normalizeInvoiceNumber } from "./match/text";

// CIE-02: la tasa del día es la del formulario de compra (DolarAPI oficial), no la última fila de exchange_rates.
// D24-b: el escaneo solo LEE esa tasa (readCurrentExchangeRate); nunca la persiste (getCurrentExchangeRate).
jest.mock("../../settings/services/exchangeRates.server", () => ({
  getCurrentExchangeRate: jest.fn(),
  readCurrentExchangeRate: jest.fn(),
}));

const readExchangeRateMock = jest.mocked(readCurrentExchangeRate);
const persistingExchangeRateMock = jest.mocked(getCurrentExchangeRate);

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

type RpcParams = Record<string, unknown>;

/**
 * Las RPC de búsqueda exacta (20261019q) filtran en la base lo que antes iba en
 * la URL: el stub las responde con el manejador de su tabla, al que pasa esos
 * mismos filtros como una consulta (que NO entra en `queries`: no va por URL).
 */
function rpcAsTableQuery(name: string, params: RpcParams): Query | null {
  if (name === MATCH_EXACT_ALIASES_RPC) {
    return {
      table: "supplier_product_aliases",
      calls: [
        { method: "eq", args: ["supplier_id", params.p_supplier_id] },
        { method: "in", args: ["alias_norm", params.p_alias_keys] },
      ],
    };
  }
  if (name === MATCH_BARCODE_PRODUCTS_RPC) {
    return { table: "products", calls: [{ method: "in", args: ["barcode", params.p_barcodes] }] };
  }
  if (name === MATCH_PREVIOUS_SCANS_RPC) {
    const calls: Call[] = [{ method: "not", args: ["status", "in", "(discarded,failed)"] }];
    if (typeof params.p_number === "string") {
      // Como la RPC: los caracteres del número normalizado en orden ('%F%A%C%1').
      calls.push({ method: "ilike", args: ["extracted->>number", `%${[...params.p_number].join("%")}`] });
    } else {
      calls.push({ method: "in", args: ["extracted->>total", params.p_totals] });
      if (typeof params.p_date === "string") {
        calls.push({ method: "eq", args: ["extracted->>date", params.p_date] });
      }
    }
    if (typeof params.p_exclude_scan_id === "string") {
      calls.push({ method: "neq", args: ["id", params.p_exclude_scan_id] });
    }
    calls.push({ method: "limit", args: [params.p_limit] });
    return { table: "invoice_scans", calls };
  }
  return null;
}

/** Cliente con cadenas thenables: cada consulta por URL queda registrada en `queries`. */
function createSupabaseStub(options: {
  candidates: unknown;
  candidatesError?: unknown;
  tables?: Record<string, TableHandler>;
  rpcs?: Record<string, unknown>;
}) {
  const queries: Query[] = [];
  const rpc = jest.fn(async (name: string, params: RpcParams = {}) => {
    if (name === MATCH_CANDIDATES_RPC) {
      return { data: options.candidatesError ? null : options.candidates, error: options.candidatesError ?? null };
    }
    const tableQuery = rpcAsTableQuery(name, params);
    if (tableQuery) {
      const result = options.tables?.[tableQuery.table]?.(tableQuery) ?? { data: [], error: null };
      const rows = (result.data ?? []) as Array<{ id: string }>;
      return { data: name === MATCH_BARCODE_PRODUCTS_RPC ? rows.map((row) => row.id) : rows, error: result.error };
    }
    return { data: options.rpcs?.[name] ?? [], error: null };
  });

  const from = jest.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const run = (): Result => options.tables?.[table]?.(query) ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "not", "ilike", "order", "limit", "range"]) {
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

/** Parámetros de cada llamada a la RPC `name` (cuerpo POST). */
function rpcParams(rpc: jest.Mock, name: string): RpcParams[] {
  return (rpc.mock.calls as Array<[string, RpcParams]>).filter(([called]) => called === name).map(([, params]) => params);
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
    product_pack_conversions: () => ({ data: [{ pack_product_id: CAJA_ID, total_units: 12 }], error: null }),
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
      const ids = argsOf(query, "in").find(([column]) => column === "id")?.[1] as string[] | undefined;
      const rows = [
        productRow(HARINA_ID, "Harina PAN"),
        productRow(ARROZ_ID, "Arroz Mary", { is_active: false, category: { tax_rate: null } }),
        productRow(CAJA_ID, "Caja surtida", { category: null }),
        productRow(MALTA_ID, "Malta Polar", { barcode: "7591234" }),
      ];
      return { data: ids ? rows.filter((row) => ids.includes(row.id)) : rows, error: null };
    },
  };
}

const taxRateRows = [
  { id: "rate-exento", code: "exento", pct: "0.00", is_active: true },
  { id: "rate-general", code: "general", pct: 16, is_active: true },
  { id: "rate-lujo", code: "lujo", pct: "31", is_active: true },
  { id: "rate-old", code: "reducida", pct: 8, is_active: false },
];

beforeEach(() => {
  readExchangeRateMock.mockReset();
  readExchangeRateMock.mockResolvedValue({
    id: "live-official",
    rateVes: 45.5,
    source: DOLAR_API_OFFICIAL_SOURCE,
    createdAt: "2026-10-15T12:00:00Z",
  });
});

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
    // La conversión registrada (product_pack_conversions.total_units) es lo que create_purchase exige (caos M-r3-1).
    expect(byId.get(CAJA_ID)).toMatchObject({ taxRateCode: null, hasRecipe: true, recipeUnitsPerPack: 12 });
    expect(byId.get(HARINA_ID)?.recipeUnitsPerPack).toBeUndefined();

    expect(ctx.taxRates).toEqual([
      { code: "exento", pct: 0, kind: "exento", isDefault: false },
      { code: "general", pct: 16, kind: "general", isDefault: true },
      { code: "lujo", pct: 31, kind: "otra", isDefault: false },
    ]);
    expect(ctx.systemRate).toBe(45.5);
    expect(ctx.previousScans).toEqual([
      { scanId: "scan-1", supplierId: SUPPLIER_ID, matchedContactId: SUPPLIER_ID, supplierTaxId: "J123456789", number: "0123" },
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
      // SCN-UI-Q2: los alias difusos se comparan con la clave de alias (invoiceAliasKey), no con el rawText entero.
      p_texts: ["harina pan 1kg", "malta polar 355ml"],
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
    // Por URL, los alias solo se piden por ids (los de los productos casados por SKU).
    const [aliases] = queriesOf(stub.queries, "supplier_product_aliases");
    expect(hasEq(aliases, "supplier_id", SUPPLIER_ID)).toBe(true);
    expect(argsOf(aliases, "in")).toEqual([["product_id", [HARINA_ID]]]);

    // D35 (P8-M1): claves de alias, número y barcodes van en el cuerpo POST de las RPC de 20261019q.
    expect(stub.rpc).toHaveBeenCalledWith(MATCH_EXACT_ALIASES_RPC, {
      p_supplier_id: SUPPLIER_ID,
      p_alias_keys: expect.arrayContaining(["harina pan 1kg", "malta polar 355ml"]),
    });
    // Número normalizado: la RPC busca su subsecuencia (tolera separadores y ceros del texto guardado).
    expect(stub.rpc).toHaveBeenCalledWith(MATCH_PREVIOUS_SCANS_RPC, { p_number: "123", p_exclude_scan_id: null, p_limit: 200 });
    expect(stub.rpc).toHaveBeenCalledWith(MATCH_BARCODE_PRODUCTS_RPC, { p_barcodes: ["759 1234", "7591234"] });
    expect(queriesOf(stub.queries, "invoice_scans")).toEqual([]);
    expect(stub.queries.some((query) => argsOf(query, "in").some(([column]) => column !== "id" && !String(column).endsWith("product_id")))).toBe(false);

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
    expect(String(argsOf(recipes, "select")[0]?.[0])).toContain("total_units");
  });

  it("sin proveedor, sin número y sin barcodes no consulta catálogo, escaneos ni barcode", async () => {
    const stub = createSupabaseStub({
      candidates: { suppliers: [], supplier_id: null, lines: [] },
    });
    readExchangeRateMock.mockRejectedValueOnce(new Error("DolarAPI caída"));
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
    const rpcs = stub.rpc.mock.calls.map(([name]) => name);
    expect(rpcs).not.toContain(MATCH_EXACT_ALIASES_RPC);
    expect(rpcs).not.toContain(MATCH_PREVIOUS_SCANS_RPC);
    expect(rpcs).not.toContain(MATCH_BARCODE_PRODUCTS_RPC);
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

    expect(rpcParams(stub.rpc, MATCH_PREVIOUS_SCANS_RPC)).toEqual([expect.objectContaining({ p_exclude_scan_id: "scan-1" })]);
    expect(ctx.previousScans.map((scan) => scan.scanId)).toEqual(["scan-2"]);
    expect(matchInvoice(extraction, ctx).duplicateOfScanId).not.toBe("scan-1");

    // Sin la opción, la firma de tres argumentos no filtra por id.
    const plain = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });
    await loadMatchContext(plain.client, STORE_ID, extraction);
    expect(rpcParams(plain.rpc, MATCH_PREVIOUS_SCANS_RPC)).toEqual([expect.objectContaining({ p_exclude_scan_id: null })]);
  });

  it.each([
    ["FAC12321", "FAC-12321"],
    ["FAC-12321", "FAC-12321"],
    ["fac 12321", "FAC-12321"],
    ["QA-55555", "QA-55555"],
    ["0001-004321", "0001-004321"],
    ["1004321", "0001-004321"],
  ])(
    "detecta duplicado con número alfanumérico: leído %p vs guardado %p (comparación normalizada en ambos lados)",
    async (readNumber, storedNumber) => {
      const rows = [
        { id: "scan-dup", supplier_id: SUPPLIER_ID, number: storedNumber, supplier_tax_id: null, matched_contact_id: null },
        { id: "scan-other", supplier_id: SUPPLIER_ID, number: `X${storedNumber}9`, supplier_tax_id: null, matched_contact_id: null },
        { id: "scan-prefix", supplier_id: SUPPLIER_ID, number: `Z-${storedNumber}`, supplier_tax_id: null, matched_contact_id: null },
      ];
      const tables = fullTables();
      // La base honra `ilike` (sin distinguir mayúsculas, `%` = cualquier cosa) y `.neq('id', …)`.
      tables.invoice_scans = (query) => {
        const patterns = argsOf(query, "ilike").map(([, pattern]) => String(pattern));
        const excluded = argsOf(query, "neq").map(([, value]) => value);
        const data = rows.filter(
          (row) =>
            !excluded.includes(row.id) &&
            patterns.every((pattern) =>
              new RegExp(`^${pattern.split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i").test(
                row.number,
              ),
            ),
        );
        return { data, error: null };
      };
      const stub = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });
      const scanned: InvoiceExtraction = { ...extraction, number: readNumber };

      const ctx = await loadMatchContext(stub.client, STORE_ID, scanned, { excludeScanId: "scan-self" });

      expect(ctx.previousScans.map((scan) => scan.scanId)).toEqual(["scan-dup"]);
      expect(matchInvoice(scanned, ctx).duplicateOfScanId).toBe("scan-dup");
      expect(rpcParams(stub.rpc, MATCH_PREVIOUS_SCANS_RPC)).toEqual([
        { p_number: normalizeInvoiceNumber(readNumber), p_exclude_scan_id: "scan-self", p_limit: 200 },
      ]);
    },
  );

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

  it("producto con receta: el match sale con la conversión registrada que create_purchase acepta (caos M-r3-1)", async () => {
    const stub = createSupabaseStub({
      candidates: { ...candidates, lines: [] },
      tables: fullTables(),
      rpcs: { tax_rates_for_store: taxRateRows },
    });
    const recipeExtraction: InvoiceExtraction = {
      ...extraction,
      number: undefined,
      lines: [{ rawText: "CAJA SURTIDA", description: "Caja surtida", quantity: 2, unitPrice: 1200, lineTotal: 2400, confidence: 0.9 }],
    };

    const ctx = await loadMatchContext(stub.client, STORE_ID, recipeExtraction);
    const [line] = matchInvoice(recipeExtraction, ctx).lines;

    expect(line).toMatchObject({ status: "confirmed", productId: CAJA_ID, entryMode: "pack", unitsPerPack: 12, disassembleOnReceive: true });
  });

  it("componente de receta: carga los tamaños 1 a 1 que create_purchase acepta y el empaque x20 queda dudoso (caos M-r4-1)", async () => {
    const tables = fullTables();
    tables.product_pack_components = () => ({
      data: [
        { unit_product_id: HARINA_ID, units_per_pack: 12, conversion: { total_units: 12, is_active: true } },
        // Surtida (6 de 12): create_purchase no la cuenta (pc.units_per_pack = c.total_units).
        { unit_product_id: HARINA_ID, units_per_pack: 6, conversion: { total_units: 12, is_active: true } },
        { unit_product_id: HARINA_ID, units_per_pack: 12, conversion: { total_units: "12", is_active: true } },
      ],
      error: null,
    });
    const stub = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);

    const byId = new Map(ctx.products.map((product) => [product.id, product]));
    expect(byId.get(HARINA_ID)?.componentPackSizes).toEqual([12]);
    expect(byId.get(MALTA_ID)?.componentPackSizes).toBeUndefined();
    const [components] = queriesOf(stub.queries, "product_pack_components");
    expect(hasEq(components, "store_id", STORE_ID)).toBe(true);
    expect(hasEq(components, "conversion.is_active", true)).toBe(true);
    expect(argsOf(components, "in")[0]?.[0]).toBe("unit_product_id");

    // Línea por SKU "HP-01" en caja x20 (empaque registrado del proveedor): create_purchase solo aceptaría 12.
    const [line] = matchInvoice(extraction, ctx).lines;
    expect(line.status).toBe("doubtful");
    expect(line.issues.join(" ")).toContain("componente de una receta de 12 unidades por empaque");
  });

  it("línea sin candidatos por el empaque en el texto: reintenta con el texto limpio y queda dudosa con el producto (SCN-11-it1)", async () => {
    const JUSTY_ID = "88888888-8888-4888-8888-888888888888";
    const tables = fullTables();
    const baseProducts = tables.products;
    tables.products = (query) => {
      const byId = argsOf(query, "in").find(([column]) => column === "id");
      if (byId && (byId[1] as string[]).includes(JUSTY_ID)) {
        return { data: [productRow(JUSTY_ID, "Justy pequeño 400 ml")], error: null };
      }
      return baseProducts(query);
    };
    const stub = createSupabaseStub({ candidates: null, tables, rpcs: { tax_rates_for_store: taxRateRows } });
    // Como el trigram de 20261019d: "justy 400ml" queda bajo 0,6 contra "justy pequeno 400 ml"; "justy 400 ml" no.
    stub.rpc.mockImplementation(async (name: string, params?: unknown) => {
      if (name !== MATCH_CANDIDATES_RPC) {
        return { data: name === "tax_rates_for_store" ? taxRateRows : [], error: null };
      }
      const { p_descriptions: descriptions } = params as { p_descriptions: string[] };
      return {
        data: {
          suppliers: candidates.suppliers,
          supplier_id: SUPPLIER_ID,
          lines: descriptions.flatMap((text, index) =>
            text === "justy 400 ml" ? [{ ordinal: index + 1, product_id: JUSTY_ID, score: 0.619, via: "name" }] : [],
          ),
        },
        error: null,
      };
    });
    const justy: InvoiceExtraction = {
      ...extraction,
      number: undefined,
      lines: [
        {
          rawText: "JUSTY 400ML [BULTO X 15,00]",
          description: "Justy 400ml",
          quantity: 2,
          unit: "bulto",
          unitsPerPack: 15,
          unitPrice: 900,
          lineTotal: 1800,
          confidence: 0.9,
        },
      ],
    };

    const ctx = await loadMatchContext(stub.client, STORE_ID, justy);
    const [line] = matchInvoice(justy, ctx).lines;

    expect(ctx.fuzzy[0]).toEqual([{ productId: JUSTY_ID, score: 0.619, via: "name" }]);
    expect(line.status).toBe("doubtful");
    expect(line.candidates?.map((candidate) => candidate.productId)).toEqual([JUSTY_ID]);
    // El reintento usa el proveedor ya elegido (mismos alias) y solo los textos limpios de las líneas sin candidatos.
    const calls = (stub.rpc.mock.calls as unknown as Array<[string, { p_supplier_id?: string; p_texts: string[] }]>).filter(
      ([name]) => name === MATCH_CANDIDATES_RPC,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1][1].p_supplier_id).toBe(SUPPLIER_ID);
    expect(calls[1][1].p_texts).toContain("justy 400 ml");
  });

  it("si todas las líneas traen candidatos no hay segunda llamada a la RPC", async () => {
    const stub = createSupabaseStub({ candidates, tables: fullTables(), rpcs: { tax_rates_for_store: taxRateRows } });

    await loadMatchContext(stub.client, STORE_ID, extraction);

    expect(stub.rpc.mock.calls.filter(([name]) => name === MATCH_CANDIDATES_RPC)).toHaveLength(1);
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

describe("loadMatchContext · posible duplicado (SCN-11-F4)", () => {
  const dupRow = {
    id: "scan-f02",
    supplier_id: SUPPLIER_ID,
    number: "00003570",
    supplier_tax_id: "J-12345678-9",
    matched_contact_id: null,
    date: "2026-09-08",
    total: 1200,
  };

  function tablesWithScans(rows: Array<typeof dupRow>) {
    const tables = fullTables();
    // La base honra `in`/`eq` sobre los caminos JSON y `.neq('id', …)`.
    tables.invoice_scans = (query) => {
      const totals = argsOf(query, "in").find(([column]) => column === "extracted->>total")?.[1] as string[] | undefined;
      const date = argsOf(query, "eq").find(([column]) => column === "extracted->>date")?.[1];
      const excluded = argsOf(query, "neq").map(([, value]) => value);
      if (!totals) return { data: [], error: null };
      const data = rows.filter(
        (row) => !excluded.includes(row.id) && totals.includes(String(row.total)) && (date === undefined || row.date === date),
      );
      return { data, error: null };
    };
    return tables;
  }

  it("sin número: segunda consulta por fecha y total (±0,01), acotada y sin imágenes; matchInvoice marca el posible duplicado", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: tablesWithScans([dupRow, { ...dupRow, id: "scan-otro-dia", date: "2026-09-09" }]),
      rpcs: { tax_rates_for_store: taxRateRows },
    });
    const scanned: InvoiceExtraction = { ...extraction, number: undefined, date: "2026-09-08", total: 1200.01 };

    const ctx = await loadMatchContext(stub.client, STORE_ID, scanned, { excludeScanId: "scan-self" });

    expect(ctx.previousScans).toEqual([
      expect.objectContaining({ scanId: "scan-f02", supplierId: SUPPLIER_ID, date: "2026-09-08", total: 1200 }),
    ]);
    expect(matchInvoice(scanned, ctx).duplicateOfScanId).toBe("scan-f02");

    // Por POST (D35): totales al céntimo, fecha leída, el propio escaneo fuera y acotada.
    expect(rpcParams(stub.rpc, MATCH_PREVIOUS_SCANS_RPC)).toEqual([
      { p_totals: ["1200", "1200.01", "1200.02"], p_date: "2026-09-08", p_exclude_scan_id: "scan-self", p_limit: 50 },
    ]);
    expect(queriesOf(stub.queries, "invoice_scans")).toEqual([]);
  });

  it("número con un carácter distinto: se une a la consulta por número y lo marca", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: tablesWithScans([dupRow]),
      rpcs: { tax_rates_for_store: taxRateRows },
    });
    const scanned: InvoiceExtraction = { ...extraction, number: "00003576", date: "2026-09-08", total: 1200 };

    const ctx = await loadMatchContext(stub.client, STORE_ID, scanned);

    expect(rpcParams(stub.rpc, MATCH_PREVIOUS_SCANS_RPC)).toHaveLength(2);
    expect(ctx.previousScans.map((scan) => scan.scanId)).toEqual(["scan-f02"]);
    expect(matchInvoice(scanned, ctx).duplicateOfScanId).toBe("scan-f02");
  });

  it("sin total leído no hace la segunda consulta", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: tablesWithScans([dupRow]),
      rpcs: { tax_rates_for_store: taxRateRows },
    });

    await loadMatchContext(stub.client, STORE_ID, { ...extraction, number: undefined, date: "2026-09-08" });

    expect(rpcParams(stub.rpc, MATCH_PREVIOUS_SCANS_RPC)).toHaveLength(0);
  });
});

describe("loadMatchContext · duplicado prefiere el escaneo confirmado (SCN-UI-C2)", () => {
  it("trae purchase_id y el aviso apunta al confirmado con compra, no al abandonado más reciente", async () => {
    const rows = [
      { id: "scan-abandonado", supplier_id: SUPPLIER_ID, number: "0123", supplier_tax_id: null, matched_contact_id: null, purchase_id: null },
      { id: "scan-confirmado", supplier_id: SUPPLIER_ID, number: "0123", supplier_tax_id: null, matched_contact_id: null, purchase_id: "purchase-1" },
    ];
    const tables = fullTables();
    tables.invoice_scans = (query) => ({ data: argsOf(query, "ilike").length > 0 ? rows : [], error: null });
    const stub = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);

    expect(ctx.previousScans.map((scan) => [scan.scanId, scan.purchaseId])).toEqual([
      ["scan-abandonado", undefined],
      ["scan-confirmado", "purchase-1"],
    ]);
    expect(matchInvoice(extraction, ctx).duplicateOfScanId).toBe("scan-confirmado");
  });
});

describe("loadMatchContext · duplicado cargado con otro proveedor (REP12-01, M-p12A-1)", () => {
  it("la 1.ª compra se confirmó con otro proveedor: el contacto leído del escaneo previo sigue contando", async () => {
    const rows = [
      // Leído = SUPPLIER_ID (sin RIF), confirmado eligiendo OTHER_SUPPLIER_ID.
      { id: "scan-otro-proveedor", supplier_id: OTHER_SUPPLIER_ID, number: "0123", supplier_tax_id: null, matched_contact_id: SUPPLIER_ID, purchase_id: "purchase-1" },
    ];
    const tables = fullTables();
    tables.invoice_scans = (query) => ({ data: argsOf(query, "ilike").length > 0 ? rows : [], error: null });
    const stub = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);

    expect(ctx.previousScans).toEqual([
      expect.objectContaining({ scanId: "scan-otro-proveedor", supplierId: OTHER_SUPPLIER_ID, matchedContactId: SUPPLIER_ID }),
    ]);
    expect(matchInvoice(extraction, ctx).duplicateOfScanId).toBe("scan-otro-proveedor");
  });
});

describe("loadMatchContext · la compra anulada no es duplicado (REP3-03a, B6)", () => {
  it("pide el estado de la compra; el escaneo de una compra cancelada no es duplicado y el de una devuelta sí", async () => {
    const rows = [
      { id: "scan-anulada", supplier_id: SUPPLIER_ID, number: "0123", supplier_tax_id: null, matched_contact_id: null, purchase_id: "purchase-1", purchase: { status: "cancelado" } },
      { id: "scan-devuelta", supplier_id: SUPPLIER_ID, number: "0123", supplier_tax_id: null, matched_contact_id: null, purchase_id: "purchase-2", purchase: { status: "devuelto" } },
    ];
    const tables = fullTables();
    tables.invoice_scans = (query) => ({ data: argsOf(query, "ilike").length > 0 ? rows : [], error: null });
    const stub = createSupabaseStub({ candidates, tables, rpcs: { tax_rates_for_store: taxRateRows } });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);

    expect(ctx.previousScans.map((scan) => [scan.scanId, scan.purchaseStatus])).toEqual([
      ["scan-anulada", "cancelado"],
      ["scan-devuelta", "devuelto"],
    ]);
    expect(matchInvoice(extraction, ctx).duplicateOfScanId).toBe("scan-devuelta");
  });
});

describe("loadMatchContext · tasa del día del formulario de compra (CIE-02, caos 6.7)", () => {
  const loadWith = async (printedRate?: number) => {
    const stub = createSupabaseStub({ candidates, tables: fullTables(), rpcs: { tax_rates_for_store: taxRateRows } });
    const scanned: InvoiceExtraction = { ...extraction, ...(printedRate !== undefined ? { printedRate } : {}) };
    const ctx = await loadMatchContext(stub.client, STORE_ID, scanned);
    return { ctx, match: matchInvoice(scanned, ctx), stub };
  };

  it("D24-b: lee la tasa oficial sin persistirla ni consultar exchange_rates", async () => {
    readExchangeRateMock.mockResolvedValue({
      id: "live-official",
      rateVes: 52.25,
      source: DOLAR_API_OFFICIAL_SOURCE,
      createdAt: "2026-10-16T12:00:00Z",
    });

    const { ctx, match, stub } = await loadWith();

    expect(readExchangeRateMock).toHaveBeenCalledTimes(1);
    expect(persistingExchangeRateMock).not.toHaveBeenCalled();
    expect(stub.queries.map((query) => query.table)).not.toContain("exchange_rates");
    expect(ctx.systemRate).toBe(52.25);
    expect(match.rate).toEqual({ system: 52.25 });
    const [harina] = match.lines;
    expect(harina.unitCostRef).toBe(roundMoney(harina.unitCostVes! / 52.25));
  });

  it("DolarAPI caída y factura con tasa impresa: convierte con la impresa y lo avisa", async () => {
    readExchangeRateMock.mockRejectedValue(new Error("DolarAPI caída"));

    const { ctx, match } = await loadWith(45);

    expect(ctx.systemRate).toBeUndefined();
    expect(match.rate).toEqual({
      printed: 45,
      warning: "No hay tasa del día en el sistema: se usó la tasa impresa en la factura (45,00).",
    });
    const [harina] = match.lines;
    expect(harina.unitCostRef).toBe(roundMoney(harina.unitCostVes! / 45));
  });

  it("DolarAPI caída y sin tasa impresa: no precarga costos REF, pide la tasa y no confirma en silencio", async () => {
    readExchangeRateMock.mockRejectedValue(new Error("DolarAPI caída"));

    const { ctx, match } = await loadWith();

    expect(ctx.systemRate).toBeUndefined();
    expect(match.rate).toEqual({ warning: MISSING_RATE_WARNING });
    for (const line of match.lines) {
      expect(line.unitCostRef).toBeUndefined();
    }
    // Harina tiene último costo (0,95 REF): sin tasa no se verificó y no queda confirmada.
    expect(match.lines[0].status).not.toBe("confirmed");
    expect(match.lines[0].issues).toContain(NO_RATE_PRICE_ISSUE);
  });

  it("tasa no positiva del servicio se trata como ausente", async () => {
    readExchangeRateMock.mockResolvedValue({
      id: "live-official",
      rateVes: 0,
      source: DOLAR_API_OFFICIAL_SOURCE,
      createdAt: "2026-10-16T12:00:00Z",
    });

    const { ctx } = await loadWith();

    expect(ctx.systemRate).toBeUndefined();
  });
});

describe("loadMatchContext · coherencia de precio sin compras recibidas (D24-c, caos B4)", () => {
  function tablesWithCostRef(costs: Record<string, unknown>): Record<string, TableHandler> {
    const tables = fullTables();
    const products = tables.products!;
    return {
      ...tables,
      products: (query) => {
        const result = products(query);
        const select = String(argsOf(query, "select")[0]?.[0] ?? "");
        if (select.startsWith("id, purchase_items")) {
          return result;
        }
        const rows = result.data as Array<{ id: string }>;
        return { ...result, data: rows.map((row) => ({ ...row, current_cost_ref: costs[row.id] ?? null })) };
      },
    };
  }

  it("sin último costo recibido usa products.current_cost_ref; el recibido sigue ganando", async () => {
    const stub = createSupabaseStub({
      candidates,
      tables: tablesWithCostRef({ [ARROZ_ID]: "0.8", [CAJA_ID]: 0, [HARINA_ID]: 5 }),
      rpcs: { tax_rates_for_store: taxRateRows },
    });

    const ctx = await loadMatchContext(stub.client, STORE_ID, extraction);
    const byId = new Map(ctx.products.map((product) => [product.id, product]));

    expect(byId.get(ARROZ_ID)?.lastUnitCostRef).toBe(0.8);
    expect(byId.get(CAJA_ID)?.lastUnitCostRef).toBeNull(); // 0 no es un costo
    expect(byId.get(HARINA_ID)?.lastUnitCostRef).toBe(0.95); // recibido del proveedor
  });
});

/**
 * C6-M3 (REP6-03): PostgREST corta cada respuesta en `max_rows = 1000`. La tabla
 * falsa aplica los `eq`/`in` de primer nivel, el `order` y el `range` pedidos, y
 * nunca devuelve más de 1000 filas (sin `order` ni `range`, las 1000 primeras).
 */
const POSTGREST_MAX_ROWS = 1000;

function cappedTable(rows: Array<Record<string, unknown>>): TableHandler {
  return (query) => {
    let data = rows.filter(
      (row) =>
        argsOf(query, "eq").every(([column, value]) => !(String(column) in row) || row[String(column)] === value) &&
        argsOf(query, "in").every(([column, values]) => (values as unknown[]).includes(row[String(column)])),
    );
    const [order] = argsOf(query, "order");
    if (order) {
      const column = String(order[0]);
      data = [...data].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
    }
    const [range] = argsOf(query, "range");
    const from = range ? Number(range[0]) : 0;
    const to = range ? Number(range[1]) : Number.POSITIVE_INFINITY;
    return { data: data.slice(from, Math.min(to + 1, from + POSTGREST_MAX_ROWS)), error: null };
  };
}

describe("loadMatchContext · más de 1000 filas por proveedor (C6-M3, REP6-03)", () => {
  const VATEL_ID = "88888888-8888-4888-8888-888888888888";
  const TECLADO_ID = "99999999-9999-4999-8999-999999999999";
  const SKU_PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const pad = (n: number) => String(n).padStart(4, "0");
  const fillerId = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;

  const bigExtraction: InvoiceExtraction = {
    supplier: { name: "CAOSG", taxId: "J-12345678-9" },
    currency: "VES",
    lines: [
      { rawText: "TECLADO ALIAS 3", description: "TECLADO ALIAS 3", quantity: 1, unitPrice: 10, lineTotal: 10, confidence: 0.9 },
      { rawText: "ACEITE VATEL 1LT", description: "ACEITE VATEL 1LT", quantity: 1, unitPrice: 10, lineTotal: 10, confidence: 0.9 },
      {
        rawText: "PRODUCTO POR SKU",
        description: "PRODUCTO POR SKU",
        quantity: 1,
        unitPrice: 10,
        lineTotal: 10,
        supplierSku: "SKU-1200",
        confidence: 0.9,
      },
    ],
    confidence: 0.9,
    warnings: [],
  };

  function bigTables(): Record<string, TableHandler> {
    // 1500 alias del proveedor; el de TECLADO entre los primeros 1000 y el de VATEL en la posición 1200.
    const aliases = Array.from({ length: 1500 }, (_, n) => ({
      id: `alias-${pad(n)}`,
      store_id: STORE_ID,
      supplier_id: SUPPLIER_ID,
      alias_norm: n === 10 ? "teclado alias 3" : n === 1200 ? "aceite vatel 1lt" : `malta polar ${pad(n)}`,
      product_id: n === 10 ? TECLADO_ID : n === 1200 ? VATEL_ID : MALTA_ID,
      pack_label: null,
      units_per_pack: null,
      hits: n === 1200 ? 2 : 1,
    }));
    // 1500 vínculos del proveedor; el del SKU-1200 pasa del corte.
    const links = Array.from({ length: 1500 }, (_, n) => ({
      id: `sp-${pad(n)}`,
      store_id: STORE_ID,
      supplier_id: SUPPLIER_ID,
      is_active: true,
      product_id: n === 1200 ? SKU_PRODUCT_ID : fillerId(n),
      supplier_sku: `SKU-${n}`,
      is_preferred: false,
      supplier_product_pack_units: [],
    }));
    const products = [
      productRow(VATEL_ID, "Aceite Vatel 1L"),
      productRow(TECLADO_ID, "Teclado Prod 3"),
      productRow(SKU_PRODUCT_ID, "Producto por SKU"),
      productRow(MALTA_ID, "Malta Polar"),
      ...links.filter((link) => link.product_id !== SKU_PRODUCT_ID).map((link) => productRow(link.product_id, link.id)),
    ].map((row) => ({ ...row, store_id: STORE_ID }));
    const productTable = cappedTable(products);
    return {
      supplier_product_aliases: cappedTable(aliases),
      supplier_products: cappedTable(links),
      products: (query) => {
        const select = String(argsOf(query, "select")[0]?.[0] ?? "");
        return select.startsWith("id, purchase_items") ? { data: [], error: null } : productTable(query);
      },
    };
  }

  it("el alias exacto en la posición 1200 confirma la línea y el SKU vinculado pasado el corte también", async () => {
    const stub = createSupabaseStub({
      candidates: { suppliers: candidates.suppliers.slice(0, 1), supplier_id: SUPPLIER_ID, lines: [] },
      tables: bigTables(),
      rpcs: { tax_rates_for_store: taxRateRows },
    });

    const ctx = await loadMatchContext(stub.client, STORE_ID, bigExtraction);
    const match = matchInvoice(bigExtraction, ctx);

    expect(match.lines[0]).toMatchObject({ status: "confirmed", productId: TECLADO_ID });
    expect(match.lines[1]).toMatchObject({ status: "confirmed", productId: VATEL_ID });
    expect(match.lines[1]?.candidates?.[0]?.reason).toBe("alias visto 2 veces");
    expect(match.lines[2]).toMatchObject({ status: "confirmed", productId: SKU_PRODUCT_ID });
    expect(ctx.supplierCatalogs[SUPPLIER_ID]?.supplierProducts).toHaveLength(1500);
    expect(ctx.products.find((product) => product.id === SKU_PRODUCT_ID)?.linkedToSupplier).toBe(true);
  });
});
