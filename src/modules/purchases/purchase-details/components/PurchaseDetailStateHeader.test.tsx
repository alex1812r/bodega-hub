import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { formatVesBs } from "@/shared/utils/currency";

import { getPendingVesToday, PurchaseDetailStateHeader } from "./PurchaseDetailStateHeader";

describe("getPendingVesToday", () => {
  it("con la tasa de la compra usa el saldo en Bs del documento, no el saldo REF redondeado × tasa", () => {
    // Total Bs 1.000,00 a 36,57 con Bs 500,01 pagados: el documento debe Bs 499,99.
    const figures = { paidVes: 500.01, pendingRef: 13.67, refRateVes: 36.57, totalVes: 1000 };

    // El saldo REF redondeado × tasa (13,67 × 36,57) daría 499,91.
    expect(getPendingVesToday({ ...figures, currentRateVes: 36.57 })).toBe(499.99);
  });

  it("con otra tasa convierte el saldo REF a la tasa de hoy", () => {
    expect(
      getPendingVesToday({
        currentRateVes: 40,
        paidVes: 500.01,
        pendingRef: 13.67,
        refRateVes: 36.57,
        totalVes: 1000,
      }),
    ).toBe(546.8);
  });

  it("sin tasa de hoy no hay cifra, y un sobrepago no da saldo negativo", () => {
    const figures = { paidVes: 1200, pendingRef: 0, refRateVes: 36.57, totalVes: 1000 };

    expect(getPendingVesToday({ ...figures, currentRateVes: 0 })).toBeNull();
    expect(getPendingVesToday({ ...figures, currentRateVes: 36.57 })).toBe(0);
  });
});

describe("PurchaseDetailStateHeader", () => {
  it("«≈ hoy en Bs» coincide con el saldo del documento cuando la tasa no cambió", () => {
    render(
      <PurchaseDetailStateHeader
        actionsMenu={null}
        currentRateVes={36.57}
        paidRef={13.67}
        paidVes={500.01}
        pendingRef={13.67}
        purchaseNumber="C-20261009-000007"
        refRateVes={36.57}
        status="recibido"
        totalRef={27.34}
        totalVes={1000}
      />,
    );

    expect(screen.getByText(`≈ hoy en Bs: ${formatVesBs(499.99)}`)).toBeInTheDocument();
  });
});
