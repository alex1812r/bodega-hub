/**
 * INT-02 · B3 — ajuste de stock: tras registrarse, el intento queda cerrado
 * mientras el modal siga abierto (quien lo controla aún no lo cerró) y se
 * reabre al cerrarse. Antes, `succeed()` soltaba el intento y otro envío en esa
 * ventana salía con una clave nueva: un segundo movimiento.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createQueryWrapper, installFetchStub } from "../../utils/requestAttempt.testUtils";
import { InventoryAdjustmentModal } from "./InventoryAdjustmentModal";

const productA = {
  barcode: null,
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 11,
  id: "prod-a",
  isActive: true,
  name: "Producto A",
  salePriceRef: 2,
  sku: "QA-A",
};
const formId = "inventory-adjustment-form";
const adjusted = { data: { id: "mov-1" } };

function fillAndSubmit(quantity: string) {
  fireEvent.change(screen.getByLabelText("Cantidad"), { target: { value: quantity } });
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);
}

async function waitForProduct() {
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Producto" })).not.toHaveValue(""),
  );
}

describe("InventoryAdjustmentModal · intento cerrado tras el éxito (INT-02)", () => {
  it("con el modal aún abierto tras registrar, otro envío no sale; al cerrarse y reabrirse sí, con otra clave", async () => {
    const api = installFetchStub(() => productA);
    const QueryWrapper = createQueryWrapper();
    const onOpenChange = jest.fn();

    api.respondToNextPost(adjusted);
    api.respondToNextPost(adjusted);

    // Controlado: el anfitrión todavía no cierra el modal.
    const modal = (open: boolean) => (
      <QueryWrapper>
        <InventoryAdjustmentModal defaultProductId="prod-a" onOpenChange={onOpenChange} open={open} />
      </QueryWrapper>
    );
    const view = render(modal(true));

    await waitForProduct();
    fillAndSubmit("3");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.posts).toHaveLength(1);

    // Sigue montado: un segundo envío en esa ventana no debe registrar otro movimiento.
    await waitForProduct();
    fillAndSubmit("3");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.posts).toHaveLength(1);

    view.rerender(modal(false));
    view.rerender(modal(true));
    await waitForProduct();
    fillAndSubmit("3");

    await waitFor(() => expect(api.posts).toHaveLength(2));
    expect(api.posts[1]?.body.clientRequestId).not.toBe(api.posts[0]?.body.clientRequestId);
  });
});
