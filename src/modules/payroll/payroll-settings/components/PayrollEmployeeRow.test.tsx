/**
 * GQ-06 · el aviso de «punto de miles» del `NumberInput` iba en línea bajo el
 * campo y hacía crecer la fila de la tabla de empleados. En filas va flotante.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("../../hooks/usePayroll", () => ({
  useUpdatePayrollEmployee: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

import { PayrollEmployeeRow } from "./PayrollEmployeeRow";

describe("PayrollEmployeeRow · aviso de miles (GQ-06)", () => {
  it("un valor que parece llevar punto de miles avisa sin hacer crecer la fila", async () => {
    const user = userEvent.setup();

    render(
      <table>
        <tbody>
          <PayrollEmployeeRow
            defaultCommissionPct={2}
            employee={{
              commissionPct: 2,
              employeeId: "emp-1",
              fullName: "Ana Caja",
              isActive: true,
              profileId: "profile-1",
              role: "vendedor",
            }}
          />
        </tbody>
      </table>,
    );

    const field = screen.getByLabelText("Comisión de Ana Caja");

    await user.clear(field);
    await user.type(field, "1.250");

    const notice = await screen.findByRole("status");

    expect(notice).toHaveAttribute("data-placement", "floating");
    expect(document.querySelector('[data-placement="inline"]')).not.toBeInTheDocument();
  });
});
