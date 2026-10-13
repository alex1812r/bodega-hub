/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory", () => {
  it("returns current inventory", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "prod-cable" })]));
  });

  it("filters low stock inventory", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory?lowStock=true", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.items.every(
        (product: { currentStock: number; minStock: number }) =>
          product.currentStock <= product.minStock,
      ),
    ).toBe(true);
  });

  async function getInventory(query: string, role: string) {
    const response = await GET(
      new Request(`http://localhost/api/inventory${query}`, {
        headers: { "x-demo-role": role },
      }),
    );

    return { body: await response.json(), status: response.status };
  }

  it("cada producto trae las cifras de la vista única de stock", async () => {
    const { body, status } = await getInventory("?productId=prod-cable", "almacen");

    expect(status).toBe(200);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]).toEqual(
      expect.objectContaining({
        category: expect.objectContaining({ id: "cat-electric" }),
        entries30d: expect.any(Number),
        exits30d: expect.any(Number),
        id: "prod-cable",
        lastMovementAt: expect.any(String),
        lastMovementType: expect.any(String),
        stockStatus: "low",
      }),
    );
  });

  it("filtra por estado de stock en el servidor", async () => {
    const { body, status } = await getInventory("?stockStatus=out&limit=100", "almacen");

    expect(status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(
      body.data.items.every((product: { stockStatus: string }) => product.stockStatus === "out"),
    ).toBe(true);
    expect(body.data.total).toBe(body.data.items.length);
  });

  it("skip más allá del total responde 200 con lista vacía y el total real", async () => {
    const all = await getInventory("?limit=100", "almacen");
    const beyond = await getInventory("?skip=5000&limit=10", "almacen");

    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual({ items: [], limit: 10, skip: 5000, total: all.body.data.total });
    expect(all.body.data.total).toBeGreaterThan(0);
  });

  it("parámetros de paginación o numéricos inválidos no dan 500", async () => {
    const { body, status } = await getInventory(
      "?skip=abc&limit=xyz&minPriceRef=caro&maxPriceRef=NaN&stockStatus=nada",
      "almacen",
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ limit: 10, skip: 0 });
  });

  it("admin recibe reconciliationDiff en cada producto", async () => {
    const { body, status } = await getInventory("?limit=100", "admin");

    expect(status).toBe(200);
    expect(
      body.data.items.every((product: object) => "reconciliationDiff" in product),
    ).toBe(true);
  });

  it("un rol que no es admin (almacen) no recibe reconciliationDiff", async () => {
    const { body, status } = await getInventory("?limit=100", "almacen");

    expect(status).toBe(200);
    expect(body.data.items.length).toBeGreaterThan(0);
    expect(
      body.data.items.some((product: object) => "reconciliationDiff" in product),
    ).toBe(false);
  });

  it.each(["vendedor", "contador", "superadmin"])(
    "rol %s, sin permiso de inventario, responde 403",
    async (role) => {
      const { status } = await getInventory("", role);

      expect(status).toBe(403);
    },
  );
});
