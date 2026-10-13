/**
 * @jest-environment node
 */

import { mockPayments, mockPurchases, mockSales } from "@/shared/mocks/erp-data";

import { GET } from "./route";

const context = (id: string) => ({
  params: Promise.resolve({ id }),
});

function get(id: string, query: string, headers: Record<string, string> = { "x-demo-role": "admin" }) {
  return GET(new Request(`http://localhost/api/payments/${id}/impact${query}`, { headers }), context(id));
}

describe("/api/payments/[id]/impact", () => {
  it("devuelve el efecto de anular un cobro de venta, sin caché", async () => {
    const response = await get("pay-001", "?action=cancel");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toEqual({
      action: "cancel",
      allowed: true,
      description: "Se anula el cobro.",
      document: {
        contactName: expect.any(String),
        id: "sale-001",
        kind: "sale",
        number: "V-000001",
        paidRef: null,
        paidRefAfter: null,
        paidVes: 7650,
        paidVesAfter: 0,
        pendingRef: null,
        pendingRefAfter: null,
        pendingVes: 0,
        pendingVesAfter: 7650,
        status: "pagada",
        statusAfter: "pendiente_pago",
        totalRef: null,
        totalVes: 7650,
      },
      effects: [],
      inexact: { reason: expect.stringContaining("modo demo") },
      payment: {
        amount: 7650,
        amountRef: 15,
        amountVes: 7650,
        changeMethod: null,
        changeRef: 0,
        changeVes: 0,
        currency: "VES",
        direction: "entrada",
        id: "pay-001",
        method: "punto_venta",
        netVes: 7650,
        status: "activo",
        statusAfter: "anulado",
      },
      reason: null,
      reasonCode: null,
    });
  });

  it("pago de una compra devuelta: allowed=false con el motivo de la RPC", async () => {
    const response = await get("pay-006", "?action=cancel", { "x-demo-role": "contador" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        allowed: false,
        effects: [],
        reason: "No se puede anular un pago de una compra cancelada o devuelta",
        reasonCode: "CONFLICT",
      }),
    );
    expect(body.data.document).toEqual(
      expect.objectContaining({ kind: "purchase", paidVes: 2500, paidVesAfter: 2500, statusAfter: "devuelto" }),
    );
    expect(body.data.payment.statusAfter).toBe("activo");
  });

  it.each(["", "?action=", "?action=return", "?action=cancel&action=cancel", "?accion=cancel"])(
    "400 con action ausente o inválida (%s)",
    async (query) => {
      const response = await get("pay-001", query);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("BAD_REQUEST");
    },
  );

  it("403 para un rol que no puede anular pagos", async () => {
    for (const role of ["vendedor", "almacen"]) {
      const response = await get("pay-001", "?action=cancel", { "x-demo-role": role });

      expect(response.status).toBe(403);
    }
  });

  it("404 si el pago no existe", async () => {
    const response = await get("missing", "?action=cancel");

    expect(response.status).toBe(404);
  });

  it("404 si el pago es de otra tienda", async () => {
    const response = await get("pay-001", "?action=cancel", {
      "x-demo-role": "admin",
      "x-demo-store-id": "00000000-0000-4000-8000-000000000002",
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("no tiene efectos: el mock queda igual tras pedir el impact", async () => {
    const before = JSON.stringify([mockPayments, mockSales, mockPurchases]);

    await get("pay-001", "?action=cancel");
    await get("pay-003", "?action=cancel");
    await get("pay-006", "?action=cancel");

    expect(JSON.stringify([mockPayments, mockSales, mockPurchases])).toBe(before);
  });
});
