/**
 * @jest-environment node
 */
/**
 * REP2-02 (caos C2-M1 · auditoría B11): el pre-check mide el `confirmed` completo
 * (extracción + líneas con el rawText guardado) ANTES del reclamo y de
 * `create_purchase`, con el tope de `confirm_invoice_scan`.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../contacts/services/supplierProducts.server", () => ({
  createSupplierProductPackUnit: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  INVOICE_CONFIRMED_MAX_BYTES,
  INVOICE_CONFIRMED_TOO_LARGE_MESSAGE,
  jsonbSizeUpperBound,
  type InvoiceExtraction,
} from "../contracts";

import { precheckInvoiceScan } from "./confirmScan.server";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const STORE = "store-1";

function extractionOf(rawText: (index: number) => string): InvoiceExtraction {
  return {
    confidence: 0.9,
    currency: "VES",
    lines: Array.from({ length: 300 }, (_, index) => ({
      confidence: 0.9,
      description: `Producto ${index}`,
      lineTotal: 12.5,
      quantity: 1,
      rawText: rawText(index),
      unitPrice: 12.5,
    })),
    supplier: { name: "Proveedor" },
    warnings: [],
  };
}

const lines = (packLabel: string) =>
  Array.from({ length: 300 }, (_, lineIndex) => ({ lineIndex, packLabel, productId: PRODUCT, unitsPerPack: 6 }));

function fakeClient(extracted: InvoiceExtraction) {
  const builder = {
    eq() {
      return builder;
    },
    async maybeSingle() {
      return { data: { extracted, id: "scan-1", learned_at: null, purchase_id: null, status: "extracted" }, error: null };
    },
    select() {
      return builder;
    },
  };
  const client = { from: jest.fn(() => builder), rpc: jest.fn(async () => ({ data: "claimed", error: null })) };
  jest.mocked(createRouteSupabaseClient).mockResolvedValue(client as never);
  return client;
}

describe("precheckInvoiceScan · tamaño de confirmed (REP2-02)", () => {
  it("rawText guardado largo + packLabel de 100 € con la corregida bajo 128 KB → 400 sin reclamar", async () => {
    const client = fakeClient(extractionOf((index) => `L${index} ${"x".repeat(395)}`));

    await expect(
      precheckInvoiceScan(
        { clientRequestId: KEY, extraction: extractionOf((index) => `Producto ${index}`), lines: lines("€".repeat(100)), scanId: "scan-1" },
        STORE,
      ),
    ).rejects.toMatchObject({ message: INVOICE_CONFIRMED_TOO_LARGE_MESSAGE, status: 400 });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("300 líneas normales pasan y reclaman", async () => {
    const extracted = extractionOf((index) => `${index + 1} HARINA PAN BLANCA 1KG X 20 UND 12,50`);
    const client = fakeClient(extracted);

    await expect(
      precheckInvoiceScan({ clientRequestId: KEY, extraction: extracted, lines: lines("Bulto de 20"), scanId: "scan-1" }, STORE),
    ).resolves.toMatchObject({ id: "scan-1", replay: false });
    expect(client.rpc).toHaveBeenCalledWith("claim_invoice_scan", expect.anything());
  });
});

describe("jsonbSizeUpperBound", () => {
  it("cota por encima del JSON UTF-8: jsonb guarda JEntries de 4 bytes y numéricos de hasta 23", () => {
    const value = { a: 1, b: "€", c: [true, null, 12.5] };

    expect(jsonbSizeUpperBound(value)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(value)).length);
  });

  it("el tope es el de confirm_invoice_scan (pg_column_size(p_confirmed) > 262144)", () => {
    expect(INVOICE_CONFIRMED_MAX_BYTES).toBe(262144);
  });
});
