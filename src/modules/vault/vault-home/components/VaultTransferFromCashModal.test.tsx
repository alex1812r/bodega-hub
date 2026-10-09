import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CashSession } from "@/modules/cash/types";

import { VaultTransferFromCashModal } from "./VaultTransferFromCashModal";

const mutateAsync = jest.fn();
const refetch = jest.fn();
const vaultQuery: { data?: object; error: Error | null; refetch: jest.Mock } = {
  error: null,
  refetch,
};
let pendingClosures: CashSession[] = [];

jest.mock("../../hooks/useVault", () => ({
  useTransferFromCash: () => ({ isPending: false, mutateAsync }),
  useVault: () => vaultQuery,
}));

jest.mock("../../../cash/hooks/useCash", () => ({
  usePendingCashClosures: () => ({ data: pendingClosures, isLoading: false }),
}));

function closure(id: string, name: string, overrides: Partial<CashSession>): CashSession {
  return {
    closedAt: "2026-10-08T21:00:00.000Z",
    closingRef: 0,
    closingVes: 0,
    id,
    openedAt: "2026-10-08T12:00:00.000Z",
    openingRef: 0,
    openingVes: 0,
    register: {
      createdAt: "2026-10-01T12:00:00.000Z",
      id: `register-${id}`,
      isActive: true,
      name,
      storeId: "store-1",
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    registerId: `register-${id}`,
    status: "closed",
    ...overrides,
  };
}

function confirmDialog() {
  return screen.getByRole("dialog", { name: "Confirmar transferencia al baúl" });
}

async function selectAndContinue(user: ReturnType<typeof userEvent.setup>, names: RegExp[]) {
  for (const name of names) {
    await user.click(screen.getByRole("checkbox", { name }));
  }

  await user.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("VaultTransferFromCashModal", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
    refetch.mockReset();
    vaultQuery.data = { balanceEfectivoVes: 1000.1, balanceRef: 20.3, balanceVes: 5000 };
    vaultQuery.error = null;
    pendingClosures = [
      closure("a", "Caja 1", {
        closingRef: 10.1,
        closingVes: 900.1,
        theoreticalClosingRef: 10.1,
        theoreticalClosingVes: 950.3,
      }),
      closure("b", "Caja 2", {
        closingRef: 0.2,
        closingVes: 100.2,
        theoreticalClosingRef: 0,
        theoreticalClosingVes: 100,
      }),
      closure("c", "Caja 3", { closingVes: 7777, theoreticalClosingVes: 7777 }),
    ];
  });

  it("sin cierres seleccionados no abre la confirmación", async () => {
    const user = userEvent.setup();

    render(<VaultTransferFromCashModal onOpenChange={jest.fn()} open />);

    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText("Selecciona al menos un cierre pendiente.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Confirmar transferencia al baúl" })).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("lista cada cierre con caja, fecha, contado, teórico y diferencia (falta en rojo)", async () => {
    const user = userEvent.setup();

    render(<VaultTransferFromCashModal onOpenChange={jest.fn()} open />);

    await selectAndContinue(user, [/Caja 1/, /Caja 2/]);

    const list = within(confirmDialog()).getByRole("list", { name: "Cierres que se transfieren" });
    const rows = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Caja 1 · cerrado \d{2}\/10\/2026 \d{2}:\d{2}/);
    expect(rows[0]).toHaveTextContent("Contado Bs. 900,10");
    expect(rows[0]).toHaveTextContent("Teórico Bs. 950,30");
    expect(within(rows[0]).getByText(/Diferencia −Bs\. 50,20\s+\(falta\)/)).toHaveClass("text-error");
    // REF del primer cierre cuadra.
    expect(rows[0]).toHaveTextContent("Contado ref 10.10");
    expect(rows[0]).toHaveTextContent("Sin diferencia");
    expect(within(rows[1]).getByText(/Diferencia \+Bs\. 0,20\s+\(sobra\)/)).not.toHaveClass(
      "text-error",
    );
    expect(list).not.toHaveTextContent("Caja 3");
  });

  it("muestra el saldo de cada cubeta antes → después sumando el contado de los cierres", async () => {
    const user = userEvent.setup();

    render(<VaultTransferFromCashModal onOpenChange={jest.fn()} open />);

    await selectAndContinue(user, [/Caja 1/, /Caja 2/]);

    const dialog = within(confirmDialog());
    const rows = within(dialog.getByRole("list", { name: "Saldos del baúl" })).getAllByRole(
      "listitem",
    );

    expect(dialog.getByText(/Entra al baúl el monto contado de 2 cierres/)).toHaveTextContent(
      "Bs. 1.000,30 · ref 10.30",
    );
    expect(rows[0]).toHaveTextContent("Efectivo Bs. (+Bs. 1.000,30)");
    expect(rows[0]).toHaveTextContent("Bs. 1.000,10");
    expect(rows[0]).toHaveTextContent("Bs. 2.000,40");
    expect(rows[1]).toHaveTextContent("Cuenta Bs.");
    expect(rows[1]).toHaveTextContent("Sin cambio");
    expect(rows[2]).toHaveTextContent("Saldo REF (+ref 10.30)");
    expect(rows[2]).toHaveTextContent("ref 30.60");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("cancelar no transfiere y conserva la selección", async () => {
    const user = userEvent.setup();

    render(<VaultTransferFromCashModal onOpenChange={jest.fn()} open />);

    await selectAndContinue(user, [/Caja 1/]);
    await user.click(within(confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirmar transferencia al baúl" })).toBeNull(),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /Caja 1/ })).toBeChecked();
  });

  it("doble clic en confirmar envía una sola petición con los cierres mostrados", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(<VaultTransferFromCashModal onOpenChange={onOpenChange} open />);

    await user.type(screen.getByLabelText("Nota (opcional)"), " Cierre del jueves ");
    await selectAndContinue(user, [/Caja 2/, /Caja 1/]);
    await user.dblClick(
      within(confirmDialog()).getByRole("button", { name: "Transferir cierres" }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      notes: "Cierre del jueves",
      sessionIds: ["a", "b"],
    });
  });

  it("el error del servidor se muestra tal cual en la confirmación y no pierde la selección", async () => {
    const user = userEvent.setup();
    const message = "El cierre seleccionado ya fue transferido al baúl";

    mutateAsync.mockRejectedValue(new Error(message));

    const onOpenChange = jest.fn();

    render(<VaultTransferFromCashModal onOpenChange={onOpenChange} open />);

    await selectAndContinue(user, [/Caja 1/]);
    await user.click(within(confirmDialog()).getByRole("button", { name: "Transferir cierres" }));

    expect(await within(confirmDialog()).findByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(within(confirmDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Confirmar transferencia al baúl" })).toBeNull(),
    );
    expect(screen.getByRole("checkbox", { name: /Caja 1/ })).toBeChecked();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("un cierre absorbido conserva su aviso en la confirmación y sin teórico no inventa diferencia", async () => {
    const user = userEvent.setup();

    pendingClosures = [
      closure("old", "Caja vieja", {
        absorbedBySessionId: "next",
        closingVes: 500,
        theoreticalClosingVes: null,
      }),
    ];

    render(<VaultTransferFromCashModal onOpenChange={jest.fn()} open />);

    await selectAndContinue(user, [/Caja vieja/]);

    const row = within(
      within(confirmDialog()).getByRole("list", { name: "Cierres que se transfieren" }),
    ).getByRole("listitem");

    expect(row).toHaveTextContent("Teórico no disponible");
    expect(row).not.toHaveTextContent("Diferencia");
    expect(row).toHaveTextContent("Transferirlo completo infla el baúl.");
  });

  it("sin los saldos del baúl no deja confirmar a ciegas", async () => {
    const user = userEvent.setup();

    vaultQuery.data = undefined;
    vaultQuery.error = new Error("Baúl no encontrado.");

    render(<VaultTransferFromCashModal onOpenChange={jest.fn()} open />);

    await selectAndContinue(user, [/Caja 1/]);

    const dialog = within(confirmDialog());

    expect(dialog.getByText("Baúl no encontrado.")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Transferir cierres" })).toBeNull();
    expect(dialog.queryByRole("list", { name: "Saldos del baúl" })).toBeNull();

    await user.click(dialog.getByRole("button", { name: "Reintentar" }));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
