/**
 * @jest-environment node
 */

import { DELETE, PATCH } from "./route";

const context = (id: string, packId: string) => ({
  params: Promise.resolve({ id, packId }),
});

const demoHeaders = {
  "content-type": "application/json",
  "x-demo-role": "almacen",
};

describe("/api/supplier-products/[id]/pack-units/[packId]", () => {
  it("updates a pack unit", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/pack-units/sp-pack-cable-bulto", {
        body: JSON.stringify({ isDefault: true }),
        headers: demoHeaders,
        method: "PATCH",
      }),
      context("supp-prod-cable", "sp-pack-cable-bulto"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isDefault).toBe(true);
  });

  it("deactivates a pack unit", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/pack-units/sp-pack-cable-bulto", {
        headers: demoHeaders,
        method: "DELETE",
      }),
      context("supp-prod-cable", "sp-pack-cable-bulto"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isActive).toBe(false);
  });
});
