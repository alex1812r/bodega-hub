/**
 * @jest-environment node
 */

import { mockProducts } from "@/shared/mocks/erp-data";

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
});
