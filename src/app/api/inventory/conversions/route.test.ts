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
import { mockProducts } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { POST } from "./route";

describe("/api/inventory/conversions", () => {
  it("converts pack stock into unit stock", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({
          packProductId: "prod-cigar-pack",
          packQuantity: 1,
          reason: "Abrir caja para venta suelta",
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
    expect(body.data.unitsPerPack).toBe(10);
    expect(body.data.unitQuantity).toBe(10);
    expect(body.data.packMovement.type).toBe("conversion_salida");
    expect(body.data.unitMovement.type).toBe("conversion_entrada");
    expect(body.data.packMovement.conversionId).toBe(body.data.conversionId);
    expect(body.data.unitMovement.conversionId).toBe(body.data.conversionId);
  });

  it("rejects zero pack quantity", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({
          packProductId: "prod-cigar-pack",
          packQuantity: 0,
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

  it("rejects products without pack conversion", async () => {
    const response = await POST(
      new Request("http://localhost/api/inventory/conversions", {
        body: JSON.stringify({
          packProductId: "prod-cable",
          packQuantity: 1,
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

  describe("motivo con caracteres de control (INV-L3 · M4)", () => {
    function post(reason: string) {
      return POST(
        new Request("http://localhost/api/inventory/conversions", {
          body: JSON.stringify({ packProductId: "prod-cigar-pack", packQuantity: 1, reason }),
          headers: { "content-type": "application/json", "x-demo-role": "almacen" },
          method: "POST",
        }),
      );
    }

    function packStock() {
      return mockProducts.find((item) => item.id === "prod-cigar-pack")?.currentStock;
    }

    it.each([
      ["NUL", "antes\u0000despues"],
      ["campana (C0)", "antes\u0007despues"],
      ["DEL", "antes\u007fdespues"],
      ["C1", "antes\u0085despues"],
    ])("rechaza con 400 en español un motivo con %s, sin abrir el empaque", async (_name, reason) => {
      const before = packStock();
      const response = await post(reason);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toMatchObject({
        code: "BAD_REQUEST",
        message: "El motivo contiene caracteres no permitidos.",
      });
      expect(packStock()).toBe(before);
    });

    it("acepta salto de línea y tabulación, y guarda el motivo sin los espacios de los extremos", async () => {
      const response = await post("  Abrir caja\nPasillo 3\tñ  ");
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.data.packMovement.reason).toBe("Abrir caja\nPasillo 3\tñ");
    });
  });

  describe("ids con caracteres de control o desmedidos (INV-L4)", () => {
    const UUID = "aca3dfe9-8630-44d0-acd9-c44288ca9f71";
    const INVALID_ID_ERROR = { code: "BAD_REQUEST", message: "Los datos enviados no son válidos." };

    function post(body: Record<string, unknown>) {
      return POST(
        new Request("http://localhost/api/inventory/conversions", {
          body: JSON.stringify({ packQuantity: 1, ...body }),
          headers: { "content-type": "application/json", "x-demo-role": "almacen" },
          method: "POST",
        }),
      );
    }

    function packStock() {
      return mockProducts.find((item) => item.id === "prod-cigar-pack")?.currentStock;
    }

    it.each([
      ["empaque: id del mock + NUL", { packProductId: "prod-cigar-pack\u0000" }],
      ["empaque: uuid + NUL", { packProductId: `${UUID}\u0000` }],
      ["empaque: uuid + DEL", { packProductId: `${UUID}\u007f` }],
      ["empaque: más de 200 caracteres", { packProductId: "a".repeat(201) }],
      [
        "componente del reparto: uuid + NUL",
        {
          components: [{ unitProductId: `${UUID}\u0000`, units: 10 }],
          packProductId: "prod-cigar-pack",
        },
      ],
    ])("mock: rechaza con 400 en español %s, sin abrir el empaque", async (_name, body) => {
      const before = packStock();
      const response = await post(body);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toEqual(INVALID_ID_ERROR);
      expect(packStock()).toBe(before);
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

      it.each([
        ["el empaque", { packProductId: `${UUID}\u0000` }],
        [
          "un componente del reparto",
          { components: [{ unitProductId: `${UUID}\u0000`, units: 6 }], packProductId: UUID },
        ],
      ])(
        "uuid válido + NUL en %s → 400 en español, sin consultar la tienda ni llamar a la RPC",
        async (_name, body) => {
          const response = await post(body);

          expect(response.status).toBe(400);
          expect((await response.json()).error).toEqual(INVALID_ID_ERROR);
          expect(adminFrom).not.toHaveBeenCalled();
          expect(rpc).not.toHaveBeenCalled();
        },
      );
    });
  });
});
