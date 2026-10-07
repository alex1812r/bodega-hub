import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VaultDepositModal } from "./VaultDepositModal";

const mutateAsync = jest.fn();

jest.mock("../../hooks/useVault", () => ({
  useVaultDeposit: () => ({ isPending: false, mutateAsync }),
}));

describe("VaultDepositModal · NumberInput (SHR-09)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it("los montos son campos de texto y el payload sale redondeado a 2 decimales", async () => {
    const user = userEvent.setup();

    render(<VaultDepositModal onOpenChange={jest.fn()} open />);

    const ves = screen.getByLabelText("Monto Bs.");
    const ref = screen.getByLabelText("Monto REF");

    expect(ves).toHaveAttribute("type", "text");
    expect(ref).toHaveAttribute("type", "text");

    await user.type(ves, "250,005");
    await user.type(ref, "3.999");
    await user.click(screen.getByRole("button", { name: "Depositar efectivo" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      amountRef: 4,
      amountVes: 250.01,
      notes: undefined,
    });
  });

  it("sin montos mantiene el error de validacion y no envia", async () => {
    const user = userEvent.setup();

    render(<VaultDepositModal onOpenChange={jest.fn()} open />);

    await user.click(screen.getByRole("button", { name: "Depositar efectivo" }));

    expect(await screen.findByText("Indica al menos un monto mayor a cero.")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
