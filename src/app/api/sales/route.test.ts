/**
 * @jest-environment node
 */

import { GET, POST } from "./route";

describe("/api/sales", () => {
  it("returns sales for seller role", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.any(Array));
  });

  it("creates a simulated sale", async () => {
    const response = await POST(
      new Request("http://localhost/api/sales", {
        body: JSON.stringify({
          customerId: "cont-customer",
          items: [{ productId: "prod-drill", quantity: 1 }],
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.status).toBe("pendiente_pago");
    expect(body.data.totalRef).toBeGreaterThan(0);
  });

  it("creates a sale with its payments in one request and replays the same client request id", async () => {
    const clientRequestId = "6f1a2b3c-4d5e-4f60-8a71-92b3c4d5e6f7";
    // El total lo fija el catalogo mock: se cotiza primero sin cobros para pagar exacto.
    const quote = await POST(
      new Request("http://localhost/api/sales", {
        body: JSON.stringify({
          customerId: "cont-customer",
          items: [{ productId: "prod-drill", quantity: 1 }],
          refRateVes: 510,
        }),
        headers: { "content-type": "application/json", "x-demo-role": "vendedor" },
        method: "POST",
      }),
    );
    const totalRef = (await quote.json()).data.totalRef as number;

    const request = () =>
      new Request("http://localhost/api/sales", {
        body: JSON.stringify({
          clientRequestId,
          customerId: "cont-customer",
          items: [{ productId: "prod-drill", quantity: 1 }],
          payments: [{ amount: totalRef, currency: "USD", method: "efectivo_usd" }],
          refRateVes: 510,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      });

    const first = await POST(request());
    const firstBody = await first.json();

    expect(first.status).toBe(201);
    expect(firstBody.data.status).toBe("pagada");
    expect(firstBody.data.paidVes).toBe(firstBody.data.totalVes);

    // Misma clave: la venta ya existe y se devuelve tal cual, sin crear otra.
    const replay = await POST(request());
    const replayBody = await replay.json();

    expect(replay.status).toBe(201);
    expect(replayBody.data.id).toBe(firstBody.data.id);
    expect(replayBody.data.invoiceNumber).toBe(firstBody.data.invoiceNumber);
  });

  it("rejects a sale whose payment line breaks the method rules before touching the store", async () => {
    const response = await POST(
      new Request("http://localhost/api/sales", {
        body: JSON.stringify({
          customerId: "cont-customer",
          items: [{ productId: "prod-drill", quantity: 1 }],
          // Pago movil sin banco, telefono ni referencia de 4 digitos.
          payments: [{ amount: 100, method: "pago_movil" }],
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "vendedor",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(body.error.issues)).toContain("payments");
  });

  it("filters sales by customer and date range", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales?customerId=cont-customer&from=2026-05-18&to=2026-05-18", {
        headers: { "x-demo-role": "vendedor" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].customerId).toBe("cont-customer");
  });

  it("blocks warehouse from listing sales", async () => {
    const response = await GET(
      new Request("http://localhost/api/sales", {
        headers: { "x-demo-role": "almacen" },
      }),
    );

    expect(response.status).toBe(403);
  });
});
