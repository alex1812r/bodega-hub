/**
 * @jest-environment node
 */

import { mockPayments, mockProducts, mockSales, mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { getSaleImpact, loadSaleImpactInputs } from "./saleImpact.mock-server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";

describe("saleImpact.mock-server", () => {
  it("devolver una venta pagada: repone stock y declara inexactos los asientos", () => {
    const impact = getSaleImpact("sale-001", "return", DEFAULT_STORE_ID);

    expect(impact).toMatchObject({
      action: "return",
      allowed: true,
      document: { number: "V-000001", status: "pagada", statusAfter: "devuelta" },
      paidVes: 7650,
      paidVesAfter: 0,
    });
    expect(impact.stock).toEqual([
      expect.objectContaining({ productId: "prod-drill", quantityDelta: 1, stockAfter: 19, stockBefore: 18 }),
    ]);
    expect(impact.payments.map((line) => [line.paymentId, line.outcome])).toEqual([
      ["pay-001", "reverted"],
    ]);
    expect(impact.payments.every((line) => line.inexact !== null)).toBe(true);
    expect(impact.inexact?.reason).toContain("modo demo");
  });

  it("devolver con pagos que superan lo cobrado: rechazo de cancel_payment_apply", () => {
    // sale-002 tiene Bs 3000 cobrados y dos pagos activos por Bs 5000.
    const impact = getSaleImpact("sale-002", "return", DEFAULT_STORE_ID);

    expect(impact).toMatchObject({
      allowed: false,
      reason: "El monto del pago excede lo registrado en la venta",
      reasonCode: "BAD_REQUEST",
    });
    expect(impact.payments.map((line) => [line.paymentId, line.outcome])).toEqual([
      ["pay-002", "unchanged"],
      ["pay-004", "blocks_action"],
    ]);
    expect(impact.stock.every((line) => line.quantityDelta === 0)).toBe(true);
  });

  it("anular con pagos activos: mismo rechazo que cancel_sale", () => {
    const impact = getSaleImpact("sale-002", "cancel", DEFAULT_STORE_ID);

    expect(impact.allowed).toBe(false);
    expect(impact.reasonCode).toBe("CONFLICT");
    expect(impact.reason).toContain("2 pago(s) activo(s) por Bs 5000.00");
  });

  it("venta ya cancelada: no se ofrece", () => {
    expect(getSaleImpact("sale-004", "cancel", DEFAULT_STORE_ID)).toMatchObject({
      allowed: false,
      reason: "La venta ya fue cancelada o devuelta",
    });
  });

  it("404 si la venta no existe o es de otra tienda", () => {
    expect(() => getSaleImpact("missing", "cancel", DEFAULT_STORE_ID)).toThrow(
      expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
    );
    expect(() => getSaleImpact("sale-002", "cancel", OTHER_STORE_ID)).toThrow(
      expect.objectContaining({ code: "NOT_FOUND", status: 404 }),
    );
  });

  it("descuenta lo ya devuelto con devolucion_cliente", () => {
    mockStockMovements.push({
      createdAt: "2026-05-19T10:00:00.000Z",
      id: "mov-impact-test",
      productId: "prod-cable",
      quantityDelta: 1,
      saleId: "sale-002",
      stockAfter: 5,
      type: "devolucion_cliente",
    });

    try {
      expect(loadSaleImpactInputs("sale-002", "return", DEFAULT_STORE_ID).returnedByProduct).toEqual({
        "prod-cable": 1,
      });
    } finally {
      mockStockMovements.pop();
    }
  });

  it("no escribe en el mock", () => {
    const before = JSON.stringify([mockSales, mockPayments, mockProducts, mockStockMovements]);

    getSaleImpact("sale-001", "return", DEFAULT_STORE_ID);
    getSaleImpact("sale-002", "cancel", DEFAULT_STORE_ID);

    expect(JSON.stringify([mockSales, mockPayments, mockProducts, mockStockMovements])).toBe(before);
  });
});
