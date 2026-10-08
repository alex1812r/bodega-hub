/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
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
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
  };

  return builder;
}

function mockAdminStoreLookup(found = true) {
  (createAdminSupabaseClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: found ? { store_id: DEFAULT_STORE_ID } : null,
            error: null,
          }),
        })),
      })),
    })),
  });
}

describe("purchases.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminStoreLookup(true);
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
        discountRef: 0,
        discountVes: 0,
        items: [
          {
            costCurrency: "ref",
            entryMode: "unit",
            productId: "44444444-4444-4444-4444-444444444444",
            quantity: 2,
            subtotalRef: 4,
            subtotalVes: 2040,
            taxRate: 0,
            taxRef: 0,
            taxVes: 0,
            unitCostRef: 2,
            unitCostVes: 1020,
          },
        ],
        refRateVes: 510,
        status: "pedido",
        subtotalRef: 4,
        subtotalVes: 2040,
        supplierId: purchaseRow.supplier_id,
        taxRef: 0,
        taxVes: 0,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledWith("create_purchase", {
      p_discount_ref: 0,
      p_discount_ves: 0,
      p_exchange_rate_id: null,
      p_items: [
        {
          cost_currency: "ref",
          entry_mode: "unit",
          product_id: "44444444-4444-4444-4444-444444444444",
          quantity: 2,
          subtotal_ref: 4,
          subtotal_ves: 2040,
          tax_rate: 0,
          tax_ref: 0,
          tax_ves: 0,
          unit_cost_ref: 2,
          unit_cost_ves: 1020,
        },
      ],
      p_notes: null,
      p_purchase_number: null,
      p_ref_rate_ves: 510,
      p_status: "pedido",
      p_subtotal_ref: 4,
      p_subtotal_ves: 2040,
      p_supplier_id: purchaseRow.supplier_id,
      p_tax_ref: 0,
      p_tax_ves: 0,
    });
    expect(result.purchaseNumber).toBe("C-000001");
  });

  it("returns not found when purchase detail is missing", async () => {
    mockAdminStoreLookup(false);
    const builder = createQueryBuilder({ data: null, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    await expect(getPurchaseById("missing", DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  // COM-16: los pagos individuales de una compra solo van a quien puede ver pagos de compras.
  describe("purchase detail payments by access (COM-16)", () => {
    const headerRow = { ...purchaseRow, paid_ref: 7.5, paid_ves: 3825, purchase_items: [] };
    const paymentRows = [
      {
        amount: 2040,
        amount_ref: 4,
        amount_ves: 2040,
        contact_id: purchaseRow.supplier_id,
        created_at: "2026-05-17T17:00:00.000Z",
        currency: "VES",
        direction: "salida",
        id: "44444444-4444-4444-4444-444444444444",
        method: "transferencia",
        purchase_id: purchaseRow.id,
        ref_rate_ves: 510,
        reference_code: "TRX-1",
      },
      {
        amount: 1020,
        amount_ref: 0,
        amount_ves: 1020,
        contact_id: purchaseRow.supplier_id,
        created_at: "2026-05-17T16:30:00.000Z",
        currency: "VES",
        direction: "salida",
        id: "55555555-5555-5555-5555-555555555555",
        method: "efectivo_ves",
        purchase_id: purchaseRow.id,
        ref_rate_ves: 510,
      },
    ];

    function mockDetail() {
      const purchaseBuilder = createQueryBuilder({ data: headerRow, error: null });
      const paymentsBuilder = {
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: paymentRows, error: null }),
        select: jest.fn().mockReturnThis(),
      };
      const from = jest.fn((table: string) =>
        table === "purchases" ? purchaseBuilder : paymentsBuilder,
      );

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

      return { from, paymentsBuilder };
    }

    it("without access: never queries payments, returns no payments and the header paid amounts", async () => {
      const { from } = mockDetail();

      const purchase = await getPurchaseById(purchaseRow.id, DEFAULT_STORE_ID, {
        canViewPayments: false,
      });

      expect(from.mock.calls.map(([table]) => table)).toEqual(["purchases"]);
      expect(purchase.payments).toEqual([]);
      expect(purchase.paidRef).toBe(7.5);
      expect(purchase.paidVes).toBe(3825);
      expect(purchase.id).toBe(purchaseRow.id);
      expect(purchase.items).toEqual([]);
    });

    it.each([
      ["explicit access", { canViewPayments: true }],
      ["default access", undefined],
    ] as const)("with %s: payments by purchase_id and paid amounts summed from them, as before", async (_label, access) => {
      const { from, paymentsBuilder } = mockDetail();

      const purchase = await getPurchaseById(purchaseRow.id, DEFAULT_STORE_ID, access);

      expect(from.mock.calls.map(([table]) => table)).toEqual(["purchases", "payments"]);
      expect(paymentsBuilder.eq).toHaveBeenCalledWith("purchase_id", purchaseRow.id);
      expect(paymentsBuilder.order).toHaveBeenCalledWith("created_at", { ascending: false });
      expect(purchase.payments.map((payment) => payment.id)).toEqual(
        paymentRows.map((row) => row.id),
      );
      // Suma de los pagos (4 + 1020 / 510 = 6 REF; 3060 Bs), no la cabecera (7.5 / 3825).
      expect(purchase.paidRef).toBe(6);
      expect(purchase.paidVes).toBe(3060);
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
