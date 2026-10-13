/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client", () => ({
  createRouteSupabaseClient: jest.fn(),
}));
jest.mock("../../../../lib/supabase/admin-client", () => ({
  createAdminSupabaseClient: jest.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/supabase/admin-client";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { mockProducts, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

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

  describe("id de producto con caracteres de control o desmedido (INV-L4)", () => {
    const UUID = "950df0d2-f0c3-4cee-b935-86d0c8fd47bb";
    const INVALID_ID_ERROR = { code: "BAD_REQUEST", message: "Los datos enviados no son válidos." };

    function post(productId: string) {
      return POST(
        new Request("http://localhost/api/inventory/adjustments", {
          body: JSON.stringify({ productId, quantityDelta: 1, type: "ajuste_entrada" }),
          headers: { "content-type": "application/json", "x-demo-role": "almacen" },
          method: "POST",
        }),
      );
    }

    it.each([
      ["id del mock + NUL", "prod-cable\u0000"],
      ["uuid + NUL", `${UUID}\u0000`],
      ["NUL + uuid", `\u0000${UUID}`],
      ["uuid + campana (C0)", `${UUID}\u0007`],
      ["más de 200 caracteres", "a".repeat(201)],
    ])("mock: rechaza con 400 en español %s, sin mover stock", async (_name, productId) => {
      const movements = mockStockMovements.length;
      const response = await post(productId);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(INVALID_ID_ERROR);
      expect(mockStockMovements).toHaveLength(movements);
    });

    describe("rama Supabase: el id no llega a la base", () => {
      const originalDataSource = process.env.API_DATA_SOURCE;
      const adminFrom = jest.fn();
      const rpc = jest.fn();

      beforeEach(() => {
        process.env.API_DATA_SOURCE = "supabase";
        adminFrom.mockReset();
        rpc.mockReset();
        // Lo que hizo la base real: la comprobación de tienda encontró el producto
        // (el NUL corta el texto del filtro) y la RPC rechazó el NUL del cuerpo JSON.
        adminFrom.mockImplementation(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest
                .fn()
                .mockResolvedValue({ data: { store_id: DEFAULT_STORE_ID }, error: null }),
            })),
          })),
        }));
        rpc.mockResolvedValue({
          data: null,
          error: { code: "22P05", message: "unsupported Unicode escape sequence" },
        });
        (createAdminSupabaseClient as jest.Mock).mockReturnValue({ from: adminFrom });
        (createRouteSupabaseClient as jest.Mock).mockResolvedValue({ from: jest.fn(), rpc });
      });

      afterEach(() => {
        process.env.API_DATA_SOURCE = originalDataSource;
      });

      it("uuid válido + NUL → 400 en español, sin consultar la tienda ni llamar a la RPC", async () => {
        const response = await post(`${UUID}\u0000`);

        expect(response.status).toBe(400);
        expect((await response.json()).error).toEqual(INVALID_ID_ERROR);
        expect(adminFrom).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
      });
    });
  });
});
