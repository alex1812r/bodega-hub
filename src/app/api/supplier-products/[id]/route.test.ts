/**
 * @jest-environment node
 */

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/supplier-products/[id]", () => {
  it("updates supplier-product metadata without changing price directly", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-cable", {
        body: JSON.stringify({ notes: "Actualizado", supplierSku: "SUP-CAB-12-V2" }),
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
    expect(body.data.supplierSku).toBe("sup-cab-12-v2");
    expect(body.data.notes).toBe("Actualizado");
  });
});
