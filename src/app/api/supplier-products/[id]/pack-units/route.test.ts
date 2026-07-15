/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

const demoHeaders = {
  "content-type": "application/json",
  "x-demo-role": "almacen",
};

describe("/api/supplier-products/[id]/pack-units", () => {
  it("lists pack units", async () => {
    const response = await GET(
      new Request("http://localhost/api/supplier-products/supp-prod-cable/pack-units", {
        headers: demoHeaders,
      }),
      context("supp-prod-cable"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.some((item: { label: string }) => item.label === "Bulto")).toBe(true);
  });

  it("creates a pack unit", async () => {
    const response = await POST(
      new Request("http://localhost/api/supplier-products/supp-prod-drill/pack-units", {
        body: JSON.stringify({ isDefault: true, label: "Paquete", unitsPerPack: 6 }),
        headers: demoHeaders,
        method: "POST",
      }),
      context("supp-prod-drill"),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.label).toBe("Paquete");
    expect(body.data.unitsPerPack).toBe(6);
  });
});
