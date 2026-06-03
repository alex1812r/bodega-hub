/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { GET, POST } from "./route";

describe("/api/products", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns products for authorized role", async () => {
    const response = await GET(new Request("http://localhost/api/products"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ sku: expect.any(String) })]),
        limit: 10,
        skip: 0,
        total: expect.any(Number),
      }),
    );
  });

  it("filters products by active state and category", async () => {
    const response = await GET(
      new Request("http://localhost/api/products?isActive=true&categoryId=cat-electric"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          categoryId: "cat-electric",
          isActive: true,
        }),
      ]),
    );
    expect(
      body.data.items.every(
        (product: { categoryId: string; isActive: boolean }) =>
          product.categoryId === "cat-electric" && product.isActive,
      ),
    ).toBe(true);
  });

  it("paginates products with skip and limit", async () => {
    const response = await GET(new Request("http://localhost/api/products?skip=1&limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.skip).toBe(1);
    expect(body.data.limit).toBe(10);
    expect(body.data.items.length).toBeLessThanOrEqual(10);
  });

  it("blocks unauthorized product creation", async () => {
    const response = await POST(
      new Request("http://localhost/api/products", {
        body: JSON.stringify({
          name: "Producto",
          salePriceRef: 10,
          sku: "SKU-TEST",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("validates create payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/products", {
        body: JSON.stringify({ name: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects duplicate product SKU", async () => {
    const response = await POST(
      new Request("http://localhost/api/products", {
        body: JSON.stringify({
          name: "Taladro duplicado",
          salePriceRef: 10,
          sku: "HER-TAL-001",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
  });

  describe("supabase data source", () => {
    const mockRange = jest.fn();
    const mockSelect = jest.fn(() => ({
      eq: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: mockRange,
    }));

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      mockRange.mockResolvedValue({
        count: 1,
        data: [
          {
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
        ],
        error: null,
      });
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: jest.fn(() => ({
          select: mockSelect,
        })),
      });
    });

    it("lists products from supabase with pagination", async () => {
      const response = await GET(new Request("http://localhost/api/products?skip=0&limit=10"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([
        expect.objectContaining({
          categoryId: "cat-1",
          id: "prod-1",
          salePriceRef: 15,
          sku: "SKU-001",
        }),
      ]);
      expect(body.data.total).toBe(1);
      expect(mockRange).toHaveBeenCalledWith(0, 9);
    });
  });
});
