import "@testing-library/jest-dom";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PayrollItem, PayrollPeriod } from "../../types";

import { buildPayrollApproveEffects, PayrollApproveConfirmModal } from "./PayrollApproveConfirmModal";

/** CNF-F3 · aprobar una quincena confirma con su efecto: es irreversible. */

const mockApprove = jest.fn();
const mockUseApprove = jest.fn();

jest.mock("../../hooks/usePayroll", () => ({
  useApprovePayrollPeriod: (periodId: string) => {
    mockUseApprove(periodId);

    return { isPending: false, mutateAsync: mockApprove };
  },
}));

function item(overrides: Partial<PayrollItem> = {}): PayrollItem {
  return {
    commissionPct: 3,
    commissionRef: 45.6,
    employeeId: "employee-1",
    fullName: "Maria Perez",
    id: "item-1",
    paidAmount: null,
    paidAt: null,
    paidBy: null,
    paidCurrency: null,
    paidMethod: null,
    paidRateVes: null,
    paidRef: null,
    paidReference: null,
    paidVes: null,
    periodId: "period-1",
    profileId: "profile-1",
    reversalRef: -5.4,
    salesCount: 24,
    salesRef: 1520,
    status: "pendiente",
    storeId: "store-1",
    totalRef: 40.2,
    vaultMovementId: null,
    ...overrides,
  };
}

const period: PayrollPeriod = {
  approvedAt: null,
  approvedBy: null,
  commissionRef: 180,
  createdAt: "2026-09-16T12:00:00.000Z",
  fromDate: "2026-09-01",
  grossProfitRef: 1200,
  id: "period-1",
  notes: null,
  paidAt: null,
  periodKey: "2026-09-Q1",
  reversalRef: -20,
  salesRef: 6000,
  shareOfGrossProfitPct: 15,
  status: "borrador",
  storeId: "store-1",
  toDate: "2026-09-15",
  totalRef: 160,
  updatedAt: "2026-09-16T12:00:00.000Z",
};

const items = [
  item(),
  item({ employeeId: "employee-2", fullName: "Jose Gil", id: "item-2", salesCount: 16 }),
  item({ employeeId: "employee-3", fullName: "Ana Ruiz", id: "item-3", salesCount: 0, totalRef: 0 }),
];

function renderModal(onOpenChange = jest.fn()) {
  render(<PayrollApproveConfirmModal items={items} onOpenChange={onOpenChange} open period={period} />);

  return { onOpenChange, user: userEvent.setup({ delay: null }) };
}

beforeEach(() => {
  mockApprove.mockReset();
  mockApprove.mockResolvedValue({});
  mockUseApprove.mockReset();
});

describe("PayrollApproveConfirmModal", () => {
  it("muestra el periodo, los cajeros, el total y lo que la aprobación fija de verdad", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Aprobar quincena" });

    expect(mockUseApprove).toHaveBeenCalledWith("period-1");
    expect(dialog).toHaveTextContent(
      "Aprobar fija las comisiones que se pagarán por esta quincena. No se puede deshacer.",
    );
    expect(dialog).toHaveTextContent(
      /Periodo\s*1ª quincena de septiembre 2026 · del 2026-09-01 al 2026-09-15/,
    );
    expect(dialog).toHaveTextContent(/Cajeros\s*3/);
    expect(dialog).toHaveTextContent(/Ventas comisionables\s*ref 6000\.00/);
    expect(dialog).toHaveTextContent(/Comisión\s*ref 180\.00/);
    expect(dialog).toHaveTextContent(/Reversos\s*ref -20\.00/);
    expect(dialog).toHaveTextContent(/Total de nómina\s*ref 160\.00/);

    const effects = within(dialog)
      .getAllByRole("listitem")
      .map((effect) => [effect.getAttribute("data-tone"), effect.textContent]);

    expect(effects).toEqual([
      ["warning", "Aviso: QuincenaBorradorpasa aAprobada"],
      ["warning", "Aviso: Quedan por pagar3 recibos · ref 160.00"],
      [
        "warning",
        "Aviso: Quedan comisionadas en esta quincena; ninguna otra podrá comisionarlas40 ventas",
      ],
      ["danger", "Efecto crítico: Ya no se podrá recalcular ni devolver a borrador"],
      [
        "warning",
        "Aviso: Las cifras se recalculan al aprobar: pueden variar si se anularon o cobraron ventas desde el último cálculo",
      ],
      ["neutral", "Información: El baúl no se mueve: el dinero sale al pagar cada recibo"],
    ]);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("es irreversible: confirma en tono de peligro y el foco inicial va a Cancelar", async () => {
    renderModal();

    const dialog = within(screen.getByRole("dialog"));

    await waitFor(() => expect(dialog.getByRole("button", { name: "Cancelar" })).toHaveFocus());
    expect(dialog.getByRole("button", { name: "Aprobar quincena" })).toBeEnabled();
  });

  it("cuenta en singular con un solo recibo y una sola venta", () => {
    expect(
      buildPayrollApproveEffects({ totalRef: 12.5 }, [{ salesCount: 1 }]).map((effect) => effect.after),
    ).toEqual(["Aprobada", "1 recibo · ref 12.50", "1 venta", undefined, undefined, undefined]);
  });

  it("cancelar no aprueba nada", async () => {
    const { onOpenChange, user } = renderModal();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("confirmar aprueba una sola vez aunque haya doble clic, sin payload, y cierra", async () => {
    let release: (value: unknown) => void = () => undefined;

    mockApprove.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const { onOpenChange } = renderModal();
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Aprobar quincena",
    });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(1));
    expect(mockApprove).toHaveBeenCalledWith();
    expect(onOpenChange).not.toHaveBeenCalled();

    release({});
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockApprove).toHaveBeenCalledTimes(1);
  });

  it("el rechazo del servidor se lee tal cual dentro del modal, que sigue abierto para reintentar", async () => {
    mockApprove.mockRejectedValueOnce(
      new Error("Otra quincena ya comisionó alguna de estas ventas. Recalcula antes de aprobar."),
    );
    const { onOpenChange, user } = renderModal();
    const dialog = within(screen.getByRole("dialog"));

    await user.click(dialog.getByRole("button", { name: "Aprobar quincena" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Otra quincena ya comisionó alguna de estas ventas. Recalcula antes de aprobar.",
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Aprobar quincena" })).toBeEnabled(),
    );
    await user.click(dialog.getByRole("button", { name: "Aprobar quincena" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mockApprove).toHaveBeenCalledTimes(2);
  });
});
