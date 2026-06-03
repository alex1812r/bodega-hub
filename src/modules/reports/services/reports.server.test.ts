/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import {
  getCustomerPurchasesReport,
  getDailySalesReport,
  getGrossProfitReport,
  getLowStockReport,
  getStockCard,
} from "./reports.server";

function createQueryBuilder(result: { count?: number | null; data?: unknown; error?: null }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
  };

  return builder;
}

describe("reports.server", () => {
  const mockFrom = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: mockFrom,
    });
  });

  it("maps daily sales from daily_sales_summary view", async () => {
    mockFrom.mockReturnValue(
      createQueryBuilder({
        count: 1,
        data: [
          {
            paid_ves: 100,
            sale_date: "2026-05-18",
            sales_count: 2,
            total_ref: 50,
            total_ves: 25000,
          },
        ],
        error: null,
      }),
    );

    const result = await getDailySalesReport(new URLSearchParams("skip=0&limit=10"));

    expect(result.items[0]).toEqual({
      paidVes: 100,
      saleDate: "2026-05-18",
      salesCount: 2,
      totalRef: 50,
      totalVes: 25000,
    });
  });

  it("maps gross profit from gross_profit_summary view", async () => {
    mockFrom.mockReturnValue(
      createQueryBuilder({
        count: 1,
        data: [
          {
            cost_ref: 20,
            gross_profit_ref: 30,
            revenue_ref: 50,
            sale_date: "2026-05-18",
          },
        ],
        error: null,
      }),
    );

    const result = await getGrossProfitReport(new URLSearchParams("skip=0&limit=10"));

    expect(result.items[0]).toEqual({
      costRef: 20,
      grossProfitRef: 30,
      revenueRef: 50,
      saleDate: "2026-05-18",
    });
  });

  it("maps low stock products from low_stock_products view", async () => {
    mockFrom.mockReturnValue(
      createQueryBuilder({
        count: 1,
        data: [
          {
            category_id: "cat-1",
            current_cost_ref: 5,
            current_stock: 1,
            id: "prod-1",
            image_url: null,
            is_active: true,
            min_stock: 5,
            name: "Cable",
            sale_price_ref: 10,
            sku: "SKU-1",
          },
        ],
        error: null,
      }),
    );

    const result = await getLowStockReport(new URLSearchParams("skip=0&limit=10"));

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        currentStock: 1,
        id: "prod-1",
        sku: "SKU-1",
      }),
    );
  });

  it("filters stock card by productId", async () => {
    const builder = createQueryBuilder({
      count: 1,
      data: [
        {
          created_at: "2026-05-18T10:00:00.000Z",
          id: "mov-1",
          product_id: "prod-1",
          product_name: "Cable",
          purchase_id: null,
          quantity_delta: -1,
          reason: null,
          sale_id: "sale-1",
          sku: "SKU-1",
          stock_after: 4,
          type: "venta",
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue(builder);

    await getStockCard(new URLSearchParams("productId=prod-1&skip=0&limit=10"));

    expect(builder.eq).toHaveBeenCalledWith("product_id", "prod-1");
  });

  it("maps customer purchase summary rows", async () => {
    mockFrom.mockReturnValue(
      createQueryBuilder({
        count: 1,
        data: [
          {
            customer_id: "cust-1",
            last_purchase_at: "2026-05-18T10:00:00.000Z",
            name: "Cliente Demo",
            pending_ves: 10,
            sales_count: 2,
            total_ref: 100,
            total_ves: 50000,
          },
        ],
        error: null,
      }),
    );

    const result = await getCustomerPurchasesReport(new URLSearchParams("skip=0&limit=10"));

    expect(result.items[0]).toEqual({
      customerId: "cust-1",
      lastPurchaseAt: "2026-05-18T10:00:00.000Z",
      name: "Cliente Demo",
      pendingVes: 10,
      salesCount: 2,
      totalRef: 100,
      totalVes: 50000,
    });
  });
});
