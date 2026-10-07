import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PosCheckoutModal } from "./PosCheckoutModal";

function renderModal(onConfirm = jest.fn()) {
  render(
    <PosCheckoutModal
      defaultMethod="efectivo_usd"
      enabledPaymentMethods={["efectivo_usd", "efectivo_ves"]}
      onConfirm={onConfirm}
      onOpenChange={jest.fn()}
      open
      rateVes={100}
      totalRef={10}
    />,
  );

  return onConfirm;
}

describe("PosCheckoutModal · NumberInput (SHR-09)", () => {
  it("el monto es un campo de texto con teclado decimal", () => {
    renderModal();

    const amount = screen.getByLabelText("Monto");

    expect(amount).toHaveAttribute("type", "text");
    expect(amount).toHaveAttribute("inputmode", "decimal");
    expect(amount).toHaveValue("");
  });

  it("Completar restante sigue llenando el monto exacto y cobra", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.click(screen.getByRole("button", { name: "Completar restante" }));

    expect(screen.getByLabelText("Monto")).toHaveValue("10");

    await user.click(screen.getByRole("button", { name: "Cobrar" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].lines).toHaveLength(1);
    expect(onConfirm.mock.calls[0][0].lines[0]).toMatchObject({ amount: 10, method: "efectivo_usd" });
    expect(onConfirm.mock.calls[0][0].change).toBeNull();
  });

  it("al cobrar con Enter un monto con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.type(screen.getByLabelText("Monto"), "10,004{Enter}");

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0].lines[0]).toMatchObject({ amount: 10, method: "efectivo_usd" });
    expect(onConfirm.mock.calls[0][0].change).toBeNull();
  });
});
