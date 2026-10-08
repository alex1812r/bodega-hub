/**
 * @jest-environment node
 */

import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";

import { POST } from "./route";

describe("/api/inventory/adjustments", () => {
  it("creates a simulated stock adjustment", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: 3,
          reason: "Conteo fisico",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.type).toBe("ajuste_entrada");
  });

  it("validates non-zero quantity", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: 0,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("validates negative stock", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: -99,
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("accepts documented adjustment types", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/adjustments", {
        body: JSON.stringify({
          productId: "prod-cable",
          quantityDelta: 1,
          type: "inventario_inicial",
        }),
        headers: {
          "content-type": "application/json",
          "x-demo-role": "almacen",
        },
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.type).toBe("inventario_inicial");
  });

  describe("motivo con caracteres de control y signo contra tipo (INV-L3)", () => {
    function post(body: Record<string, unknown>) {
      return POST(
        new Request("http://localhost/api/inventory/adjustments", {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", "x-demo-role": "almacen" },
          method: "POST",
        }),
      );
    }

    function snapshot() {
      return {
        movements: mockStockMovements.length,
        stock: mockProducts.find((item) => item.id === "prod-cable")?.currentStock,
      };
    }

    it.each([
      ["NUL", "antes\u0000despues"],
      ["campana (C0)", "antes\u0007despues"],
      ["DEL", "antes\u007fdespues"],
      ["C1", "antes\u0085despues"],
    ])("rechaza con 400 en español un motivo con %s, sin mover stock (M4)", async (_name, reason) => {
      const before = snapshot();
      const response = await post({
        productId: "prod-cable",
        quantityDelta: 1,
        reason,
        type: "ajuste_entrada",
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toMatchObject({
        code: "BAD_REQUEST",
        message: "El motivo contiene caracteres no permitidos.",
      });
      expect(snapshot()).toEqual(before);
    });

    it("acepta salto de línea, retorno de carro y tabulación en el motivo", async () => {
      const response = await post({
        productId: "prod-cable",
        quantityDelta: 1,
        reason: "Conteo físico\r\nPasillo 3\tñ 🙂",
      });

      expect(response.status).toBe(201);
    });

    it.each([
      ["ajuste_salida", 1, "Una salida debe restar unidades."],
      ["ajuste_entrada", -1, "Una entrada debe sumar unidades."],
      ["inventario_inicial", -1, "Una entrada debe sumar unidades."],
    ])(
      "rechaza %s con cantidad %d sin jerga y sin mover stock (B2)",
      async (type, quantityDelta, message) => {
        const before = snapshot();
        const response = await post({ productId: "prod-cable", quantityDelta, type });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toMatchObject({ code: "BAD_REQUEST", message });
        expect(snapshot()).toEqual(before);
      },
    );

    it("sin tipo el signo decide: una cantidad negativa sigue siendo una salida válida", async () => {
      await post({ productId: "prod-cable", quantityDelta: 1 });
      const response = await post({ productId: "prod-cable", quantityDelta: -1 });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.type).toBe("ajuste_salida");
    });
  });
});
