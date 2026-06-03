/**
 * @jest-environment node
 */

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/sales/[id]/cancel", () => {
  it("cancels a sale in mock mode", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/sales/sale-002/cancel", {
        headers: { "x-demo-role": "vendedor" },
        method: "PATCH",
      }),
      context("sale-002"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("cancelada");
  });
});
