/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { DELETE, GET, PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/products/[id]", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns a product by id", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-drill"),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("prod-drill");
  });

  it("returns not found for unknown product", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/missing"),
      context("missing"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("updates a product with warehouse role", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/products/prod-drill", {
        body: JSON.stringify({ salePriceRef: 16 }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "PATCH",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.salePriceRef).toBe(16);
  });

  it("deletes a product in mock mode", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/products/prod-drill", {
        headers: { "x-demo-role": "almacen" },
        method: "DELETE",
      }),
      context("prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  describe("supabase data source", () => {
    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
    });

    it("returns a product from supabase", async () => {
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn().mockResolvedValue({
                data: {
                  category: { id: "cat-1", is_active: true, name: "Tools" },
                  category_id: "cat-1",
                  current_cost_ref: 10,
                  current_stock: 5,
                  id: "prod-1",
                  is_active: true,
                  min_stock: 2,
                  name: "Taladro",
                  sale_price_ref: 15,
                  sku: "SKU-001",
                },
                error: null,
              }),
            })),
          })),
        })),
      });

      const response = await GET(
        new Request("http://localhost/api/products/prod-1"),
        context("prod-1"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(
        expect.objectContaining({
          id: "prod-1",
          salePriceRef: 15,
          sku: "SKU-001",
        }),
      );
    });
  });
});
