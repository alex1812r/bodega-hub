/**
 * @jest-environment node
 */
/**
 * P8-M1 / C7-M1 (D35): ninguna lectura de `loadMatchContext` mete texto de la
 * factura en la URL. Con un filtro `in(alias_norm)` por URL, una factura de
 * ≥55 líneas de texto normal pasaba de ~8 kB, el gateway respondía 414 y el
 * escaneo daba 500 con la página ya cobrada. El texto de la factura viaja solo
 * en el cuerpo POST de las RPC; las consultas por URL filtran por ids internos.
 */
import { normalizeAlias } from "@bodega/core/invoice";

import { readCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.server";

import type { InvoiceExtraction } from "../contracts";

import { loadMatchContext, MATCH_CANDIDATES_RPC, type MatchContextSupabaseClient } from "./loadMatchContext";
import { exactAliasTexts } from "./match/product";
import { normalizeInvoiceNumber } from "./match/text";

jest.mock("../../settings/services/exchangeRates.server", () => ({
  getCurrentExchangeRate: jest.fn(),
  readCurrentExchangeRate: jest.fn(),
}));

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
/** Kong corta la URL entre 8,0 y 8,5 kB (ev-30, ev-p7-url-limit). */
const GATEWAY_URI_LIMIT = 8000;
/** Métodos del query builder que no llevan valores de filtro. */
const NON_FILTER_METHODS = new Set(["select", "order", "limit", "range", "maybeSingle"]);

type Call = { method: string; args: unknown[] };

/** Factura como la de la repro `p8/uri414.mjs`: description ~45 caracteres, rawText ~95. */
function longInvoice(lines: number): InvoiceExtraction {
  return {
    supplier: { name: "Distribuidora Lab", taxId: "J-LAB-00001" },
    number: "FAC-0004512",
    date: "2026-10-14",
    total: 19262.4 * lines,
    currency: "VES",
    lines: Array.from({ length: lines }, (_, index) => ({
      rawText: `${String(index).padStart(6, "0")} HARINA DE MAIZ PRECOCIDA BLANCA PAN 1KG REF ${1000 + index} BULTO X 20,00 2,00 x 9.631,20 Bs 19.262,40 (E)`,
      description: `HARINA DE MAIZ PRECOCIDA BLANCA PAN 1KG REF ${1000 + index}`,
      quantity: 2,
      unitPrice: 9631.2,
      lineTotal: 19262.4,
      supplierSku: `SKU-HARINA-${1000 + index}`,
      barcode: `759 ${String(1000000 + index)}`,
      confidence: 0.9,
    })),
    confidence: 0.9,
    warnings: [],
  };
}

function createRecordingClient() {
  const queries: Array<{ table: string; calls: Call[] }> = [];
  const rpc = jest.fn(async (name: string) => {
    if (name === MATCH_CANDIDATES_RPC) {
      return { data: { suppliers: [], supplier_id: SUPPLIER_ID, lines: [] }, error: null };
    }
    return { data: [], error: null };
  });
  const from = jest.fn((table: string) => {
    const query = { table, calls: [] as Call[] };
    queries.push(query);
    const data =
      table === "supplier_products"
        ? [{ id: "sp-1", product_id: PRODUCT_ID, supplier_sku: "SKU-HARINA-1000", is_preferred: true, supplier_product_pack_units: [] }]
        : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "not", "ilike", "like", "or", "order", "limit", "range"]) {
      chain[method] = (...args: unknown[]) => {
        query.calls.push({ method, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject);
    return chain;
  });

  return { client: { from, rpc } as unknown as MatchContextSupabaseClient, queries, rpc };
}

/** Valores que una consulta pone en la querystring (filtros), aplanados a texto. */
function filterValues(calls: Call[]): string[] {
  return calls
    .filter((call) => !NON_FILTER_METHODS.has(call.method))
    .flatMap((call) => call.args.flatMap((arg) => (Array.isArray(arg) ? arg.map(String) : [String(arg)])))
    // Un patrón de LIKE intercalado (`%F%A%C%1`) también lleva el texto.
    .flatMap((value) => (value.includes("%") ? [value, value.replace(/%/g, "")] : [value]));
}

/** Textos de la factura que nunca deben ir en la URL. */
function invoiceTexts(extraction: InvoiceExtraction): string[] {
  const texts = extraction.lines.flatMap((line) => [
    ...exactAliasTexts(line),
    line.rawText,
    line.description ?? "",
    normalizeAlias(line.description ?? ""),
    line.supplierSku ?? "",
    line.barcode ?? "",
    (line.barcode ?? "").replace(/[^0-9A-Za-z]/g, ""),
  ]);
  texts.push(normalizeInvoiceNumber(extraction.number) ?? "", extraction.number ?? "", extraction.date ?? "");
  return [...new Set(texts.filter((text) => text.length >= 4))];
}

beforeEach(() => {
  jest.mocked(readCurrentExchangeRate).mockResolvedValue({
    id: "live",
    rateVes: 45.5,
    source: "test",
    createdAt: "2026-10-14T12:00:00Z",
  });
});

describe("loadMatchContext · ningún texto de la factura en la URL (P8-M1, C7-M1, D35)", () => {
  it.each([40, 55, 75, 150])("%i líneas: ninguna consulta por URL lleva claves de alias, barcodes, número ni fecha", async (lines) => {
    const extraction = longInvoice(lines);
    const stub = createRecordingClient();

    await loadMatchContext(stub.client, STORE_ID, extraction);

    const texts = invoiceTexts(extraction);
    const leaks = stub.queries.flatMap((query) =>
      filterValues(query.calls)
        .filter((value) => texts.some((text) => value.includes(text)))
        .map((value) => `${query.table}: ${value.slice(0, 80)}`),
    );
    expect(leaks).toEqual([]);
  });

  it("150 líneas: cada consulta por URL cabe holgada bajo el corte del gateway (sin 414)", async () => {
    const stub = createRecordingClient();

    await loadMatchContext(stub.client, STORE_ID, longInvoice(150));

    const lengths = stub.queries.map((query) => ({
      table: query.table,
      url: filterValues(query.calls).map((value) => encodeURIComponent(value)).join(",").length,
    }));
    expect(lengths.filter((entry) => entry.url > GATEWAY_URI_LIMIT)).toEqual([]);
  });
});
