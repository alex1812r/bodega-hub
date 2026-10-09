/**
 * DET-03 · la acción primaria de la cabecera queda bloqueada mientras la venta
 * se anula o se devuelve: un doble clic (o un clic con el estado a punto de
 * cambiar) no cobra ni imprime.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/sales/sale-1",
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));

import { SaleDetailHeader } from "./SaleDetailHeader";

type HeaderProps = ComponentProps<typeof SaleDetailHeader>;

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const handlers = {
    onCancel: jest.fn(),
    onCollect: jest.fn(),
    onDownloadPdf: jest.fn(),
    onPrint: jest.fn(),
    onReturn: jest.fn(),
  };

  render(
    <SaleDetailHeader
      canCollectBalance
      createdAt="2026-10-06T13:32:00.000Z"
      invoiceNumber="V-20261006-000013"
      paidVes={1000}
      pendingVes={1600}
      status="pendiente_pago"
      totalRef={3}
      totalVes={2600}
      {...handlers}
      {...overrides}
    />,
  );

  return handlers;
}

describe("SaleDetailHeader", () => {
  it("«Cobrar saldo» abre el cobro una vez por clic", () => {
    const { onCollect, onPrint } = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Cobrar saldo" }));

    expect(onCollect).toHaveBeenCalledTimes(1);
    expect(onPrint).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<HeaderProps>]>([
    ["se anula", { isCancelling: true }],
    ["se devuelve", { isReturning: true }],
  ])("mientras la venta %s, «Cobrar saldo» queda bloqueada", (_name, pending) => {
    const { onCollect } = renderHeader(pending);
    const button = screen.getByRole("button", { name: "Cobrar saldo" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    fireEvent.click(button);

    expect(onCollect).not.toHaveBeenCalled();
  });

  it("mientras la venta se anula, «Recibo» queda bloqueada", () => {
    const { onPrint } = renderHeader({
      canCollectBalance: false,
      isCancelling: true,
      pendingVes: 0,
      status: "pagada",
    });
    const button = screen.getByRole("button", { name: "Recibo" });

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onPrint).not.toHaveBeenCalled();
  });

  it("sin returnTo, «Volver» va al listado de ventas", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/sales");
  });
});
