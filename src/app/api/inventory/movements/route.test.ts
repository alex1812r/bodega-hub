/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory/movements", () => {
  it("returns stock movements", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/movements", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ type: "compra" })]));
  });

  it("filters movements by product", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/movements?productId=prod-cable", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.items.every((movement: { productId: string }) => movement.productId === "prod-cable"),
    ).toBe(true);
  });
});
