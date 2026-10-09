/**
 * @jest-environment node
 */

import { mockPayments, mockProducts, mockSales, mockStockMovements } from "@/shared/mocks/erp-data";

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

function get(id: string, query: string, headers: Record<string, string> = { "x-demo-role": "vendedor" }) {
  return GET(new Request(`http://localhost/api/sales/${id}/impact${query}`, { headers }), context(id));
}

describe("/api/sales/[id]/impact", () => {
  it("devuelve el efecto de devolver la venta, sin caché", async () => {
    const response = await get("sale-001", "?action=return");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toEqual(
      expect.objectContaining({
        action: "return",
        allowed: true,
        document: {
          contactName: expect.any(String),
          id: "sale-001",
          number: "V-000001",
          status: "pagada",
          statusAfter: "devuelta",
        },
        paidVes: 7650,
        paidVesAfter: 0,
        reason: null,
        reasonCode: null,
      }),
    );
    expect(body.data.stock).toEqual([
      expect.objectContaining({
        productId: "prod-drill",
        productName: "Taladro percutor",
        quantityDelta: 1,
        stockAfter: 19,
        stockBefore: 18,
      }),
    ]);
    expect(body.data.payments).toEqual([
      expect.objectContaining({
        amountVes: 7650,
        inexact: { reason: expect.stringContaining("modo demo") },
        method: "punto_venta",
        outcome: "reverted",
        status: "activo",
        statusAfter: "anulado",
      }),
    ]);
    expect(body.data.refund).toEqual({
      byMethod: [{ amount: 7650, amountVes: 7650, currency: "VES", method: "punto_venta" }],
      changeToRecover: [],
      netVes: 7650,
    });
  });

  it("devolver una venta cuyos pagos superan lo cobrado: allowed=false como la RPC", async () => {
    const response = await get("sale-002", "?action=return");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        allowed: false,
        paidVesAfter: 3000,
        reason: "El monto del pago excede lo registrado en la venta",
        reasonCode: "BAD_REQUEST",
        refund: null,
      }),
    );
  });

  it("anular con pagos activos: allowed=false con el motivo de la RPC", async () => {
    const response = await get("sale-002", "?action=cancel");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({ action: "cancel", allowed: false, reasonCode: "CONFLICT", refund: null }),
    );
    expect(body.data.document.statusAfter).toBe("pendiente_pago");
  });

  it.each(["", "?action=", "?action=delete", "?action=cancel&action=return", "?accion=cancel"])(
    "400 con action ausente o inválida (%s)",
    async (query) => {
      const response = await get("sale-002", query);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
    },
  );

  it("403 para un rol que no puede anular ni devolver ventas", async () => {
    for (const role of ["admin", "almacen", "contador"]) {
      const response = await get("sale-002", "?action=cancel", { "x-demo-role": role });

      expect(response.status).toBe(403);
    }
  });

  it("404 si la venta no existe", async () => {
    const response = await get("missing", "?action=cancel");

    expect(response.status).toBe(404);
  });

  it("404 si la venta es de otra tienda", async () => {
    const response = await get("sale-002", "?action=return", {
      "x-demo-role": "vendedor",
      "x-demo-store-id": "00000000-0000-4000-8000-000000000002",
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("no tiene efectos: el mock queda igual tras pedir el impact", async () => {
    const before = JSON.stringify([mockSales, mockPayments, mockProducts, mockStockMovements]);

    await get("sale-002", "?action=return");
    await get("sale-001", "?action=cancel");

    expect(JSON.stringify([mockSales, mockPayments, mockProducts, mockStockMovements])).toBe(before);
  });
});
