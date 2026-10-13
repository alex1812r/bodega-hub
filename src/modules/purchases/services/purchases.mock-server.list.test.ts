/**
 * @jest-environment node
 */
/**
 * COM-08 · paridad del mock con `purchases.server` en los filtros del listado:
 * rango de fechas (día operativo Caracas) y "con saldo pendiente".
 */

import { mockPayments } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPurchases } from "./purchases.mock-server";

function list(query: string) {
  return listPurchases(new URLSearchParams(query), DEFAULT_STORE_ID);
}

function ids(query: string) {
  return list(query).items.map((purchase) => purchase.id);
}

describe("purchases.mock-server · listPurchases (COM-08)", () => {
  it("sin filtros no devuelve `pendingBalanceRef`", () => {
    const result = list("limit=100");

    expect(result).not.toHaveProperty("pendingBalanceRef");
    expect(result.total).toBe(4);
  });

  it("`from` / `to` filtran por día operativo Caracas, extremos incluidos", () => {
    expect(ids("from=2026-05-17&to=2026-05-17")).toEqual(["purchase-001"]);
    expect(ids("from=2026-05-16&to=2026-05-17").sort()).toEqual(["purchase-001", "purchase-003"]);
    expect(ids("from=2026-05-18")).toEqual(["purchase-002"]);
    expect(ids("to=2026-05-15")).toEqual(["purchase-004"]);
    expect(ids("from=2026-06-01")).toEqual([]);
  });

  it("`pendingBalance=1`: solo compras vigentes a las que les falta por pagar", () => {
    const result = list("pendingBalance=1&limit=100");

    // 001 está pagada entera; 003 está cancelada; 004 (abono parcial) está devuelta.
    expect(result.items.map((purchase) => purchase.id)).toEqual(["purchase-002"]);
    expect(result.total).toBe(1);
    expect(result.pendingBalanceRef).toBe(52.4);
  });

  it("`pendingBalance=1` se combina con el rango y con el estado", () => {
    expect(ids("pendingBalance=1&from=2026-05-18&to=2026-05-18")).toEqual(["purchase-002"]);
    expect(list("pendingBalance=1&to=2026-05-17")).toEqual(
      expect.objectContaining({ items: [], pendingBalanceRef: 0, total: 0 }),
    );
    expect(ids("pendingBalance=1&status=recibido")).toEqual([]);
  });

  it("`pendingBalanceRef` suma todo el filtro, no solo la página", () => {
    const payment = mockPayments.find((candidate) => candidate.purchaseId === "purchase-001");

    if (!payment) {
      throw new Error("La semilla debe traer un pago de purchase-001.");
    }

    const previousStatus = payment.status;
    // Con su pago anulado, purchase-001 vuelve a deber sus 20 REF.
    payment.status = "anulado";

    try {
      const firstPage = list("pendingBalance=1&limit=10&skip=0");
      const pastTheEnd = list("pendingBalance=1&limit=10&skip=10");

      expect(firstPage.items.map((purchase) => purchase.id).sort()).toEqual([
        "purchase-001",
        "purchase-002",
      ]);
      expect(firstPage.total).toBe(2);
      expect(firstPage.pendingBalanceRef).toBe(72.4);
      expect(pastTheEnd.items).toEqual([]);
      expect(pastTheEnd.pendingBalanceRef).toBe(72.4);
    } finally {
      payment.status = previousStatus;
    }
  });
});
