/**
 * @jest-environment node
 */
/**
 * STK-517 · R4: `saleId` / `purchaseId` opcionales (uuid) para ligar una
 * devolucion por ajuste a su documento; 400 si acompanan a otro tipo.
 */

jest.mock("../../../../modules/inventory/services/inventory.mock-server", () => ({
  ...jest.requireActual("../../../../modules/inventory/services/inventory.mock-server"),
  createStockAdjustment: jest.fn(),
}));

import { createStockAdjustment } from "@/modules/inventory/services/inventory.mock-server";

import { POST } from "./route";

const SALE_ID = "44444444-4444-4444-8444-444444444444";
const PURCHASE_ID = "55555555-5555-4555-8555-555555555555";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/inventory/adjustments", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-demo-role": "almacen" },
      method: "POST",
    }),
  );
}

describe("/api/inventory/adjustments · devolucion ligada a su documento (R4)", () => {
  beforeEach(() => {
    (createStockAdjustment as jest.Mock).mockReset();
    (createStockAdjustment as jest.Mock).mockReturnValue({ id: "mov-1" });
  });

  it("pasa saleId al servicio en una devolucion de cliente", async () => {
    const response = await post({
      productId: "prod-drill",
      quantityDelta: 1,
      saleId: SALE_ID,
      type: "devolucion_cliente",
    });

    expect(response.status).toBe(201);
    expect((createStockAdjustment as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      saleId: SALE_ID,
      type: "devolucion_cliente",
    });
  });

  it("pasa purchaseId al servicio en una devolucion a proveedor", async () => {
    const response = await post({
      productId: "prod-cable",
      purchaseId: PURCHASE_ID,
      quantityDelta: -1,
      type: "devolucion_proveedor",
    });

    expect(response.status).toBe(201);
    expect((createStockAdjustment as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      purchaseId: PURCHASE_ID,
      type: "devolucion_proveedor",
    });
  });

  it.each([
    [
      "devolucion_cliente sin saleId",
      { quantityDelta: 1, type: "devolucion_cliente" },
      /debe indicar la venta/i,
    ],
    [
      "devolucion_proveedor sin purchaseId",
      { quantityDelta: -1, type: "devolucion_proveedor" },
      /debe indicar la compra/i,
    ],
  ])("responde 400 con %s, con mensaje claro, y no llama al servicio", async (_caso, extra, message) => {
    const response = await post({ productId: "prod-cable", ...extra });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(payload.error.message).toMatch(message);
    expect(createStockAdjustment).not.toHaveBeenCalled();
  });

  it.each([
    ["saleId que no es uuid", { saleId: "sale-001", type: "devolucion_cliente" }],
    ["purchaseId que no es uuid", { purchaseId: "purchase-001", type: "devolucion_proveedor" }],
    ["saleId con ajuste_entrada", { saleId: SALE_ID, type: "ajuste_entrada" }],
    ["saleId sin tipo", { saleId: SALE_ID }],
    ["saleId con devolucion_proveedor", { saleId: SALE_ID, type: "devolucion_proveedor" }],
    ["purchaseId con devolucion_cliente", { purchaseId: PURCHASE_ID, type: "devolucion_cliente" }],
    ["purchaseId sin tipo", { purchaseId: PURCHASE_ID }],
  ])("responde 400 con %s y no llama al servicio", async (_caso, extra) => {
    const response = await post({ productId: "prod-cable", quantityDelta: 1, ...extra });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("BAD_REQUEST");
    expect(createStockAdjustment).not.toHaveBeenCalled();
  });
});
