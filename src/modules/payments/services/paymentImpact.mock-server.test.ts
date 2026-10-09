/**
 * @jest-environment node
 */

import { cancelPayment, createPayment } from "@/modules/payments/services/payments.mock-server";
import { mockPayments, mockPurchases, mockSales } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getPaymentImpact, loadPaymentImpactInputs } from "./paymentImpact.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

describe("paymentImpact.mock-server", () => {
  it("cobro de una venta pagada: saldo y estado exactos, dinero inexacto", () => {
    const impact = getPaymentImpact("pay-001", "cancel", DEFAULT_STORE_ID, "admin");

    expect(impact).toMatchObject({
      action: "cancel",
      allowed: true,
      document: {
        contactName: expect.any(String),
        id: "sale-001",
        kind: "sale",
        number: "V-000001",
        paidVes: 7650,
        paidVesAfter: 0,
        pendingVes: 0,
        pendingVesAfter: 7650,
        status: "pagada",
        statusAfter: "pendiente_pago",
      },
      effects: [],
      payment: {
        amountVes: 7650,
        direction: "entrada",
        method: "punto_venta",
        status: "activo",
        statusAfter: "anulado",
      },
    });
    expect(impact.inexact?.reason).toContain("modo demo");
  });

  it("predice lo que el mock aplica al anular de verdad (saldo y estado del documento)", () => {
    const created = createPayment(
      { amount: 1000, method: "efectivo_ves", saleId: "sale-002" },
      DEFAULT_STORE_ID,
    );
    const impact = getPaymentImpact(created.id, "cancel", DEFAULT_STORE_ID, "contador");

    cancelPayment(created.id, DEFAULT_STORE_ID);

    const sale = mockSales.find((item) => item.id === "sale-002");

    expect(impact.allowed).toBe(true);
    expect(sale?.paidVes).toBe(impact.document.paidVesAfter);
    expect(sale?.status).toBe(impact.document.statusAfter);
    expect(getPaymentImpact(created.id, "cancel", DEFAULT_STORE_ID, "contador")).toMatchObject({
      allowed: false,
      reason: "El pago ya fue anulado",
      reasonCode: "CONFLICT",
    });
  });

  it("pago a proveedor recién registrado: baja lo pagado en Bs y REF sin cambiar el estado", () => {
    const created = createPayment(
      { amount: 5100, method: "transferencia", purchaseId: "purchase-002" },
      DEFAULT_STORE_ID,
    );
    const impact = getPaymentImpact(created.id, "cancel", DEFAULT_STORE_ID, "admin");

    expect(impact).toMatchObject({
      allowed: true,
      document: {
        kind: "purchase",
        paidRef: 10,
        paidRefAfter: 0,
        paidVes: 5100,
        paidVesAfter: 0,
        pendingRefAfter: 52.4,
        pendingVesAfter: 26724,
        status: "pedido",
        statusAfter: "pedido",
      },
      payment: { direction: "salida" },
    });

    cancelPayment(created.id, DEFAULT_STORE_ID);

    const purchase = mockPurchases.find((item) => item.id === "purchase-002");
    expect(purchase?.paidVes).toBe(impact.document.paidVesAfter);
    expect(purchase?.paidRef).toBe(impact.document.paidRefAfter);
  });

  it("compra devuelta: mismo rechazo que la RPC", () => {
    expect(getPaymentImpact("pay-006", "cancel", DEFAULT_STORE_ID, "admin")).toMatchObject({
      allowed: false,
      reason: "No se puede anular un pago de una compra cancelada o devuelta",
      reasonCode: "CONFLICT",
    });
  });

  it("rol sin acceso a pagos de compras: 403; rol que la RPC no deja anular: allowed=false", () => {
    expect(() => getPaymentImpact("pay-003", "cancel", DEFAULT_STORE_ID, "vendedor")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
    );
    expect(getPaymentImpact("pay-001", "cancel", DEFAULT_STORE_ID, "vendedor")).toMatchObject({
      allowed: false,
      reason: "No autorizado para anular pagos",
      reasonCode: "FORBIDDEN",
    });
  });

  it("404 si el pago no existe o es de otra tienda", () => {
    for (const [id, storeId] of [
      ["missing", DEFAULT_STORE_ID],
      ["pay-001", OTHER_STORE_ID],
    ]) {
      expect(() => loadPaymentImpactInputs(id, "cancel", storeId, "admin")).toThrow(
        expect.objectContaining({ code: "NOT_FOUND", message: "Pago no encontrado.", status: 404 }),
      );
    }
  });

  it("no escribe: el mock queda igual tras calcular el impact", () => {
    const before = JSON.stringify([mockPayments, mockSales, mockPurchases]);

    getPaymentImpact("pay-001", "cancel", DEFAULT_STORE_ID, "admin");
    getPaymentImpact("pay-003", "cancel", DEFAULT_STORE_ID, "admin");

    expect(JSON.stringify([mockPayments, mockSales, mockPurchases])).toBe(before);
  });
});
