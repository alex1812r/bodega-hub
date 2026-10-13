/**
 * @jest-environment node
 */

import { GET } from "./route";

function get(queryString: string, role = "almacen") {
  return GET(
    new Request(`http://localhost/api/inventory/kardex${queryString}`, {
      headers: { "x-demo-role": role },
    }),
  );
}

describe("/api/inventory/kardex", () => {
  it("devuelve el kardex del producto de la tienda", async () => {
    const response = await get("?productId=prod-cable");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.product).toMatchObject({
      currentStock: expect.any(Number),
      id: "prod-cable",
      minStock: expect.any(Number),
      name: expect.any(String),
      sku: expect.any(String),
    });
    expect(body.data.series).toHaveLength(30);
    expect(body.data.series[29]).toMatchObject({
      balance: body.data.product.currentStock,
      entries: expect.any(Number),
      exits: expect.any(Number),
    });
    expect(body.data).toMatchObject({
      entries30d: expect.any(Number),
      exits30d: expect.any(Number),
      openingBalance: expect.any(Number),
      truncated: false,
    });
    expect(body.data.lastMovements.length).toBeGreaterThan(0);
    expect(body.data.lastMovements.length).toBeLessThanOrEqual(10);
    expect(body.data.lastMovements[0]).toEqual(
      expect.objectContaining({
        createdAt: expect.any(String),
        quantityDelta: expect.any(Number),
        stockAfter: expect.any(Number),
        type: expect.any(String),
      }),
    );
    expect(body.data.lastMovements[0]).toHaveProperty("documentKind");
    expect(body.data.lastMovements[0]).toHaveProperty("documentNumber");
    expect(body.data.lastMovements[0]).toHaveProperty("reason");
  });

  it.each(["admin", "almacen"])("el rol %s puede consultarlo", async (role) => {
    expect((await get("?productId=prod-cable", role)).status).toBe(200);
  });

  it.each(["vendedor", "contador"])("el rol %s (sin inventory.view) recibe 403", async (role) => {
    const response = await get("?productId=prod-cable", role);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.data).toBeUndefined();
  });

  it.each(["", "?productId=", `?productId=${"a".repeat(201)}`])(
    "sin un productId válido (%s) responde 400",
    async (queryString) => {
      const response = await get(queryString);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
    },
  );

  it.each(["prod-no-existe", "prod-sur-arroz"])(
    "un producto inexistente o de otra tienda (%s) responde 404",
    async (productId) => {
      const response = await get(`?productId=${productId}`);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    },
  );
});
