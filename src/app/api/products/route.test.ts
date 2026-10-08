/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import { mockPurchases } from "@/shared/mocks/erp-data";

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

  it("filters products by margin band and sorts them by margin percentage", async () => {
    const response = await GET(
      new Request("http://localhost/api/products?margin=high&sortBy=marginPct&sortOrder=asc&limit=100"),
    );
    const body = await response.json();
    const percentages: number[] = body.data.items.map(
      (product: { currentCostRef: number; salePriceRef: number }) =>
        ((product.salePriceRef - product.currentCostRef) / product.currentCostRef) * 100,
    );

    expect(response.status).toBe(200);
    expect(percentages.length).toBeGreaterThan(0);
    expect(percentages.every((pct) => pct >= 25)).toBe(true);
    expect(percentages).toEqual([...percentages].sort((left, right) => left - right));
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

  it("leaves out products with an active pack link only when packLink=none is sent", async () => {
    const linked = await GET(new Request("http://localhost/api/products?search=cig&isActive=true"));
    const free = await GET(
      new Request("http://localhost/api/products?search=cig&isActive=true&packLink=none"),
    );
    const linkedBody = await linked.json();
    const freeBody = await free.json();

    expect(free.status).toBe(200);
    expect(linkedBody.data.items.map((product: { id: string }) => product.id).sort()).toEqual([
      "prod-cigar-pack",
      "prod-cigar-unit",
    ]);
    expect(freeBody.data.items).toEqual([]);
    expect(freeBody.data.total).toBe(0);
  });

  it("packLink=not-pack leaves out only the pack: the unit of another pack can still be chosen", async () => {
    const response = await GET(
      new Request("http://localhost/api/products?search=cig&isActive=true&packLink=not-pack"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.map((product: { id: string }) => product.id)).toEqual(["prod-cigar-unit"]);
    expect(body.data.total).toBe(1);
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

  function postProduct(body: Record<string, unknown>) {
    return POST(
      new Request("http://localhost/api/products", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", "x-demo-role": "almacen" },
        method: "POST",
      }),
    );
  }

  it.each([{}, { sku: "" }, { sku: "   " }])(
    "creates a product without sku (%j) and generates it from the name",
    async (input) => {
      const name = `Ñandú Único ${JSON.stringify(input).length}`;
      const response = await postProduct({ name, salePriceRef: 10, ...input });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.name).toBe(name);
      expect(body.data.sku).toMatch(/^nand-unic-\d+$/);
    },
  );

  it("gives a second product with the same name a different generated sku", async () => {
    const first = await postProduct({ name: "Queso Llanero", salePriceRef: 4 });
    const second = await postProduct({ name: "Queso Llanero", salePriceRef: 4 });
    const listed = await GET(
      new Request("http://localhost/api/products?search=Queso%20Llanero&limit=100"),
    );
    const skus = (await listed.json()).data.items.map((product: { sku: string }) => product.sku);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(skus).toHaveLength(2);
    expect(skus).toContain("ques-llan");
    expect(skus.find((sku: string) => sku !== "ques-llan")).toMatch(/^ques-llan-[0-9a-f]{4}$/);
  });

  it("creates a product whose name has no letters or digits with a fallback sku", async () => {
    const response = await postProduct({ name: "🍕🍕", salePriceRef: 1 });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.sku).toMatch(/^producto(-[0-9a-f]{4})?$/);
  });

  it("still rejects a sku that is not text", async () => {
    const response = await postProduct({ name: "Producto", salePriceRef: 10, sku: 123 });

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

  it("review=1 returns only the products in the price review queue, each with its priceReview (PRO-11)", async () => {
    const created = await POST(
      new Request("http://localhost/api/products", {
        body: JSON.stringify({ currentCostRef: 8, name: "Azúcar en revisión", salePriceRef: 10, sku: "rev-list-1" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const product = (await created.json()).data;
    applyMockPurchaseCost(product.id, 9, mockPurchases[0].id);

    const response = await GET(new Request("http://localhost/api/products?review=1&limit=100"));
    const body = await response.json();
    const outside = await (await GET(new Request("http://localhost/api/products?review=1&limit=100&margin=high"))).json();

    expect(created.status).toBe(201);
    expect(product).not.toHaveProperty("priceReview");
    expect(response.status).toBe(200);
    expect(body.data.items.length).toBe(body.data.total);
    expect(body.data.items.every((item: { priceReview?: unknown }) => item.priceReview !== undefined)).toBe(true);
    expect(body.data.items.find((item: { id: string }) => item.id === product.id).priceReview).toEqual(
      expect.objectContaining({
        currentBand: "low",
        currentCostRef: 9,
        previousBand: "high",
        previousCostRef: 8,
        purchase: expect.objectContaining({ id: mockPurchases[0].id }),
      }),
    );
    expect(outside.data.items).toEqual([]);
  });

  describe("supabase data source", () => {
    const mockRange = jest.fn();
    const mockOrder = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockOr = jest.fn().mockReturnThis();
    const mockGte = jest.fn().mockReturnThis();
    const mockLt = jest.fn().mockReturnThis();
    const mockIs = jest.fn().mockReturnThis();
    const mockSelect = jest.fn(() => ({
      eq: mockEq,
      gte: mockGte,
      ilike: jest.fn().mockReturnThis(),
      is: mockIs,
      lt: mockLt,
      // Fila de app_settings de la tienda: sin configuración, umbrales por defecto.
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
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

    it("filters by margin band as a range of margin_pct and sorts by it with nulls last", async () => {
      const response = await GET(
        new Request("http://localhost/api/products?margin=mid&sortBy=marginPct&sortOrder=desc"),
      );

      expect(response.status).toBe(200);
      expect(mockGte).toHaveBeenCalledWith("margin_pct", 15);
      expect(mockLt).toHaveBeenCalledWith("margin_pct", 25);
      expect(mockIs).not.toHaveBeenCalled();
      expect(mockOrder).toHaveBeenCalledWith("margin_pct", { ascending: false, nullsFirst: false });
      expect(mockEq).toHaveBeenCalledWith("store_id", "00000000-0000-4000-8000-000000000001");
    });

    it("filters the products without cost with margin=none", async () => {
      const response = await GET(new Request("http://localhost/api/products?margin=none"));

      expect(response.status).toBe(200);
      expect(mockIs).toHaveBeenCalledWith("margin_pct", null);
      expect(mockGte).not.toHaveBeenCalled();
      expect(mockLt).not.toHaveBeenCalled();
    });

    it("does not filter by margin with an unknown value", async () => {
      const response = await GET(new Request("http://localhost/api/products?margin=barata"));

      expect(response.status).toBe(200);
      expect(mockGte).not.toHaveBeenCalled();
      expect(mockLt).not.toHaveBeenCalled();
      expect(mockIs).not.toHaveBeenCalled();
    });
  });
});
