import { render, screen, within } from "@testing-library/react";

import { PaymentCancelConfirmModal } from "./PaymentCancelConfirmModal";

describe("PaymentCancelConfirmModal", () => {
  it("SHR-19 M4: muestra dentro del modal el error que llega despues de abrirlo, tal cual", () => {
    const props = {
      onConfirm: jest.fn(),
      onOpenChange: jest.fn(),
      open: true,
      paymentId: "pay-001",
    };
    const { rerender } = render(<PaymentCancelConfirmModal {...props} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(
      <PaymentCancelConfirmModal {...props} error="El pago pertenece a una caja ya cerrada." />,
    );

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "El pago pertenece a una caja ya cerrada.",
    );
    expect(screen.getByRole("button", { name: "Anular pago" })).toBeEnabled();
  });
});
