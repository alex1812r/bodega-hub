/**
 * @jest-environment node
 */

jest.mock("../../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

jest.mock("../../../../../lib/api/assertStoreResource", () => ({
  ...jest.requireActual("../../../../../lib/api/assertStoreResource"),
  assertSupabaseStoreResource: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET } from "../route";
import { POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/products/[id]/price", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("updates product price and returns history entry", async () => {
    const response = await POST(
      new Request("http://localhost/api/products/prod-drill/price", {
        body: JSON.stringify({ salePriceRef: 17 }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.product.salePriceRef).toBe(17);
    expect(body.data.history.productId).toBe("prod-drill");
  });

  it("persists the new price in mock mode: a later GET returns it (PRO-F2)", async () => {
    const headers = { "content-type": "application/json", "x-demo-role": "almacen" };

    await POST(
      new Request("http://localhost/api/products/prod-cable/price", {
        body: JSON.stringify({ salePriceRef: 4.2 }),
        headers,
        method: "POST",
      }),
      context("prod-cable"),
    );

    const response = await GET(
      new Request("http://localhost/api/products/prod-cable", { headers }),
      context("prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.salePriceRef).toBe(4.2);
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("updates product price via RPC", async () => {
      const historyMaybeSingle = jest.fn().mockResolvedValue({
        data: {
          changed_by: "user-1",
          created_at: "2026-05-20T10:00:00.000Z",
          id: "price-1",
          new_sale_price_ref: 17,
          product_id: "prod-1",
        },
        error: null,
      });
      const productMaybeSingle = jest.fn().mockResolvedValue({
        data: {
          category_id: "cat-1",
          current_cost_ref: 10,
          current_stock: 5,
          id: "prod-1",
          is_active: true,
          min_stock: 2,
          name: "Taladro",
          sale_price_ref: 17,
          sku: "SKU-001",
        },
        error: null,
      });

      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn((table: string) => {
          if (table === "product_price_history") {
            return {
              select: jest.fn(() => ({
                eq: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                maybeSingle: historyMaybeSingle,
                order: jest.fn().mockReturnThis(),
              })),
            };
          }

          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockReturnThis(),
              maybeSingle: productMaybeSingle,
              or: jest.fn().mockReturnThis(),
            })),
          };
        }),
        rpc: jest.fn().mockResolvedValue({
          data: {
            category_id: "cat-1",
            current_cost_ref: 10,
            current_stock: 5,
            id: "prod-1",
            is_active: true,
            min_stock: 2,
            name: "Taladro",
            sale_price_ref: 17,
            sku: "SKU-001",
          },
          error: null,
        }),
      });

      const response = await POST(
        new Request("http://localhost/api/products/prod-1/price", {
          body: JSON.stringify({ salePriceRef: 17 }),
          headers: {
            "content-type": "application/json",
            "x-demo-role": "almacen",
          },
          method: "POST",
        }),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.product.salePriceRef).toBe(17);
      expect(body.data.history.salePriceRef).toBe(17);
    });
  });
});
