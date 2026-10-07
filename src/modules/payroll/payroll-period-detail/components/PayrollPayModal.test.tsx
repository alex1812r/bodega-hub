import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PayrollItem } from "../../types";
import { PayrollPayModal } from "./PayrollPayModal";

const mutateAsync = jest.fn();

jest.mock("../../hooks/usePayroll", () => ({
  usePayPayrollItem: () => ({ isPending: false, mutateAsync, reset: jest.fn() }),
}));

jest.mock("../../../settings/hooks/useSettings", () => ({
  useEnabledPaymentMethods: () => ({ data: ["efectivo_ves", "efectivo_usd"] }),
}));

jest.mock("../../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 100 } }),
}));

const item = { fullName: "Ana Perez", id: "item-1", totalRef: 12.5 } as PayrollItem;

describe("PayrollPayModal · NumberInput (SHR-09)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it("muestra el monto sugerido en un campo de texto y lo paga tal cual", async () => {
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const amount = screen.getByLabelText("Monto");

    expect(amount).toHaveAttribute("type", "text");
    expect(amount).toHaveValue("1250.00");

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      amount: 1250,
      bankName: null,
      itemId: "item-1",
      method: "efectivo_ves",
      reference: null,
    });
  });

  it("al enviar con Enter un monto con 3 decimales viaja redondeado a 2", async () => {
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const amount = screen.getByLabelText("Monto");

    await user.clear(amount);
    await user.type(amount, "1200,555{Enter}");

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ amount: 1200.56 }));
  });

  it("un monto en cero mantiene el error de validacion", async () => {
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const amount = screen.getByLabelText("Monto");

    await user.clear(amount);
    await user.type(amount, "0");
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    expect(await screen.findByText("Indica un monto mayor a cero.")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
