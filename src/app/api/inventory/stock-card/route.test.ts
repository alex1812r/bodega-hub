/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory/stock-card", () => {
  it("returns stock card movements by product", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/stock-card?productId=prod-cable", {
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
