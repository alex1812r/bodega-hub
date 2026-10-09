/**
 * CNF-13 · pagar nómina mueve dinero del baúl: el formulario no paga, abre la
 * confirmación con cada cajero, su monto y la cubeta antes → después.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PayrollItem } from "../../types";
import { PayrollPayModal } from "./PayrollPayModal";

const mutateAsync = jest.fn();

jest.mock("../../hooks/usePayroll", () => ({
  usePayPayrollItem: () => ({ isPending: false, mutateAsync, reset: jest.fn() }),
}));

jest.mock("../../../settings/hooks/useSettings", () => ({
  useEnabledPaymentMethods: () => ({ data: ["efectivo_ves", "efectivo_usd", "pago_movil"] }),
}));

jest.mock("../../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 100 } }),
}));

type MockVaultQuery = {
  data?: { balanceEfectivoVes: number; balanceRef: number; balanceVes: number };
  error: Error | null;
  refetch: jest.Mock;
};

const vaultRefetch = jest.fn();
const fullVault: MockVaultQuery = {
  data: { balanceEfectivoVes: 5000, balanceRef: 800, balanceVes: 3000 },
  error: null,
  refetch: vaultRefetch,
};
let mockVault: MockVaultQuery = fullVault;

jest.mock("../../../vault/hooks/useVault", () => ({
  useVault: () => mockVault,
}));

const item = { fullName: "Ana Perez", id: "item-1", totalRef: 12.5 } as PayrollItem;
const second = { fullName: "Luis Rojas", id: "item-2", totalRef: 7.5 } as PayrollItem;
const CONFIRM_TITLE = "Confirmar pago de comisión";

describe("PayrollPayModal · confirmación con efecto en el baúl (CNF-13)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
    vaultRefetch.mockReset();
    mockVault = fullVault;
  });

  async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));

    return screen.findByRole("dialog", { name: CONFIRM_TITLE });
  }

  it("no paga al enviar el formulario: muestra cajero, monto y la cubeta antes → después", async () => {
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const dialog = await openConfirmation(user);

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Ana Perez")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/sale de Efectivo Bs\. del baúl/);
    expect(dialog).toHaveTextContent(/Efectivo Bs\. \(−.*1\.250,00\)/);
    expect(dialog).toHaveTextContent(/5\.000,00/);
    expect(dialog).toHaveTextContent(/3\.750,00/);
    expect(dialog).toHaveTextContent(/Recibo.*Pendiente.*Pagado/);
  });

  it("cancelar la confirmación no paga y deja el formulario como estaba", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(<PayrollPayModal items={[item]} onOpenChange={onOpenChange} open />);

    const dialog = await openConfirmation(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: CONFIRM_TITLE })).not.toBeInTheDocument(),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Monto")).toHaveValue("1250.00");
  });

  it("un doble clic en confirmar paga una sola vez", async () => {
    const user = userEvent.setup();
    let resolvePayment: () => void = () => undefined;

    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePayment = resolve;
        }),
    );

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const dialog = await openConfirmation(user);

    await user.dblClick(within(dialog).getByRole("button", { name: "Pagar comisión" }));
    resolvePayment();

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  });

  it("si el pago supera el saldo de la cubeta, no deja confirmar y dice cuánto hay", async () => {
    const user = userEvent.setup();

    mockVault = {
      ...fullVault,
      data: { balanceEfectivoVes: 1000, balanceRef: 800, balanceVes: 3000 },
    };

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const dialog = await openConfirmation(user);

    expect(dialog).toHaveTextContent(/El baúl no alcanza: Efectivo Bs\. tiene .*1\.000,00/);
    expect(
      within(dialog).queryByRole("button", { name: "Pagar comisión" }),
    ).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("sin los saldos del baúl muestra el error y ofrece reintentar, sin confirmar a ciegas", async () => {
    const user = userEvent.setup();

    mockVault = { data: undefined, error: new Error("Baúl no disponible"), refetch: vaultRefetch };

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const dialog = await openConfirmation(user);

    expect(within(dialog).getByText("Baúl no disponible")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Pagar comisión" }),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Reintentar" }));

    expect(vaultRefetch).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("«Pagar todos» lista a cada cajero con su monto y descuenta el total de la cubeta", async () => {
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item, second]} onOpenChange={jest.fn()} open />);
    await user.selectOptions(screen.getByLabelText("Metodo"), "efectivo_usd");
    await user.click(screen.getByRole("button", { name: "Pagar todos" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirmar pago de la quincena" });

    expect(within(dialog).getByText("Ana Perez")).toBeInTheDocument();
    expect(within(dialog).getByText("Luis Rojas")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/sale de Saldo REF del baúl/);
    expect(dialog).toHaveTextContent(/Saldo REF \(−.*20[.,]00\)/);
    expect(dialog).toHaveTextContent(/780[.,]00/);
    expect(dialog).toHaveTextContent("2 recibos");
    expect(dialog).toHaveTextContent("si alguno falla, los anteriores quedan pagados");
    expect(mutateAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Pagar todos" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ amount: 12.5, itemId: "item-1", method: "efectivo_usd" }),
    );
    expect(mutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ amount: 7.5, itemId: "item-2", method: "efectivo_usd" }),
    );
  });

  it("si el servidor rechaza el pago, el motivo se lee en la confirmación", async () => {
    const user = userEvent.setup();

    mutateAsync.mockRejectedValue(new Error("Este recibo ya fue pagado."));

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const dialog = await openConfirmation(user);

    await user.click(within(dialog).getByRole("button", { name: "Pagar comisión" }));

    expect(await within(dialog).findByText("Este recibo ya fue pagado.")).toBeInTheDocument();
  });
});
