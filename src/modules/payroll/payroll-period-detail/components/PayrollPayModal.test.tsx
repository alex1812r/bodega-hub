import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PaymentMethod } from "@bodega/core";

import type { PayrollItem } from "../../types";
import { PayrollPayModal } from "./PayrollPayModal";

const mutateAsync = jest.fn();
/** `undefined` = los metodos habilitados de la tienda todavia no han llegado. */
let mockEnabledMethods: PaymentMethod[] | undefined = ["efectivo_ves", "efectivo_usd"];

jest.mock("../../hooks/usePayroll", () => ({
  usePayPayrollItem: () => ({ isPending: false, mutateAsync, reset: jest.fn() }),
}));

jest.mock("../../../settings/hooks/useSettings", () => ({
  useEnabledPaymentMethods: () => ({ data: mockEnabledMethods }),
}));

jest.mock("../../../settings/hooks/useCurrentExchangeRate", () => ({
  useCurrentExchangeRate: () => ({ data: { rateVes: 100 } }),
}));

jest.mock("../../../vault/hooks/useVault", () => ({
  useVault: () => ({
    data: { balanceEfectivoVes: 5000, balanceRef: 800, balanceVes: 3000 },
    error: null,
    refetch: jest.fn(),
  }),
}));

/** El formulario abre la confirmación (CNF-13); el pago solo sale al confirmarla. */
async function confirmPayment(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog", { name: "Confirmar pago de comisión" });

  await user.click(within(dialog).getByRole("button", { name: "Pagar comisión" }));
}

const item = { fullName: "Ana Perez", id: "item-1", totalRef: 12.5 } as PayrollItem;

describe("PayrollPayModal · NumberInput (SHR-09)", () => {
  beforeEach(() => {
    mockEnabledMethods = ["efectivo_ves", "efectivo_usd"];
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it("muestra el monto sugerido en un campo de texto y lo paga tal cual", async () => {
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    const amount = screen.getByLabelText("Monto");

    expect(amount).toHaveAttribute("type", "text");
    expect(amount).toHaveValue("1250.00");

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await confirmPayment(user);

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
    await confirmPayment(user);

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

describe("PayrollPayModal · metodos habilitados que llegan tarde (PAG-08)", () => {
  beforeEach(() => {
    mockEnabledMethods = undefined;
    mutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it("descarta un monto tecleado en Bs cuando el metodo cae a uno en USD", async () => {
    const user = userEvent.setup();
    const view = render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "500");
    expect(screen.getByLabelText("Método")).toHaveValue("efectivo_ves");

    mockEnabledMethods = ["efectivo_usd", "pago_movil"];
    view.rerender(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    expect(screen.getByLabelText("Método")).toHaveValue("efectivo_usd");
    expect(screen.getByText("Monto en USD.")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("12.50");

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await confirmPayment(user);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12.5, method: "efectivo_usd" }),
    );
  });

  it("descarta un monto tecleado en USD cuando el metodo cae a uno en Bs", async () => {
    const user = userEvent.setup();
    const view = render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.selectOptions(screen.getByLabelText("Método"), "efectivo_usd");
    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "20");

    mockEnabledMethods = ["efectivo_ves"];
    view.rerender(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    expect(screen.getByLabelText("Método")).toHaveValue("efectivo_ves");
    expect(screen.getByLabelText("Monto")).toHaveValue("1250.00");

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await confirmPayment(user);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1250, method: "efectivo_ves" }),
    );
  });

  it("respeta el monto que se teclea despues de que el metodo cayo a otra moneda", async () => {
    const user = userEvent.setup();
    const view = render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "500");

    mockEnabledMethods = ["efectivo_usd"];
    view.rerender(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "10");
    expect(screen.getByLabelText("Monto")).toHaveValue("10");

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await confirmPayment(user);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10, method: "efectivo_usd" }),
    );
  });

  it("no toca el monto tecleado si el metodo elegido si esta habilitado", async () => {
    const user = userEvent.setup();
    const view = render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "500");

    mockEnabledMethods = ["efectivo_ves", "efectivo_usd"];
    view.rerender(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    expect(screen.getByLabelText("Método")).toHaveValue("efectivo_ves");
    expect(screen.getByLabelText("Monto")).toHaveValue("500");

    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await confirmPayment(user);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, method: "efectivo_ves" }),
    );
  });

  it("conserva el monto tecleado si el metodo cae a otro de la misma moneda", async () => {
    const user = userEvent.setup();
    const view = render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "500");

    mockEnabledMethods = ["pago_movil"];
    view.rerender(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    expect(screen.getByLabelText("Método")).toHaveValue("pago_movil");
    expect(screen.getByText("Monto en Bs.")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("500");
  });

  it("el cambio manual de metodo sigue volviendo al monto sugerido", async () => {
    mockEnabledMethods = ["efectivo_ves", "efectivo_usd"];
    const user = userEvent.setup();

    render(<PayrollPayModal items={[item]} onOpenChange={jest.fn()} open />);

    await user.clear(screen.getByLabelText("Monto"));
    await user.type(screen.getByLabelText("Monto"), "500");
    await user.selectOptions(screen.getByLabelText("Método"), "efectivo_usd");

    expect(screen.getByLabelText("Monto")).toHaveValue("12.50");

    await user.selectOptions(screen.getByLabelText("Método"), "efectivo_ves");

    expect(screen.getByLabelText("Monto")).toHaveValue("1250.00");
  });
});
