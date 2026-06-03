/**
 * @jest-environment node
 */

import { GET, PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/sales/[id]", () => {
  it("returns sale details", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales/sale-001", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("sale-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        id: "sale-001",
        items: expect.any(Array),
        payments: expect.any(Array),
      }),
    );
  });

  it("returns not found for missing sale", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales/missing", {
        headers: { "x-demo-role": "vendedor" },
      }),
      context("missing"),
    );

    expect(response.status).toBe(404);
  });

  it("updates sale notes in mock mode", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/sales/sale-001", {
        body: JSON.stringify({ notes: "Entrega programada" }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "PATCH",
      }),
      context("sale-001"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.notes).toBe("Entrega programada");
  });
});
