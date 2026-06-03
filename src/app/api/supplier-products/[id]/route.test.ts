/**
 * @jest-environment node
 */

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/supplier-products/[id]", () => {
  it("updates a supplier-product relation", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-cable", {
        body: JSON.stringify({ lastCostRef: 2.5 }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "PATCH",
      }),
      context("supp-prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.lastCostRef).toBe(2.5);
  });
});
