import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VaultWithdrawalModal } from "./VaultWithdrawalModal";

const mutateAsync = jest.fn();
const refetch = jest.fn();
const vaultQuery: { data?: object; error: Error | null; refetch: jest.Mock } = {
  error: null,
  refetch,
};

jest.mock("../../hooks/useVault", () => ({
  useVault: () => vaultQuery,
  useVaultWithdrawal: () => ({ isPending: false, mutateAsync }),
}));

const balances = { balanceEfectivoVes: 1000.1, balanceRef: 20.3, balanceVes: 5000 };

function confirmDialog() {
  return screen.getByRole("dialog", { name: "Confirmar retiro del baúl" });
}

async function fillAndContinue(
  user: ReturnType<typeof userEvent.setup>,
  amounts: { ref?: string; ves?: string },
) {
  if (amounts.ves) {
    await user.type(screen.getByLabelText("Monto Bs."), amounts.ves);
  }

  if (amounts.ref) {
    await user.type(screen.getByLabelText("Monto REF"), amounts.ref);
  }

  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("VaultWithdrawalModal", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
    refetch.mockReset();
    vaultQuery.data = balances;
    vaultQuery.error = null;
  });

  it("los montos son campos de texto y el payload sale redondeado a 2 decimales", async () => {
    const user = userEvent.setup();

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    const ves = screen.getByLabelText("Monto Bs.");
    const ref = screen.getByLabelText("Monto REF");

    expect(ves).toHaveAttribute("type", "text");
    expect(ref).toHaveAttribute("type", "text");

    await fillAndContinue(user, { ref: "3.999", ves: "250,005" });
    await user.click(within(confirmDialog()).getByRole("button", { name: "Retirar efectivo" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      amountRef: 4,
      amountVes: 250.01,
      notes: undefined,
    });
  });

  it("sin montos mantiene el error de validación y no abre la confirmación", async () => {
    const user = userEvent.setup();

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(await screen.findByText("Indica al menos un monto mayor a cero.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Confirmar retiro del baúl" })).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("la confirmación muestra saldo actual → resultante por cubeta, la nota y la variante de peligro", async () => {
    const user = userEvent.setup();

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await user.type(screen.getByLabelText("Nota (opcional)"), "Pago al transportista");
    await fillAndContinue(user, { ves: "250,05" });

    const dialog = within(confirmDialog());
    const rows = dialog.getAllByRole("listitem");

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Efectivo Bs. (−Bs. 250,05)");
    expect(rows[0]).toHaveTextContent("Bs. 1.000,10");
    expect(rows[0]).toHaveTextContent("Bs. 750,05");
    expect(rows[1]).toHaveTextContent("Cuenta Bs.");
    expect(rows[1]).toHaveTextContent("Sin cambio");
    expect(rows[2]).toHaveTextContent("Saldo REF");
    expect(rows[2]).toHaveTextContent("Sin cambio");
    expect(dialog.getByText("Pago al transportista")).toBeInTheDocument();
    // Variante de peligro: el foco inicial va a «Cancelar», no al botón que retira.
    await waitFor(() => expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("cancelar la confirmación no retira y conserva lo tecleado", async () => {
    const user = userEvent.setup();

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await fillAndContinue(user, { ves: "250,05" });
    await user.click(within(confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirmar retiro del baúl" })).toBeNull(),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Monto Bs.")).toHaveValue("250.05");
  });

  it("doble clic en confirmar envía una sola petición", async () => {
    const user = userEvent.setup();
    let resolveRequest: () => void = () => undefined;

    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const onOpenChange = jest.fn();

    render(<VaultWithdrawalModal onOpenChange={onOpenChange} open />);

    await fillAndContinue(user, { ves: "100" });
    await user.dblClick(within(confirmDialog()).getByRole("button", { name: "Retirar efectivo" }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);

    resolveRequest();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("un retiro mayor que el saldo se bloquea en el formulario, antes de la confirmación", async () => {
    const user = userEvent.setup();

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await fillAndContinue(user, { ves: "1000,11" });

    expect(screen.getByText("Supera el efectivo disponible: Bs. 1.000,10.")).toBeInTheDocument();
    expect(
      screen.getByText("El retiro supera el efectivo disponible en el baúl."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Confirmar retiro del baúl" })).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("retirar exactamente el saldo sí se puede confirmar y deja la cubeta en cero", async () => {
    const user = userEvent.setup();

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await fillAndContinue(user, { ref: "20,30" });

    const rows = within(confirmDialog()).getAllByRole("listitem");

    expect(rows[2]).toHaveTextContent("ref 20.30");
    expect(rows[2]).toHaveTextContent("ref 0.00");
  });

  it("el error del servidor se muestra tal cual en la confirmación y no se pierde lo tecleado", async () => {
    const user = userEvent.setup();
    const message = "Saldo insuficiente en el baul (efectivo). Disponible VES: 10.00, REF: 0.00";

    mutateAsync.mockRejectedValue(new Error(message));

    const onOpenChange = jest.fn();

    render(<VaultWithdrawalModal onOpenChange={onOpenChange} open />);

    await fillAndContinue(user, { ves: "100" });
    await user.click(within(confirmDialog()).getByRole("button", { name: "Retirar efectivo" }));

    expect(await within(confirmDialog()).findByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Se puede reintentar desde la misma confirmación.
    await user.click(within(confirmDialog()).getByRole("button", { name: "Retirar efectivo" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    await user.click(within(confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirmar retiro del baúl" })).toBeNull(),
    );
    expect(screen.getByLabelText("Monto Bs.")).toHaveValue("100");
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("sin los saldos del baúl no deja confirmar a ciegas: muestra el error y permite reintentar", async () => {
    const user = userEvent.setup();

    vaultQuery.data = undefined;
    vaultQuery.error = new Error("Baúl no encontrado.");

    render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await fillAndContinue(user, { ves: "100" });

    const dialog = within(confirmDialog());

    expect(dialog.getByText("Baúl no encontrado.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Retirar efectivo" })).toBeNull();

    await user.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("si los saldos llegan con la confirmación abierta y no alcanzan, la confirmación queda bloqueada", async () => {
    const user = userEvent.setup();

    vaultQuery.data = undefined;

    const { rerender } = render(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    await fillAndContinue(user, { ves: "5000" });

    expect(within(confirmDialog()).getByText("Cargando los saldos del baúl…")).toBeInTheDocument();

    vaultQuery.data = balances;
    rerender(<VaultWithdrawalModal onOpenChange={jest.fn()} open />);

    const dialog = within(confirmDialog());

    expect(
      dialog.getByText("El retiro supera el efectivo disponible en el baúl."),
    ).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Retirar efectivo" })).toBeNull();
  });
});
