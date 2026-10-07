import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SupplierProduct } from "../../types/supplierProducts";
import { ManageSupplierProductPackUnitsModal } from "./ManageSupplierProductPackUnitsModal";

const mockCreate = jest.fn();

// El alias @/ lo reescribe SWC en los imports, no dentro de jest.mock.
jest.mock("../../hooks/useSupplierProductPackUnits", () => ({
  useCreateSupplierProductPackUnit: () => ({ isPending: false, mutateAsync: mockCreate }),
  useDeactivateSupplierProductPackUnit: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useSupplierProductPackUnits: () => ({ data: [], isLoading: false }),
  useUpdateSupplierProductPackUnit: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

const supplierProduct = { id: "sp-1", productId: "prod-1" } as SupplierProduct;

async function renderWithLabel() {
  const user = userEvent.setup();

  render(
    <ManageSupplierProductPackUnitsModal onOpenChange={jest.fn()} open supplierProduct={supplierProduct} />,
  );
  await user.type(screen.getByLabelText("Etiqueta"), "Caja");

  return user;
}

describe("ManageSupplierProductPackUnitsModal · unidades enteras (SHR-09J)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({});
  });

  it.each(["2.5", "2,5"])("unidades %p: se ve 2.5, avisa y no crea (ni con Enter ni con el boton)", async (typed) => {
    const user = await renderWithLabel();
    const units = screen.getByLabelText("Unidades por empaque");

    // El boton esta dentro del <form>: Enter lo envia de verdad.
    await user.type(units, `${typed}{Enter}`);

    expect(units).toHaveValue("2.5");
    expect(units).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
    expect(screen.getByText("Indica etiqueta y unidades por empaque validas.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Agregar empaque" }));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(units).toHaveValue("2.5");
  });

  it("unidades 3: una sola llamada con el payload de siempre", async () => {
    const user = await renderWithLabel();

    await user.type(screen.getByLabelText("Unidades por empaque"), "3{Enter}");

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith({ isDefault: false, label: "Caja", unitsPerPack: 3 });
  });
});
