/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  cancelPurchase,
  createPurchase,
  getPurchaseById,
  listPurchases,
  receivePurchase,
  returnPurchase,
} from "./purchases.server";

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

function createQueryBuilder(result: { count?: number; data?: unknown; error?: unknown }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
  };

  return builder;
}

describe("purchases.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists purchases with pagination", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [
        {
          ...purchaseRow,
          purchase_items: [{ count: 2 }],
          supplier: {
            id: purchaseRow.supplier_id,
            is_active: true,
            name: "Proveedor Demo",
            type: "proveedor",
          },
        },
      ],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    const result = await listPurchases(
      new URLSearchParams("status=recibido&skip=0&limit=10"),
      DEFAULT_STORE_ID,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        itemsCount: 2,
        purchaseNumber: "C-000001",
        supplier: expect.objectContaining({ name: "Proveedor Demo" }),
      }),
    );
  });

  it("creates a purchase through create_purchase RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: purchaseRow, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    const result = await createPurchase(
      {
        items: [{ entryMode: "unit", productId: "44444444-4444-4444-4444-444444444444", quantity: 2, unitCostRef: 2 }],
        refRateVes: 510,
        status: "pedido",
        supplierId: purchaseRow.supplier_id,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledWith("create_purchase", {
      p_discount_ref: 0,
      p_exchange_rate_id: null,
      p_items: [
        {
          entry_mode: "unit",
          product_id: "44444444-4444-4444-4444-444444444444",
          quantity: 2,
          unit_cost_ref: 2,
        },
      ],
      p_notes: null,
      p_purchase_number: null,
      p_ref_rate_ves: 510,
      p_status: "pedido",
      p_supplier_id: purchaseRow.supplier_id,
      p_tax_ref: 0,
    });
    expect(result.purchaseNumber).toBe("C-000001");
  });

  it("returns not found when purchase detail is missing", async () => {
    const builder = createQueryBuilder({ data: null, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    await expect(getPurchaseById("missing", DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("receives a purchase through receive_purchase RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...purchaseRow, status: "recibido" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...purchaseRow,
        payments: [],
        purchase_items: [],
        status: "recibido",
        supplier: null,
      },
      error: null,
    });
    const paymentsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      select: jest.fn().mockReturnThis(),
    };

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === "payments") {
          return paymentsBuilder;
        }

        return detailBuilder;
      }),
      rpc,
    });

    const result = await receivePurchase(purchaseRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("receive_purchase", { p_purchase_id: purchaseRow.id });
    expect(result.status).toBe("recibido");
  });

  it("cancels a purchase through cancel_purchase RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...purchaseRow, status: "cancelado" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...purchaseRow,
        payments: [],
        purchase_items: [],
        status: "cancelado",
        supplier: null,
      },
      error: null,
    });
    const paymentsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      select: jest.fn().mockReturnThis(),
    };

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === "payments") {
          return paymentsBuilder;
        }

        return detailBuilder;
      }),
      rpc,
    });

    const result = await cancelPurchase(purchaseRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("cancel_purchase", { p_purchase_id: purchaseRow.id });
    expect(result.status).toBe("cancelado");
  });

  it("returns stock movements after return_purchase RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...purchaseRow, status: "devuelto" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...purchaseRow,
        payments: [],
        purchase_items: [],
        status: "devuelto",
        supplier: null,
      },
      error: null,
    });
    const paymentsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
      select: jest.fn().mockReturnThis(),
    };
    const movementsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            created_at: "2026-05-18T16:00:00.000Z",
            id: "55555555-5555-5555-5555-555555555555",
            product_id: "44444444-4444-4444-4444-444444444444",
            purchase_id: purchaseRow.id,
            quantity_delta: -2,
            reason: "Devolucion C-000001",
            type: "devolucion_proveedor",
          },
        ],
        error: null,
      }),
      select: jest.fn().mockReturnThis(),
    };

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        if (table === "stock_movements") {
          return movementsBuilder;
        }

        if (table === "payments") {
          return paymentsBuilder;
        }

        return detailBuilder;
      }),
      rpc,
    });

    const result = await returnPurchase(purchaseRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("return_purchase", { p_purchase_id: purchaseRow.id });
    expect(result.purchase.status).toBe("devuelto");
    expect(result.stockMovements[0].type).toBe("devolucion_proveedor");
  });
});
