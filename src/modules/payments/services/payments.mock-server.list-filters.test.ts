/**
 * @jest-environment node
 */
/**
 * PAG-05 · modo mock: `method`, `from` y `to` con la misma semantica que
 * `payments.server` (dia operativo Caracas, ambos extremos inclusive).
 */

import { mockPayments, type PaymentMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { listPayments } from "./payments.mock-server";

function listIds(query: string, options?: { salePaymentsOnly?: boolean }) {
  return listPayments(new URLSearchParams(`${query}&limit=100`), DEFAULT_STORE_ID, options)
    .items.map((payment) => payment.id)
    .sort();
}

describe("payments.mock-server · listPayments con method, from y to (PAG-05)", () => {
  it("filtra por metodo", () => {
    expect(listIds("method=transferencia&from=2026-05-01&to=2026-05-31")).toEqual([
      "pay-003",
      "pay-007",
    ]);
    expect(listIds("method=efectivo_usd&from=2026-05-01&to=2026-05-31")).toEqual(["pay-005"]);
  });

  it("filtra por rango de fechas con los dos extremos incluidos", () => {
    expect(listIds("from=2026-05-15&to=2026-05-17")).toEqual(["pay-003", "pay-005", "pay-006"]);
    expect(listIds("from=2026-05-14&to=2026-05-14")).toEqual(["pay-007"]);
  });

  it("sin `from` o sin `to` el rango queda abierto por ese lado", () => {
    expect(listIds("to=2026-05-15")).toEqual(["pay-005", "pay-006", "pay-007"]);
    expect(listIds("from=2026-05-18&to=2026-05-18")).toEqual(["pay-001", "pay-002", "pay-004"]);
  });

  it("se combina con los filtros de siempre y con salePaymentsOnly", () => {
    expect(listIds("method=efectivo_ves&from=2026-05-01&to=2026-05-31")).toEqual([
      "pay-004",
      "pay-006",
    ]);
    expect(
      listIds("method=efectivo_ves&from=2026-05-01&to=2026-05-31", { salePaymentsOnly: true }),
    ).toEqual(["pay-004"]);
    expect(listIds("saleId=sale-002&method=pago_movil&from=2026-05-18")).toEqual(["pay-002"]);
  });

  describe("el dia es el operativo de Caracas (UTC-4), no el dia UTC", () => {
    const lateNight: PaymentMock = {
      ...mockPayments[0],
      // 23:30 del 19 en Caracas; en UTC ya es dia 20.
      createdAt: "2026-05-20T03:30:00.000Z",
      id: "pay-late-night",
    };
    const earlyMorning: PaymentMock = {
      ...mockPayments[0],
      // 00:00 del 20 en Caracas.
      createdAt: "2026-05-20T04:00:00.000Z",
      id: "pay-early-morning",
    };

    beforeAll(() => {
      mockPayments.push(lateNight, earlyMorning);
    });

    afterAll(() => {
      for (const payment of [lateNight, earlyMorning]) {
        mockPayments.splice(mockPayments.indexOf(payment), 1);
      }
    });

    it("un pago de las 23:30 pertenece a ese dia y el de las 00:00 al siguiente", () => {
      expect(listIds("from=2026-05-19&to=2026-05-19")).toEqual(["pay-late-night"]);
      expect(listIds("from=2026-05-20&to=2026-05-20")).toEqual(["pay-early-morning"]);
    });
  });
});
