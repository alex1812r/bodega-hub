/**
 * @jest-environment node
 */
/**
 * SHR-10 · `tax_rate_code` hacia `create_purchase` y `taxRateCode` al leer lineas.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { createPurchase, getPurchaseById } from "./purchases.server";

const purchaseRow = {
  created_at: "2026-05-17T16:00:00.000Z",
  discount_ref: 0,
  id: "11111111-1111-1111-1111-111111111111",
  paid_ves: 0,
  purchase_number: "C-000001",
  ref_rate_ves: 510,
  status: "recibido" as const,
  subtotal_ref: 20,
  supplier_id: "22222222-2222-2222-2222-222222222222",
  tax_ref: 0,
  total_ref: 20,
  total_ves: 10200,
  updated_at: "2026-05-17T16:00:00.000Z",
  user_id: "33333333-3333-3333-3333-333333333333",
};

const PRODUCT_ID = "44444444-4444-4444-4444-444444444444";

function line(tax: Pick<PurchaseItemInput, "taxRate" | "taxRateCode">): PurchaseItemInput {
  return {
    costCurrency: "ref",
    entryMode: "unit",
    productId: PRODUCT_ID,
    quantity: 2,
    subtotalRef: 4,
    subtotalVes: 2040,
    taxRef: 0.64,
    taxVes: 326.4,
    unitCostRef: 2,
    unitCostVes: 1020,
    ...tax,
  };
}

function create(items: PurchaseItemInput[]) {
  return createPurchase(
    {
      discountRef: 0,
      discountVes: 0,
      items,
      refRateVes: 510,
      subtotalRef: 4,
      subtotalVes: 2040,
      supplierId: purchaseRow.supplier_id,
      taxRef: 0.64,
      taxVes: 326.4,
    },
    DEFAULT_STORE_ID,
  );
}

function sentItems(rpc: jest.Mock) {
  return (rpc.mock.calls[0]?.[1] as { p_items: Array<Record<string, unknown>> }).p_items;
}

describe("purchases.server · alicuota de IVA por linea (SHR-10)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("envia tax_rate_code a create_purchase, con o sin tax_rate", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: purchaseRow, error: null });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await create([line({ taxRateCode: "general" }), line({ taxRate: 8, taxRateCode: "reducida" })]);

    expect(rpc).toHaveBeenCalledWith("create_purchase", expect.any(Object));
    expect(sentItems(rpc)).toEqual([
      {
        cost_currency: "ref",
        entry_mode: "unit",
        product_id: PRODUCT_ID,
        quantity: 2,
        subtotal_ref: 4,
        subtotal_ves: 2040,
        tax_rate_code: "general",
        tax_ref: 0.64,
        tax_ves: 326.4,
        unit_cost_ref: 2,
        unit_cost_ves: 1020,
      },
      {
        cost_currency: "ref",
        entry_mode: "unit",
        product_id: PRODUCT_ID,
        quantity: 2,
        subtotal_ref: 4,
        subtotal_ves: 2040,
        tax_rate: 8,
        tax_rate_code: "reducida",
        tax_ref: 0.64,
        tax_ves: 326.4,
        unit_cost_ref: 2,
        unit_cost_ves: 1020,
      },
    ]);
  });

  it("un cliente que solo manda taxRate produce el payload de siempre (sin la clave tax_rate_code)", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: purchaseRow, error: null });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await create([line({ taxRate: 16 })]);

    expect(Object.keys(sentItems(rpc)[0] ?? {})).not.toContain("tax_rate_code");
    expect(sentItems(rpc)[0]).toEqual(expect.objectContaining({ tax_rate: 16 }));
  });

  it("el rechazo PT400 de la RPC sale como 400 con su mensaje tal cual", async () => {
    const message = "El porcentaje de IVA 13.00 % no corresponde a ninguna alicuota activa";
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: "PT400", message } });
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(create([line({ taxRate: 13 })])).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message,
      status: 400,
    });
  });

  it("al leer una compra devuelve taxRateCode por linea y pide la columna", async () => {
    (createAdminSupabaseClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest
              .fn()
              .mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
          })),
        })),
      })),
    });

    const itemRow = {
      product_id: PRODUCT_ID,
      purchase_id: purchaseRow.id,
      quantity: 2,
      subtotal_ref: 4,
      subtotal_ves: 2040,
      tax_ref: 0.64,
      tax_ves: 326.4,
      unit_cost_ref: 2,
      unit_cost_ves: 1020,
    };
    const purchaseSelect = jest.fn().mockReturnThis();
    const purchaseBuilder = {
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          ...purchaseRow,
          purchase_items: [
            { ...itemRow, tax_rate: "16.00", tax_rate_code: "general" },
            { ...itemRow, tax_rate: "13.00", tax_rate_code: null },
          ],
        },
        error: null,
      }),
      select: purchaseSelect,
    };
    const paymentsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      select: jest.fn().mockReturnThis(),
    };

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn((table: string) => (table === "purchases" ? purchaseBuilder : paymentsBuilder)),
    });

    const purchase = await getPurchaseById(purchaseRow.id, DEFAULT_STORE_ID);

    expect(String(purchaseSelect.mock.calls[0]?.[0])).toMatch(/\btax_rate_code\b/);
    expect(purchase.items.map((item) => [item.taxRate, item.taxRateCode])).toEqual([
      [16, "general"],
      [13, undefined],
    ]);
  });
});
