/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  cancelSale,
  createSale,
  getSaleById,
  listSales,
  mapSaleRow,
  returnSale,
} from "./sales.server";

const saleRow = {
  created_at: "2026-05-18T14:30:00.000Z",
  customer_id: "11111111-1111-1111-1111-111111111111",
  discount_ref: 0,
  exchange_rate_id: null,
  id: "22222222-2222-2222-2222-222222222222",
  invoice_number: "V-000001",
  notes: null,
  paid_ves: 7650,
  ref_rate_ves: 510,
  status: "pagada" as const,
  subtotal_ref: 15,
  tax_ref: 0,
  total_ref: 15,
  total_ves: 7650,
  updated_at: "2026-05-18T14:30:00.000Z",
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
    update: jest.fn().mockReturnThis(),
  };

  return builder;
}

describe("sales.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("maps sale rows to camelCase", () => {
    expect(mapSaleRow(saleRow)).toEqual({
      createdAt: saleRow.created_at,
      customerId: saleRow.customer_id,
      discountRef: 0,
      id: saleRow.id,
      invoiceNumber: "V-000001",
      paidVes: 7650,
      refRateVes: 510,
      status: "pagada",
      subtotalRef: 15,
      taxRef: 0,
      totalRef: 15,
      totalVes: 7650,
      updatedAt: saleRow.updated_at,
      userId: saleRow.user_id,
    });
  });

  it("lists sales with pagination", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [
        {
          ...saleRow,
          customer: {
            address: null,
            email: "cliente@example.com",
            id: saleRow.customer_id,
            name: "Cliente Demo",
            phone: null,
            type: "cliente",
          },
          sale_items: [{ count: 2 }],
        },
      ],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    const result = await listSales(
      new URLSearchParams("status=pagada&skip=0&limit=10"),
      DEFAULT_STORE_ID,
    );

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        customer: expect.objectContaining({ name: "Cliente Demo" }),
        invoiceNumber: "V-000001",
        itemsCount: 2,
      }),
    );
  });

  it("creates a sale through create_sale RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: saleRow, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    const result = await createSale(
      {
        customerId: saleRow.customer_id,
        items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
        refRateVes: 510,
      },
      DEFAULT_STORE_ID,
    );

    expect(rpc).toHaveBeenCalledWith("create_sale", {
      p_customer_id: saleRow.customer_id,
      p_discount_ref: 0,
      p_exchange_rate_id: null,
      p_invoice_number: null,
      p_items: [{ product_id: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
      p_notes: null,
      p_ref_rate_ves: 510,
      p_tax_ref: 0,
    });
    expect(result.invoiceNumber).toBe("V-000001");
  });

  it("returns not found when sale detail is missing", async () => {
    const builder = createQueryBuilder({ data: null, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    await expect(getSaleById("missing", DEFAULT_STORE_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("cancels a sale through cancel_sale RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...saleRow, status: "cancelada" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...saleRow,
        customer: null,
        payments: [],
        sale_items: [],
        status: "cancelada",
      },
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(detailBuilder),
      rpc,
    });

    const result = await cancelSale(saleRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("cancel_sale", { p_sale_id: saleRow.id });
    expect(result.status).toBe("cancelada");
  });

  it("returns stock movements after return_sale RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { ...saleRow, status: "devuelta" },
      error: null,
    });
    const detailBuilder = createQueryBuilder({
      data: {
        ...saleRow,
        customer: null,
        payments: [],
        sale_items: [],
        status: "devuelta",
      },
      error: null,
    });
    const movementsBuilder = {
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [
          {
            created_at: "2026-05-18T16:00:00.000Z",
            id: "55555555-5555-5555-5555-555555555555",
            product_id: "44444444-4444-4444-4444-444444444444",
            quantity_delta: 1,
            reason: "Devolucion V-000001",
            sale_id: saleRow.id,
            type: "devolucion_cliente",
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

        return detailBuilder;
      }),
      rpc,
    });

    const result = await returnSale(saleRow.id, DEFAULT_STORE_ID);

    expect(rpc).toHaveBeenCalledWith("return_sale", { p_sale_id: saleRow.id });
    expect(result.sale.status).toBe("devuelta");
    expect(result.stockMovements[0].type).toBe("devolucion_cliente");
  });
});
