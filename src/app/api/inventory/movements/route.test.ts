/**
 * @jest-environment node
 */

import { GET } from "./route";

describe("/api/inventory/movements", () => {
  it("returns stock movements", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/movements", {
        headers: { "x-demo-role": "almacen" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ type: "compra" })]));
  });

  it("filters movements by product", async () => {
    const response = await GET(
      new Request("http://localhost/api/inventory/movements?productId=prod-cable", {
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
      new Request(`http://localhost/api/inventory/movements?${queryString}`, {
        headers: { "x-demo-role": "almacen" },
      }),
    );
  }

  it("devuelve el documento resuelto de cada movimiento", async () => {
    const body = await (await get("limit=100")).json();
    const byId = new Map<string, { documentKind: string | null; documentNumber: string | null }>(
      body.data.items.map((movement: { id: string }) => [movement.id, movement]),
    );

    expect(byId.get("mov-002")).toMatchObject({ documentKind: "venta", documentNumber: "V-000001" });
    expect(byId.get("mov-001")).toMatchObject({ documentKind: "compra" });
    expect(byId.get("mov-001")?.documentNumber).toEqual(expect.any(String));
    // Sin documento: la UI lo muestra como "Ajuste manual".
    expect(byId.get("mov-005")).toMatchObject({ documentKind: null, documentNumber: null });
  });

  it("filtra por tipo, rango, documento y tipo de documento", async () => {
    const byType = await (await get("type=compra&limit=100")).json();
    const byRange = await (await get("from=2026-05-18&to=2026-05-18&limit=100")).json();
    const byDocument = await (await get("document=v-000001")).json();
    const withoutDocument = await (await get("documentKind=sin_documento&limit=100")).json();

    expect(byType.data.items.length).toBeGreaterThan(0);
    expect(byType.data.items.every((item: { type: string }) => item.type === "compra")).toBe(true);
    expect(byRange.data.items.map((item: { id: string }) => item.id)).toEqual([
      "mov-003",
      "mov-002",
      "mov-008",
    ]);
    expect(byDocument.data.items.map((item: { id: string }) => item.id)).toEqual(["mov-002"]);
    expect(withoutDocument.data.items.length).toBeGreaterThan(0);
    expect(
      withoutDocument.data.items.every(
        (item: { documentKind: string | null }) => item.documentKind === null,
      ),
    ).toBe(true);
  });

  it("ordena del movimiento más reciente al más antiguo", async () => {
    const body = await (await get("limit=100")).json();
    const dates = body.data.items.map((item: { createdAt: string }) => item.createdAt);

    expect(dates).toEqual([...dates].sort().reverse());
  });

  it.each([
    ["type=regalo", "El tipo de movimiento no es válido."],
    ["from=18-05-2026", 'La fecha "from" no es válida. Usa el formato AAAA-MM-DD.'],
    ["to=2026-02-30", 'La fecha "to" no es válida. Usa el formato AAAA-MM-DD.'],
    ["from=2026-05-19&to=2026-05-18", "La fecha inicial no puede ser posterior a la final."],
    ["documentKind=factura", "El tipo de documento no es válido."],
  ])("responde 400 a %s", async (queryString, message) => {
    const response = await get(queryString);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({ code: "BAD_REQUEST", message });
  });

  it("skip más allá del total responde 200 con items vacíos y el total real", async () => {
    const all = await (await get("type=compra")).json();
    const response = await get("type=compra&skip=5000");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ items: [], skip: 5000, total: all.data.total });
    expect(body.data.total).toBeGreaterThan(0);
  });

  it.each(["limit=abc&skip=xyz", "limit=-1&skip=-1", "skip=99999999999999999999"])(
    "paginación inválida (%s) no da 500",
    async (queryString) => {
      expect((await get(queryString)).status).toBe(200);
    },
  );

  it.each(["%", "_", "a,b", "(x)", "sale_id.is.null),or(id.neq.x"])(
    "document=%s no rompe la consulta",
    async (term) => {
      const response = await get(`document=${encodeURIComponent(term)}`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.items).toEqual([]);
    },
  );
});
