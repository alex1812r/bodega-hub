/**
 * @jest-environment node
 */

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/supplier-products/[id]/deactivate", () => {
  it("blocks vendedor from deactivating supplier products", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-switch/deactivate", {
        headers: {
          "x-demo-role": "vendedor",
        },
        method: "PATCH",
      }),
      context("supp-prod-switch"),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("deactivates a supplier-product relation", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-switch/deactivate", {
        headers: {
          "x-demo-role": "almacen",
        },
        method: "PATCH",
      }),
      context("supp-prod-switch"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isActive).toBe(false);
  });
});
