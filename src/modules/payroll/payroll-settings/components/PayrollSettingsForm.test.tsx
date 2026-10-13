import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PayrollSettings } from "../../types";
import { PayrollSettingsForm } from "./PayrollSettingsForm";

const mockUpdate = jest.fn();

jest.mock("../../hooks/usePayroll", () => ({
  useUpdatePayrollSettings: () => ({ isPending: false, mutateAsync: mockUpdate }),
}));

const settings = {
  commissionSince: "2026-01-01",
  defaultCommissionPct: 3,
  eligibleRoles: ["vendedor"],
  reinvestPct: 45,
  reservePct: 20,
  storeId: "store-1",
  updatedAt: "2026-09-16T12:00:00.000Z",
  warnShareOfGrossProfitPct: 40,
} as PayrollSettings;

const percentLabels = [
  "Comisión por defecto (%)",
  "Umbral de alerta del semáforo (%)",
  "Reinversión sugerida (%)",
  "Reserva sugerida (%)",
];

describe("PayrollSettingsForm · porcentajes entre 0 y 100 (SHR-09J)", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
  });

  it.each(percentLabels)("%s = 150: avisa Entre 0 y 100. y no envia (ni con Enter ni con el boton)", async (label) => {
    const user = userEvent.setup();

    render(<PayrollSettingsForm settings={settings} />);

    const field = screen.getByLabelText(label);

    await user.clear(field);
    // El boton esta dentro del <form>: Enter lo envia de verdad.
    await user.type(field, "150{Enter}");
    await user.click(screen.getByRole("button", { name: "Guardar parámetros" }));

    // Sin `max` en el campo: lo escrito no se recorta a 100 en silencio.
    expect(field).toHaveValue("150");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Entre 0 y 100.");
    expect(screen.getByText("Entre 0 y 100.")).toBeVisible();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("sin tocar nada no hay avisos", () => {
    render(<PayrollSettingsForm settings={settings} />);

    expect(screen.queryByText("Entre 0 y 100.")).not.toBeInTheDocument();
  });

  it("100 es valido: una sola llamada con el payload de siempre", async () => {
    const user = userEvent.setup();

    render(<PayrollSettingsForm settings={settings} />);

    const field = screen.getByLabelText("Comisión por defecto (%)");

    await user.clear(field);
    await user.type(field, "100{Enter}");

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      commissionSince: "2026-01-01",
      defaultCommissionPct: 100,
      eligibleRoles: ["vendedor"],
      reinvestPct: 45,
      reservePct: 20,
      warnShareOfGrossProfitPct: 40,
    });
  });
});
