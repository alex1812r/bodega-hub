/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import { createProduct } from "@/modules/products/services/products.mock-server";
import { mockPurchases } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

function get(query = "", role = "admin") {
  return GET(
    new Request(`http://localhost/api/products/price-review${query}`, {
      headers: { "x-demo-role": role },
    }),
  );
}

describe("/api/products/price-review", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  const [firstPurchase, secondPurchase] = mockPurchases;
  let queuedId = "";

  beforeAll(() => {
    queuedId = createProduct(
      { currentCostRef: 8, name: "Harina en revisión", salePriceRef: 10, sku: "rev-route-1" },
      DEFAULT_STORE_ID,
    ).id;
    applyMockPurchaseCost(queuedId, 9, firstPurchase.id);
  });

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("returns the paginated queue with before → now and the purchase that raised the cost", async () => {
    const response = await get("?limit=100");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({ limit: 100, skip: 0, total: body.data.items.length }),
    );
    expect(body.data.items.find((item: { productId: string }) => item.productId === queuedId)).toEqual(
      expect.objectContaining({
        currentBand: "low",
        currentCostRef: 9,
        currentMarginPct: 11.111111,
        name: "Harina en revisión",
        previousBand: "high",
        previousCostRef: 8,
        previousMarginPct: 25,
        purchase: expect.objectContaining({
          id: firstPurchase.id,
          number: firstPurchase.purchaseNumber,
        }),
        salePriceRef: 10,
        sku: "rev-route-1",
      }),
    );
  });

  it("filters by purchaseId", async () => {
    const own = await (await get(`?limit=100&purchaseId=${firstPurchase.id}`)).json();
    const other = await (await get(`?limit=100&purchaseId=${secondPurchase.id}`)).json();

    expect(own.data.items.map((item: { productId: string }) => item.productId)).toContain(queuedId);
    expect(other.data.items.map((item: { productId: string }) => item.productId)).not.toContain(queuedId);
  });

  it("lets any role that can see products read it", async () => {
    expect((await get("", "vendedor")).status).toBe(200);
    expect((await get("", "almacen")).status).toBe(200);
  });

  it("returns 403 without products.view", async () => {
    const response = await get("", "contador");
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("reads the view scoped to the store of the session in supabase mode", async () => {
    process.env.API_DATA_SOURCE = "supabase";
    const eq = jest.fn();
    const chain = {
      eq,
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({ count: 0, data: [], error: null }),
      select: jest.fn(),
    };
    eq.mockReturnValue(chain);
    chain.order.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    const from = jest.fn(() => chain);
    (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from });

    const response = await get(`?store_id=otra-tienda`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ items: [], limit: 10, skip: 0, total: 0 });
    expect(from).toHaveBeenCalledWith("products_price_review");
    expect(eq.mock.calls).toEqual([["store_id", DEFAULT_STORE_ID]]);
  });
});
