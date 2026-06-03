/**
 * @jest-environment node
 */

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/purchases/[id]/cancel", () => {
  it("cancels a purchase in mock mode", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/purchases/purchase-001/cancel", {
        headers: { "x-demo-role": "almacen" },
        method: "PATCH",
      }),
      context("purchase-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("cancelado");
  });
});
