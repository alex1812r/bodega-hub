import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

const lockedProduct = { currentStock: 10, id: "prod-cable", name: "Cable HDMI", sku: "ELE-CAB-001" };

/** INV-F5 · M3 / B3: el formulario no deja escribir lo que el servidor rechaza. */
describe("InventoryAdjustmentModal · topes del formulario (INV-F5)", () => {
  function renderModal() {
    const api = installFetchStub(() => {
      throw new Error("GET inesperado en el test");
    });

    render(<InventoryAdjustmentModal lockedProduct={lockedProduct} open />, {
      wrapper: createQueryWrapper(),
    });

    return api;
  }

  it("el motivo admite hasta 500 caracteres y dice cuántos lleva", () => {
    renderModal();

    const reason = screen.getByLabelText("Motivo");

    expect(reason).toHaveAttribute("maxlength", "500");
    expect(screen.getByText("0 de 500 caracteres.")).toBeInTheDocument();

    fireEvent.change(reason, { target: { value: "Conteo" } });

    expect(screen.getByText("6 de 500 caracteres.")).toBeInTheDocument();
  });

  it("una cantidad por encima del máximo avisa y no se envía", async () => {
    const user = userEvent.setup();
    const api = renderModal();

    await user.type(screen.getByLabelText("Cantidad"), "3000000000");

    expect(screen.getByText("La cantidad máxima es 999.999.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Registrar movimiento" }));

    expect(api.posts).toHaveLength(0);
  });
});
