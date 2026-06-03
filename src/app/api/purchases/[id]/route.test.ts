/**
 * @jest-environment node
 */

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/purchases/[id]", () => {
  it("returns purchase details", async () => {
    const response = await GET(
      new Request("http://localhost/api/purchases/purchase-001", {
        headers: { "x-demo-role": "almacen" },
      }),
      context("purchase-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        id: "purchase-001",
        items: expect.any(Array),
        payments: expect.any(Array),
      }),
    );
  });

  it("returns not found for missing purchase", async () => {
    const response = await GET(
      new Request("http://localhost/api/purchases/missing", {
        headers: { "x-demo-role": "almacen" },
      }),
      context("missing"),
    );

    expect(response.status).toBe(404);
  });
});
