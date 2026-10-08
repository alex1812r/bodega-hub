/**
 * @jest-environment node
 */

import { applyMockPurchaseCost } from "@/modules/products/services/priceReview.mock-server";
import { createProduct } from "@/modules/products/services/products.mock-server";
import { mockPurchases } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET } from "./route";

function get(role = "admin") {
  return GET(
    new Request("http://localhost/api/products/price-review/summary", {
      headers: { "x-demo-role": role },
    }),
  );
}

describe("/api/products/price-review/summary", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("counts the products in the queue", async () => {
    const before = (await (await get()).json()).data.total;
    const id = createProduct(
      { currentCostRef: 8, name: "Aceite en revisión", salePriceRef: 10, sku: "rev-summary-1" },
      DEFAULT_STORE_ID,
    ).id;

    applyMockPurchaseCost(id, 9, mockPurchases[0].id);
    const response = await get("vendedor");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ total: before + 1 });
  });

  it("returns 403 without products.view", async () => {
    const response = await get("contador");

    expect(response.status).toBe(403);
  });
});
