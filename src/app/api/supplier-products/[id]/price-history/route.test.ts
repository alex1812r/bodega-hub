/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/supplier-products/[id]/price-history", () => {
  it("returns paginated price history for a supplier product", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products/supp-prod-drill/price-history"),
      context("supp-prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(body.data.items[0]).toEqual(
      expect.objectContaining({
        newCostRef: expect.any(Number),
        origin: expect.any(String),
      }),
    );
  });
});
