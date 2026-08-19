/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";
import { getCaracasIsoDate, shiftIsoDate } from "@/shared/utils/caracasBusinessDay";

import {
  getDashboardLowStock,
  getDashboardMetrics,
  getDashboardSummary,
  getRecentSales,
} from "./dashboard.server";

function createQueryBuilder(result: { count?: number | null; data?: unknown; error?: null }) {
  const builder = {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return builder;
}

describe("dashboard.server", () => {
  const mockFrom = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
      from: mockFrom,
    });
  });

  it("builds dashboard summary from Caracas operational-day sales", async () => {
    const today = getCaracasIsoDate();
    const yesterday = shiftIsoDate(today, -1);

    mockFrom.mockImplementation((table: string) => {
      if (table === "sales") {
        return createQueryBuilder({
          count: 1,
          data: [
            { created_at: `${today}T12:00:00.000Z`, total_ref: 40, total_ves: 20000 },
            { created_at: `${today}T16:00:00.000Z`, total_ref: 40, total_ves: 20000 },
            { created_at: `${today}T20:00:00.000Z`, total_ref: 40, total_ves: 20000 },
            { created_at: `${yesterday}T12:00:00.000Z`, total_ref: 120, total_ves: 60000 },
          ],
          error: null,
        });
      }

      return createQueryBuilder({ count: table === "low_stock_products" ? 2 : 1, error: null });
    });

    const summary = await getDashboardSummary(DEFAULT_STORE_ID);

    expect(summary).toEqual({
      activeCustomers: 1,
      dayOverDayChangePercent: 0,
      lowStockCount: 2,
      pendingSalesCount: 1,
      previousDayTotalRef: 120,
      salesCount: 3,
      totalRef: 120,
      totalVes: 60000,
    });
  });

  it("aggregates dashboard metrics for a date range", async () => {
    const salesBuilder = createQueryBuilder({
      data: [
        { id: "sale-1", paid_ves: 20, total_ref: 10, total_ves: 50 },
        { id: "sale-2", paid_ves: 5, total_ref: 5, total_ves: 25 },
      ],
      error: null,
    });
    const itemsBuilder = createQueryBuilder({
      data: [{ quantity: 2 }, { quantity: 1 }],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "sales") {
        return salesBuilder;
      }

      return itemsBuilder;
    });

    const metrics = await getDashboardMetrics(
      new URLSearchParams("from=2026-05-18&to=2026-05-18"),
      DEFAULT_STORE_ID,
    );

    expect(metrics).toEqual(
      expect.objectContaining({
        paidVes: 25,
        pendingVes: 50,
        salesCount: 2,
        totalRef: 15,
        totalVes: 75,
        unitsSold: 3,
      }),
    );
  });

  it("applies Caracas operational-day bounds for a single from/to date", async () => {
    const salesBuilder = createQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(salesBuilder);

    await getDashboardMetrics(
      new URLSearchParams("from=2026-08-16&to=2026-08-16"),
      DEFAULT_STORE_ID,
    );

    expect(salesBuilder.gte).toHaveBeenCalledWith("created_at", "2026-08-16T04:00:00.000Z");
    expect(salesBuilder.lt).toHaveBeenCalledWith("created_at", "2026-08-17T04:00:00.000Z");
  });

  it("skips the lower bound when fromStart is set", async () => {
    const salesBuilder = createQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(salesBuilder);

    await getDashboardMetrics(
      new URLSearchParams("fromStart=1&from=2026-08-01&to=2026-08-16"),
      DEFAULT_STORE_ID,
    );

    expect(salesBuilder.gte).not.toHaveBeenCalled();
    expect(salesBuilder.lt).toHaveBeenCalledWith("created_at", "2026-08-17T04:00:00.000Z");
  });

  it("does not call gte when from is omitted", async () => {
    const salesBuilder = createQueryBuilder({ data: [], error: null });
    mockFrom.mockReturnValue(salesBuilder);

    await getDashboardMetrics(new URLSearchParams("to=2026-08-16"), DEFAULT_STORE_ID);

    expect(salesBuilder.gte).not.toHaveBeenCalled();
    expect(salesBuilder.lt).toHaveBeenCalledWith("created_at", "2026-08-17T04:00:00.000Z");
  });

  it("returns paginated recent sales", async () => {
    mockFrom.mockReturnValue(
      createQueryBuilder({
        count: 1,
        data: [
          {
            created_at: "2026-05-18T10:00:00.000Z",
            customer_id: "cust-1",
            discount_ref: 0,
            id: "sale-1",
            invoice_number: "F-001",
            paid_ves: 0,
            ref_rate_ves: 510,
            status: "pendiente_pago",
            subtotal_ref: 10,
            tax_ref: 0,
            total_ref: 10,
            total_ves: 5100,
            user_id: "user-1",
          },
        ],
        error: null,
      }),
    );

    const result = await getRecentSales(new URLSearchParams("skip=0&limit=10"), DEFAULT_STORE_ID);

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "sale-1",
        invoiceNumber: "F-001",
      }),
    );
  });

  it("returns paginated low stock products", async () => {
    mockFrom.mockReturnValue(
      createQueryBuilder({
        count: 1,
        data: [
          {
            current_stock: 1,
            id: "prod-1",
            min_stock: 5,
            name: "Cable",
            sku: "SKU-1",
          },
        ],
        error: null,
      }),
    );

    const result = await getDashboardLowStock(new URLSearchParams("skip=0&limit=10"), DEFAULT_STORE_ID);

    expect(result.items[0]).toEqual({
      currentStock: 1,
      id: "prod-1",
      minStock: 5,
      name: "Cable",
      sku: "SKU-1",
    });
  });
});
