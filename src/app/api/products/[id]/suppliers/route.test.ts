/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/products/[id]/suppliers", () => {
  it("returns suppliers for a product", async () => {
    const response = await GET(
      new Request("http://localhost/api/products/prod-cable/suppliers"),
      context("prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ supplierId: "cont-supplier" })]),
    );
  });
});
