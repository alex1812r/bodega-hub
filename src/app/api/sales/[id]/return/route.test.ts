/**
 * @jest-environment node
 */

import { POST } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/sales/[id]/return", () => {
  it("returns a sale in mock mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/sales/sale-002/return", {
        headers: { "x-demo-role": "vendedor" },
        method: "POST",
      }),
      context("sale-002"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sale.status).toBe("devuelta");
    expect(body.data.stockMovements[0].type).toBe("devolucion_cliente");
  });
});
