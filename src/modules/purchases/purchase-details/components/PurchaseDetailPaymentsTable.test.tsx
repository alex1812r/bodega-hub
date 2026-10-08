/**
 * PAG-F4 C · el historial de pagos de la compra distingue los pagos anulados:
 * etiqueta "Anulado" y montos tachados. Un pago vigente no lleva marca.
 */
import { render, screen, within } from "@testing-library/react";

import type { PaymentMock } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { PurchaseDetailPaymentsTable } from "./PurchaseDetailPaymentsTable";

function payment(id: string, overrides: Partial<PaymentMock> = {}): PaymentMock {
  return {
    amount: 5000,
    amountRef: 10,
    amountVes: 5000,
    contactId: "cont-supplier",
    createdAt: "2026-10-06T13:32:00.000Z",
    direction: "salida",
    id,
    method: "transferencia",
    purchaseId: "purchase-001",
    refRateVes: 500,
    status: "activo",
    ...overrides,
  };
}

describe("PurchaseDetailPaymentsTable", () => {
  it("marca el pago anulado con «Anulado» y tacha sus montos; el vigente queda sin marca", () => {
    render(
      <PurchaseDetailPaymentsTable
        payments={[
          payment("pay-active", { referenceCode: "TRX-VIGENTE" }),
          payment("pay-voided", {
            amountRef: 4,
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
    expect(voided.getByText(formatRefUsd(4))).toHaveClass("line-through");

    expect(active.queryByText("Anulado")).not.toBeInTheDocument();
    expect(active.getByText(formatVesBs(5000))).not.toHaveClass("line-through");
    expect(active.getByText(formatRefUsd(10))).not.toHaveClass("line-through");
  });

  it("un pago sin estado (dato antiguo) se trata como vigente", () => {
    render(
      <PurchaseDetailPaymentsTable
        payments={[payment("pay-legacy", { referenceCode: "TRX-VIEJO", status: undefined })]}
      />,
    );

    expect(screen.queryByText("Anulado")).not.toBeInTheDocument();
    expect(screen.getByText(formatVesBs(5000))).not.toHaveClass("line-through");
  });
});
