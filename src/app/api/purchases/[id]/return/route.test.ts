/**
 * @jest-environment node
 */

import { POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/purchases/[id]/return", () => {
  it("returns a purchase in mock mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/purchases/purchase-001/return", {
        headers: { "x-demo-role": "almacen" },
        method: "POST",
      }),
      context("purchase-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.purchase.status).toBe("devuelto");
    expect(body.data.stockMovements[0].type).toBe("devolucion_proveedor");
  });
});
