/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory/stock-card", () => {
  it("returns stock card movements by product", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/stock-card?productId=prod-cable", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.items.every((movement: { productId: string }) => movement.productId === "prod-cable"),
    ).toBe(true);
  });

  function get(queryString: string) {
    return GET(
      new Request(`http://localhost/api/inventory/stock-card?${queryString}`, {
        headers: { "x-demo-role": "almacen" },
      }),
    );
  }

  it("filtra por tipo y rango y ordena del más reciente al más antiguo", async () => {
    const byType = await (await get("productId=prod-cable&type=venta")).json();
    const byRange = await (await get("from=2026-05-17&to=2026-05-18&limit=100")).json();
    const dates = byRange.data.items.map((item: { createdAt: string }) => item.createdAt);

    expect(byType.data.items.map((item: { id: string }) => item.id)).toEqual(["mov-003"]);
    expect(dates.length).toBeGreaterThan(1);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it.each([
    ["type=regalo", "El tipo de movimiento no es válido."],
    ["from=ayer", 'La fecha "from" no es válida. Usa el formato AAAA-MM-DD.'],
    ["from=2026-05-19&to=2026-05-18", "La fecha inicial no puede ser posterior a la final."],
  ])("responde 400 a %s", async (queryString, message) => {
    const response = await get(queryString);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: "BAD_REQUEST", message });
  });

  it("skip más allá del total responde 200 con items vacíos y el total real", async () => {
    const all = await (await get("productId=prod-cable")).json();
    const response = await get("productId=prod-cable&skip=5000");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ items: [], skip: 5000, total: all.data.total });
    expect(body.data.total).toBeGreaterThan(0);
  });

  it("paginación inválida no da 500", async () => {
    expect((await get("limit=abc&skip=-2")).status).toBe(200);
  });
});
