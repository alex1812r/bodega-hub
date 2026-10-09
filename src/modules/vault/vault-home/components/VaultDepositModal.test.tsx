import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VaultDepositModal } from "./VaultDepositModal";

const mutateAsync = jest.fn();

jest.mock("../../hooks/useVault", () => ({
  useVault: () => ({
    data: { balanceEfectivoVes: 1000.1, balanceRef: 20.3, balanceVes: 5000 },
    error: null,
    refetch: jest.fn(),
  }),
  useVaultDeposit: () => ({ isPending: false, mutateAsync }),
}));

function confirmDialog() {
  return screen.getByRole("dialog", { name: "Confirmar depósito al baúl" });
}

describe("VaultDepositModal", () => {
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
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(within(confirmDialog()).getByRole("button", { name: "Depositar efectivo" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      amountRef: 4,
      amountVes: 250.01,
      notes: undefined,
    });
  });

  it("sin montos mantiene el error de validación y no abre la confirmación", async () => {
    const user = userEvent.setup();

    render(<VaultDepositModal onOpenChange={jest.fn()} open />);

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Indica al menos un monto mayor a cero.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Confirmar depósito al baúl" })).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("la confirmación muestra las cubetas de efectivo antes → después y la cuenta sin cambio", async () => {
    const user = userEvent.setup();

    render(<VaultDepositModal onOpenChange={jest.fn()} open />);

    await user.type(screen.getByLabelText("Monto Bs."), "0,20");
    await user.type(screen.getByLabelText("Monto REF"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    const dialog = within(confirmDialog());
    const rows = dialog.getAllByRole("listitem");

    expect(rows[0]).toHaveTextContent("Efectivo Bs. (+Bs. 0,20)");
    expect(rows[0]).toHaveTextContent("Bs. 1.000,10");
    expect(rows[0]).toHaveTextContent("Bs. 1.000,30");
    expect(rows[1]).toHaveTextContent("Cuenta Bs.");
    expect(rows[1]).toHaveTextContent("Sin cambio");
    expect(rows[2]).toHaveTextContent("Saldo REF (+ref 5.00)");
    expect(rows[2]).toHaveTextContent("ref 25.30");
    expect(dialog.getByText("Sin nota")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("cancelar no deposita; un depósito mayor que el saldo no se bloquea", async () => {
    const user = userEvent.setup();

    render(<VaultDepositModal onOpenChange={jest.fn()} open />);

    await user.type(screen.getByLabelText("Monto Bs."), "99999");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(within(confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirmar depósito al baúl" })).toBeNull(),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Monto Bs.")).toHaveValue("99999");
  });

  it("doble clic en confirmar envía una sola petición y cierra al terminar", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(<VaultDepositModal onOpenChange={onOpenChange} open />);

    await user.type(screen.getByLabelText("Monto REF"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.dblClick(within(confirmDialog()).getByRole("button", { name: "Depositar efectivo" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("el error del servidor se muestra tal cual dentro de la confirmación", async () => {
    const user = userEvent.setup();
    const message = "Solo un administrador puede registrar depósitos en el baúl";

    mutateAsync.mockRejectedValue(new Error(message));

    const onOpenChange = jest.fn();

    render(<VaultDepositModal onOpenChange={onOpenChange} open />);

    await user.type(screen.getByLabelText("Monto REF"), "5");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(within(confirmDialog()).getByRole("button", { name: "Depositar efectivo" }));

    expect(await within(confirmDialog()).findByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
