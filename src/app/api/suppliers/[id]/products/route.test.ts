/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/suppliers/[id]/products", () => {
  it("returns products for a supplier", async () => {
    const response = await GET(
      new Request("http://localhost/api/suppliers/cont-supplier/products"),
      context("cont-supplier"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ productId: "prod-cable" })]),
    );
  });
});
