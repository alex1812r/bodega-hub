/**
 * @jest-environment node
 */
/**
 * REP-04 · caos-global B1: confirmaciones paralelas con la MISMA clave. El
 * pre-check lee la fila ANTES del reclamo; si otra petición del mismo intento
 * confirma entre medias, el reclamo responde `replay` con la lectura vieja
 * (`purchaseId: null`). El resultado debe salir del estado real del escaneo:
 * confirmado con ESTA compra → `confirmed: true`.
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../contacts/services/supplierProducts.server", () => ({
  createSupplierProductPackUnit: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import type { InvoiceExtraction } from "../contracts";

import { finalizeInvoiceScan, type FinalizeInvoiceScanInput, type PrecheckedInvoiceScan } from "./confirmScan.server";

const PRODUCT = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "33333333-3333-4333-8333-333333333333";
const PURCHASE = "00000000-0000-4000-8000-000000000101";
const OTHER_PURCHASE = "00000000-0000-4000-8000-000000000202";
const KEY = "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const STORE = "store-1";

const extraction: InvoiceExtraction = {
  confidence: 0.9,
  currency: "VES",
  lines: [{ confidence: 0.9, description: "HARINA PAN", lineTotal: 200, quantity: 2, rawText: "HARINA PAN", unitPrice: 100 }],
  supplier: { name: "Proveedor" },
  warnings: [],
};

const input: FinalizeInvoiceScanInput = {
  clientRequestId: KEY,
  items: [{ entryMode: "unit", productId: PRODUCT }],
  lines: [{ lineIndex: 0, productId: PRODUCT }],
  purchaseId: PURCHASE,
  supplierId: SUPPLIER,
};

type Row = { status: string; purchase_id: string | null } | null;

function fakeClient(row: Row, confirm: { data: unknown; error: unknown } = { data: true, error: null }) {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
    select() {
      return builder;
    },
  };
  const client = {
    from: jest.fn(() => builder),
    rpc: jest.fn(async (name: string) => {
      if (name === "confirm_invoice_scan") return confirm;
      if (name === "learn_invoice_aliases") return { data: 1, error: null };
      throw new Error(`RPC inesperada ${name}`);
    }),
  };
  jest.mocked(createRouteSupabaseClient).mockResolvedValue(client as never);
  return { client, filters };
}

describe("finalizeInvoiceScan · confirmaciones paralelas con la misma clave (REP-04 · caos B1)", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("replay con la lectura previa al reclamo (purchaseId null): el escaneo ya está confirmado con esta compra → confirmed:true", async () => {
    const stale: PrecheckedInvoiceScan = {
      extraction,
      id: "scan-1",
      learned: false,
      purchaseId: null,
      rawTexts: ["HARINA PAN"],
      replay: true,
    };
    const { client, filters } = fakeClient({ purchase_id: PURCHASE, status: "confirmed" });

    await expect(finalizeInvoiceScan(stale, input, STORE)).resolves.toEqual({ confirmed: true, learned: null });
    expect(filters).toMatchObject({ id: "scan-1", store_id: STORE });
    // No se vuelve a confirmar ni a aprender: lo hizo la petición que ganó.
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("replay con la lectura vieja pero el escaneo confirmado con OTRA compra → confirmed:false", async () => {
    const stale: PrecheckedInvoiceScan = { extraction, id: "scan-1", purchaseId: null, rawTexts: ["HARINA PAN"], replay: true };
    fakeClient({ purchase_id: OTHER_PURCHASE, status: "confirmed" });

    await expect(finalizeInvoiceScan(stale, input, STORE)).resolves.toEqual({ confirmed: false, learned: null });
  });

  it("confirm_invoice_scan falla pero el escaneo quedó confirmado con esta compra (otra petición del intento) → confirmed:true", async () => {
    const fresh: PrecheckedInvoiceScan = { extraction, id: "scan-1", purchaseId: null, rawTexts: ["HARINA PAN"], replay: false };
    fakeClient(
      { purchase_id: PURCHASE, status: "confirmed" },
      { data: null, error: { code: "PT409", message: "El escaneo se está confirmando en otra compra" } },
    );

    await expect(finalizeInvoiceScan(fresh, input, STORE)).resolves.toEqual({ confirmed: true, learned: null });
  });

  it("confirm_invoice_scan falla y el escaneo sigue sin confirmar → confirmed:false", async () => {
    const fresh: PrecheckedInvoiceScan = { extraction, id: "scan-1", purchaseId: null, rawTexts: ["HARINA PAN"], replay: false };
    fakeClient({ purchase_id: null, status: "extracted" }, { data: null, error: { code: "XX000", message: "caída" } });

    await expect(finalizeInvoiceScan(fresh, input, STORE)).resolves.toEqual({ confirmed: false, learned: null });
  });
});
