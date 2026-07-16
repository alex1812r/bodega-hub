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

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/products/[id]/price-history", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns product price history", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-drill/price-history"),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ productId: "prod-drill" })]),
    );
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("returns paginated price history from supabase", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn((table: string) => {
          if (table === "products") {
            return {
              select: jest.fn(() => ({
                eq: jest.fn().mockResolvedValue({ count: 1, error: null }),
              })),
            };
          }

          return {
            select: jest.fn(() => ({
              eq: jest.fn().mockReturnThis(),
              order: jest.fn().mockReturnThis(),
              range: jest.fn().mockResolvedValue({
                count: 1,
                data: [
                  {
                    changed_by: "user-1",
                    created_at: "2026-05-20T10:00:00.000Z",
                    id: "price-1",
                    new_sale_price_ref: 17,
                    product_id: "prod-1",
                  },
                ],
                error: null,
              }),
            })),
          };
        }),
      });

      const response = await GET(
        new Request("http://localhost/api/products/prod-1/price-history"),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({ productId: "prod-1", salePriceRef: 17 }),
      ]);
      expect(body.data.total).toBe(1);
    });
  });
});
