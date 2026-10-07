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

  it("filters products by exact barcode", async () => {
    const response = await GET(
      new Request("http://localhost/api/products?barcode=7501234567890&isActive=true"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([
      expect.objectContaining({
        barcode: "7501234567890",
        id: "prod-drill",
      }),
    ]);
    expect(body.data.total).toBe(1);
  });

  it("filters products by exact sku, normalizing case and spaces", async () => {
    const response = await GET(
      new Request("http://localhost/api/products?sku=%20HER-TAL-001%20&search=no-coincide"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([
      expect.objectContaining({ id: "prod-drill", sku: "her-tal-001" }),
    ]);
    expect(body.data.total).toBe(1);
  });

  it("does not match a partial sku with the exact filter", async () => {
    const response = await GET(new Request("http://localhost/api/products?sku=her-tal"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it("ignores an empty sku parameter", async () => {
    const withEmptySku = await GET(new Request("http://localhost/api/products?sku=%20&limit=100"));
    const withoutSku = await GET(new Request("http://localhost/api/products?limit=100"));
    const emptyBody = await withEmptySku.json();
    const plainBody = await withoutSku.json();

    expect(withEmptySku.status).toBe(200);
    expect(emptyBody.data.total).toBeGreaterThan(1);
    expect(emptyBody.data.total).toBe(plainBody.data.total);
  });

  it("does not return a product of another store by exact sku", async () => {
    const otherStore = { headers: { "x-demo-store-id": "00000000-0000-4000-8000-000000000002" } };
    const fromDefaultStore = await GET(new Request("http://localhost/api/products?sku=sur-arr-001"));
    const fromOtherStore = await GET(
      new Request("http://localhost/api/products?sku=her-tal-001", otherStore),
    );
    const ownInOtherStore = await GET(
      new Request("http://localhost/api/products?sku=sur-arr-001", otherStore),
    );

    expect((await fromDefaultStore.json()).data.items).toEqual([]);
    expect((await fromOtherStore.json()).data.items).toEqual([]);
    expect((await ownInOtherStore.json()).data.items).toEqual([
      expect.objectContaining({ id: "prod-sur-arroz" }),
    ]);
  });

  it("paginates products with skip and limit", async () => {
    const response = await GET(new Request("http://localhost/api/products?skip=1&limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.skip).toBe(1);
    expect(body.data.limit).toBe(10);
    expect(body.data.items.length).toBeLessThanOrEqual(10);
  });

  it("sorts products by stock descending in mock mode", async () => {
    const response = await GET(
      new Request("http://localhost/api/products?sortBy=currentStock&sortOrder=desc&limit=100"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(1);

    for (let index = 0; index < body.data.items.length - 1; index += 1) {
      expect(body.data.items[index].currentStock).toBeGreaterThanOrEqual(
        body.data.items[index + 1].currentStock,
      );
    }
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
    const mockOrder = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockOr = jest.fn().mockReturnThis();
    const mockSelect = jest.fn(() => ({
      eq: mockEq,
      ilike: jest.fn().mockReturnThis(),
      or: mockOr,
      order: mockOrder,
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
            sku: "sku-001",
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
          sku: "sku-001",
        }),
      ]);
      expect(body.data.total).toBe(1);
      expect(mockRange).toHaveBeenCalledWith(0, 9);
    });

    it("filters by exact sku within the server-resolved store", async () => {
      const response = await GET(
        new Request(
          "http://localhost/api/products?sku=%20SKU-001%20&search=taladro&store_id=otra-tienda&storeId=otra-tienda",
        ),
      );

      expect(response.status).toBe(200);
      expect(mockEq).toHaveBeenCalledWith("sku", "sku-001");
      expect(mockEq).toHaveBeenCalledWith("store_id", "00000000-0000-4000-8000-000000000001");
      expect(mockEq).not.toHaveBeenCalledWith("store_id", "otra-tienda");
      expect(mockOr).not.toHaveBeenCalled();
    });

    it("ignores an empty sku parameter in supabase", async () => {
      const response = await GET(new Request("http://localhost/api/products?sku=&search=taladro"));

      expect(response.status).toBe(200);
      expect(mockEq).not.toHaveBeenCalledWith("sku", expect.anything());
      expect(mockOr).toHaveBeenCalledTimes(1);
    });

    it("applies sort params when listing products from supabase", async () => {
      const response = await GET(
        new Request("http://localhost/api/products?sortBy=currentStock&sortOrder=desc&limit=10"),
      );

      expect(response.status).toBe(200);
      expect(mockOrder).toHaveBeenCalledWith("current_stock", { ascending: false });
    });
  });
});
