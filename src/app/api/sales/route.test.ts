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
          clientRequestId: "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
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
          clientRequestId: "1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e",
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

  it("rejects a sale without client request id", async () => {
    const response = await POST(
      new Request("http://localhost/api/sales", {
        body: JSON.stringify({
          customerId: "cont-customer",
          items: [{ productId: "prod-drill", quantity: 1 }],
        }),
        headers: { "content-type": "application/json", "x-demo-role": "vendedor" },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(JSON.stringify(body.error.issues)).toContain("clientRequestId");
  });

  it("answers 409 when a client request id is reused with another cart", async () => {
    const post = (quantity: number) =>
      POST(
        new Request("http://localhost/api/sales", {
          body: JSON.stringify({
            clientRequestId: "2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f",
            customerId: "cont-customer",
            items: [{ productId: "prod-drill", quantity }],
          }),
          headers: { "content-type": "application/json", "x-demo-role": "vendedor" },
          method: "POST",
        }),
      );

    const first = await post(2);
    const reused = await post(3);
    const body = await reused.json();

    expect(first.status).toBe(201);
    expect(reused.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
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
