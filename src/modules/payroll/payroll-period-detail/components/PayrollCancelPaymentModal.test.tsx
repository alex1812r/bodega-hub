/**
 * CNF-13 · anular un pago de nómina devuelve dinero al baúl: confirma con el
 * monto, el método y la cubeta antes → después, y exige el motivo.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PayrollItem } from "../../types";
import { PayrollCancelPaymentModal } from "./PayrollCancelPaymentModal";

const mutateAsync = jest.fn();

jest.mock("../../hooks/usePayroll", () => ({
  useCancelPayrollPayment: () => ({ isPending: false, mutateAsync }),
}));

type MockVaultQuery = {
  data?: { balanceEfectivoVes: number; balanceRef: number; balanceVes: number };
  error: Error | null;
  refetch: jest.Mock;
};

const fullVault: MockVaultQuery = {
  data: { balanceEfectivoVes: 5000, balanceRef: 800, balanceVes: 3000 },
  error: null,
  refetch: jest.fn(),
};
let mockVault: MockVaultQuery = fullVault;

jest.mock("../../../vault/hooks/useVault", () => ({
  useVault: () => mockVault,
}));

const paidByTransfer = {
  fullName: "Ana Perez",
  id: "item-1",
  paidAmount: 1250,
  paidCurrency: "VES",
  paidMethod: "pago_movil",
  paidRef: 12.5,
  paidVes: 1250,
  status: "pagado",
  totalRef: 12.5,
  vaultMovementId: "movement-1",
} as PayrollItem;

describe("PayrollCancelPaymentModal · confirmación con efecto en el baúl (CNF-13)", () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(undefined);
    mockVault = fullVault;
  });

  it("muestra cajero, monto, método y la cubeta a la que vuelve el dinero", () => {
    render(
      <PayrollCancelPaymentModal item={paidByTransfer} onOpenChange={jest.fn()} periodStatus="pagado" />,
    );

    const dialog = screen.getByRole("dialog", { name: "Anular pago de nómina" });

    expect(within(dialog).getByText("Ana Perez")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/vuelve a Cuenta Bs\. del baúl/);
    expect(dialog).toHaveTextContent(/1\.250,00 · Pago m[oó]vil/i);
    expect(dialog).toHaveTextContent(/Cuenta Bs\. \(\+.*1\.250,00\)/);
    expect(dialog).toHaveTextContent(/3\.000,00/);
    expect(dialog).toHaveTextContent(/4\.250,00/);
    expect(dialog).toHaveTextContent(/Recibo.*Pagado.*Pendiente/);
    expect(dialog).toHaveTextContent(/Quincena.*Pagada.*Aprobada/);
  });

  it("un pago en efectivo USD vuelve al Saldo REF", () => {
    render(
      <PayrollCancelPaymentModal
        item={{ ...paidByTransfer, paidAmount: 12.5, paidCurrency: "USD", paidMethod: "efectivo_usd", paidVes: 0 }}
        onOpenChange={jest.fn()}
        periodStatus="aprobado"
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Anular pago de nómina" });

    expect(dialog).toHaveTextContent(/vuelve a Saldo REF del baúl/);
    expect(dialog).toHaveTextContent(/Saldo REF \(\+.*12[.,]50\)/);
    expect(dialog).toHaveTextContent(/812[.,]50/);
    expect(dialog).not.toHaveTextContent("Quincena");
  });

  it("cancelar no anula nada", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(<PayrollCancelPaymentModal item={paidByTransfer} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sin motivo no anula y pide explicarlo", async () => {
    const user = userEvent.setup();

    render(<PayrollCancelPaymentModal item={paidByTransfer} onOpenChange={jest.fn()} />);
    await user.click(screen.getByRole("button", { name: "Anular pago" }));

    expect(await screen.findByText("Explica por qué se anula")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("con motivo anula una sola vez aunque haya doble clic", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    let resolveCancel: () => void = () => undefined;

    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );

    render(<PayrollCancelPaymentModal item={paidByTransfer} onOpenChange={onOpenChange} />);
    await user.type(screen.getByLabelText("Motivo"), "  Método equivocado ");
    await user.dblClick(screen.getByRole("button", { name: "Anular pago" }));
    resolveCancel();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ itemId: "item-1", notes: "Método equivocado" });
  });

  it("sin los saldos del baúl no deja anular a ciegas", () => {
    mockVault = { data: undefined, error: new Error("Baúl no disponible"), refetch: jest.fn() };

    render(<PayrollCancelPaymentModal item={paidByTransfer} onOpenChange={jest.fn()} />);

    expect(screen.getByText("Baúl no disponible")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular pago" })).not.toBeInTheDocument();
  });

  it("un recibo pagado en cero dice que no vuelve dinero y no necesita los saldos", () => {
    mockVault = { data: undefined, error: new Error("Baúl no disponible"), refetch: jest.fn() };

    render(
      <PayrollCancelPaymentModal
        item={{ ...paidByTransfer, paidAmount: 0, paidMethod: null, totalRef: 0, vaultMovementId: null }}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText(/No vuelve dinero al baúl/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular pago" })).toBeInTheDocument();
  });

  it("si el servidor rechaza, el motivo se lee en el diálogo", async () => {
    const user = userEvent.setup();

    mutateAsync.mockRejectedValue(new Error("Este recibo no está pagado."));

    render(<PayrollCancelPaymentModal item={paidByTransfer} onOpenChange={jest.fn()} />);
    await user.type(screen.getByLabelText("Motivo"), "Error");
    await user.click(screen.getByRole("button", { name: "Anular pago" }));

    expect(await screen.findByText("Este recibo no está pagado.")).toBeInTheDocument();
  });
});
