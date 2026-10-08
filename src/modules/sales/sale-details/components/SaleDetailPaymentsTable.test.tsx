/**
 * PAG-F4 C · el historial de pagos de la venta distingue los pagos anulados:
 * etiqueta "Anulado" y monto tachado. Un pago vigente no lleva marca.
 */
import { render, screen, within } from "@testing-library/react";

import type { PaymentMock } from "@/shared/mocks/erp-data";
import { formatVesBs } from "@/shared/utils/currency";

import { SaleDetailPaymentsTable } from "./SaleDetailPaymentsTable";

function payment(id: string, overrides: Partial<PaymentMock> = {}): PaymentMock {
  return {
    amount: 5000,
    amountRef: 10,
    amountVes: 5000,
    contactId: "cont-customer",
    createdAt: "2026-10-06T13:32:00.000Z",
    direction: "entrada",
    id,
    method: "transferencia",
    refRateVes: 500,
    saleId: "sale-001",
    status: "activo",
    ...overrides,
  };
}

describe("SaleDetailPaymentsTable", () => {
  it("marca el pago anulado con «Anulado» y tacha su monto; el vigente queda sin marca", () => {
    render(
      <SaleDetailPaymentsTable
        payments={[
          payment("pay-active", { referenceCode: "TRX-VIGENTE" }),
          payment("pay-voided", {
            amountVes: 2000,
            referenceCode: "TRX-ANULADO",
            status: "anulado",
          }),
        ]}
      />,
    );

    const voided = within(screen.getByText("TRX-ANULADO").closest("tr")!);
    const active = within(screen.getByText("TRX-VIGENTE").closest("tr")!);

    expect(voided.getByText("Anulado")).toBeInTheDocument();
    expect(voided.getByText(formatVesBs(2000))).toHaveClass("line-through");

    expect(active.queryByText("Anulado")).not.toBeInTheDocument();
    expect(active.getByText(formatVesBs(5000))).not.toHaveClass("line-through");
  });

  it("un pago sin estado (dato antiguo) se trata como vigente", () => {
    render(
      <SaleDetailPaymentsTable
        payments={[payment("pay-legacy", { referenceCode: "TRX-VIEJO", status: undefined })]}
      />,
    );

    expect(screen.queryByText("Anulado")).not.toBeInTheDocument();
    expect(screen.getByText(formatVesBs(5000))).not.toHaveClass("line-through");
  });
});
