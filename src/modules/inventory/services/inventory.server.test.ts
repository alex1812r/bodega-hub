/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { mapStockMovement } from "@/lib/supabase/mappers";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  createStockAdjustment,
  getStockCard,
  listInventory,
  listStockMovements,
} from "./inventory.server";

const movementRow = {
  created_at: "2026-05-18T10:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  product_id: "22222222-2222-4222-8222-222222222222",
  quantity_delta: 3,
  reason: "Conteo fisico",
  stock_after: 21,
  type: "ajuste_entrada" as const,
};

const productRow = {
  category_id: "33333333-3333-4333-8333-333333333333",
  current_cost_ref: 5,
  current_stock: 21,
  id: movementRow.product_id,
  is_active: true,
  min_stock: 5,
  name: "Cable HDMI",
  sale_price_ref: 12,
  sku: "ELE-CAB-001",
};

function createQueryBuilder(result: { count?: number; data?: unknown; error?: unknown }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
  };

  return builder;
}

describe("inventory.server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("maps stock movement rows to camelCase", () => {
    expect(
      mapStockMovement({
        ...movementRow,
        product: productRow,
      }),
    ).toEqual({
      createdAt: movementRow.created_at,
      id: movementRow.id,
      product: expect.objectContaining({ sku: "ele-cab-001" }),
      productId: movementRow.product_id,
      quantityDelta: 3,
      reason: "Conteo fisico",
      stockAfter: 21,
      type: "ajuste_entrada",
    });
  });

  it("lists inventory from products with low stock filter", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [productRow],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    const result = await listInventory(new URLSearchParams("lowStock=true&skip=0&limit=10"));

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ sku: "ele-cab-001" }));
  });

  it("lists stock movements with product join", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [{ ...movementRow, product: productRow }],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    const result = await listStockMovements(
      new URLSearchParams("productId=22222222-2222-4222-8222-222222222222"),
    );

    expect(builder.eq).toHaveBeenCalledWith(
      "product_id",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ name: "Cable HDMI" }),
        type: "ajuste_entrada",
      }),
    );
  });

  it("lists stock movements with type and date filters", async () => {
    const builder = createQueryBuilder({
      count: 0,
      data: [],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(builder),
    });

    await listStockMovements(
      new URLSearchParams(
        "type=venta&from=2026-05-01&to=2026-05-31&skip=0&limit=10",
      ),
    );

    expect(builder.eq).toHaveBeenCalledWith("type", "venta");
    expect(builder.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-05-01T00:00:00.000Z",
    );
    expect(builder.lte).toHaveBeenCalledWith(
      "created_at",
      "2026-05-31T23:59:59.999Z",
    );
  });

  it("reads stock card entries from stock_card view", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [
        {
          ...movementRow,
          product_name: "Cable HDMI",
          sku: "ELE-CAB-001",
        },
      ],
      error: null,
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockImplementation((table: string) => {
        expect(table).toBe("stock_card");
        return builder;
      }),
    });

    const result = await getStockCard(
      new URLSearchParams("productId=22222222-2222-4222-8222-222222222222"),
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        product: expect.objectContaining({ sku: "ele-cab-001" }),
        productId: movementRow.product_id,
      }),
    );
  });

  it("creates stock adjustments through adjust_stock RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: movementRow, error: null });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    const result = await createStockAdjustment({
      productId: movementRow.product_id,
      quantityDelta: 3,
      reason: "Conteo fisico",
      type: "ajuste_entrada",
    });

    expect(rpc).toHaveBeenCalledWith("adjust_stock", {
      p_product_id: movementRow.product_id,
      p_quantity_delta: 3,
      p_reason: "Conteo fisico",
      p_type: "ajuste_entrada",
    });
    expect(result.type).toBe("ajuste_entrada");
    expect(result.stockAfter).toBe(21);
  });

  it("maps insufficient stock RPC errors to 400", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "Stock insuficiente" },
    });

    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ rpc });

    await expect(
      createStockAdjustment({
        productId: movementRow.product_id,
        quantityDelta: -99,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });
});
