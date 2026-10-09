/**
 * @jest-environment node
 */

import { PATCH } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

describe("/api/purchases/[id]/receive", () => {
  it("receives a pedido purchase in mock mode", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/purchases/purchase-002/receive", {
        headers: { "x-demo-role": "almacen" },
        method: "PATCH",
      }),
      context("purchase-002"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("recibido");
    expect(body.data.id).toBe("purchase-002");
  });

  // COM-F10: el mensaje iba sin tilde («JSON valido»).
  it("un cuerpo que no es JSON responde 400 con el mensaje en español correcto", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/purchases/purchase-002/receive", {
        body: "{no es json",
        headers: { "content-type": "application/json", "x-demo-role": "almacen" },
        method: "PATCH",
      }),
      context("purchase-002"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("El cuerpo de la solicitud no es un JSON válido.");
  });

  it("rejects receiving a purchase that is not pedido", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/purchases/purchase-001/receive", {
        headers: { "x-demo-role": "almacen" },
        method: "PATCH",
      }),
      context("purchase-001"),
    );

    expect(response.status).toBe(400);
  });
});
