import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";

import { PurchaseDetailStateHeader } from "./PurchaseDetailStateHeader";

function renderHeader(props: Partial<Parameters<typeof PurchaseDetailStateHeader>[0]>) {
  return render(
    <PurchaseDetailStateHeader
      actionsMenu={null}
      paidRef={13.67}
      paidVes={500.01}
      purchaseNumber="C-20261009-000007"
      refRateVes={36.57}
      status="recibido"
      totalRef={27.34}
      totalVes={1000}
      {...props}
    />,
  );
}

describe("PurchaseDetailStateHeader", () => {
  it("«≈ hoy en Bs» es el saldo en Bs del documento, no el saldo REF redondeado × tasa (D51)", () => {
    renderHeader({});

    // 13,67 × 36,57 daría 499,91; el documento debe Bs 499,99.
    expect(screen.getByText(`≈ hoy en Bs: ${formatVesBs(499.99)}`)).toBeInTheDocument();
    expect(screen.getByText("Pago parcial")).toBeInTheDocument();
  });

  it("GQ-07: con todo el REF pagado y Bs 4,54 por pagar NO dice «Pagado»: dice «Pago parcial» con ese saldo", () => {
    renderHeader({ paidRef: 161.1, paidVes: 141067.3, refRateVes: 875.6505, totalRef: 161.1, totalVes: 141071.84 });

    expect(screen.queryByText("Pagado", { selector: "dd, p, span, strong" })).not.toBeInTheDocument();
    expect(screen.getByText("Pago parcial")).toBeInTheDocument();
    expect(screen.getByText(`≈ hoy en Bs: ${formatVesBs(4.54)}`)).toBeInTheDocument();
  });

  it("GQ-07: saldada en Bs muestra «Pagado» y saldo 0 en las dos monedas, aunque falte REF", () => {
    renderHeader({ paidRef: 25, paidVes: 1000 });

    expect(screen.getByText("Pagado", { selector: ":not(dt)" })).toBeInTheDocument();
    expect(screen.getByText(formatRefUsd(0))).toBeInTheDocument();
    expect(screen.getByText(`≈ hoy en Bs: ${formatVesBs(0)}`)).toBeInTheDocument();
  });
});
