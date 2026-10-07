import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductFormModal } from "./ProductFormModal";

jest.mock("../../../../shared/auth/Can", () => ({
  Can: () => null,
}));

jest.mock("../../hooks/useProducts", () => ({
  useProducts: () => ({ data: undefined }),
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

describe("ProductFormModal · NumberInput (SHR-09)", () => {
  it("al enviar con Enter los precios con 3 decimales viajan redondeados a 2 y los stocks como enteros", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);

    const cost = screen.getByLabelText("Costo ref");
    const price = screen.getByLabelText("Precio ref");
    const stock = screen.getByLabelText("Stock inicial");

    expect(cost).toHaveAttribute("type", "text");
    expect(price).toHaveAttribute("type", "text");
    expect(stock).toHaveAttribute("inputmode", "numeric");

    await user.type(screen.getByLabelText("Nombre"), "Harina");
    await user.type(screen.getByLabelText("SKU"), "harina");
    await user.type(cost, "1.004");
    await user.type(stock, "12");
    await user.type(screen.getByLabelText("Stock minimo"), "3");
    await user.type(price, "2,345{Enter}");

    // Enter normaliza antes del submit; user-event no dispara el submit implicito
    // con el boton fuera del <form>, asi que se envia con el boton del pie.
    expect(price).toHaveValue("2.35");

    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      currentCostRef: 1,
      currentStock: 12,
      minStock: 3,
      name: "Harina",
      salePriceRef: 2.35,
      sku: "harina",
    });
  });

  it("en edicion precarga los valores del producto y no envia el stock", async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();

    render(
      <ProductFormModal
        mode="edit"
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
        product={
          {
            currentCostRef: 1.25,
            currentStock: 7,
            id: "prod-1",
            minStock: 2,
            name: "Harina",
            salePriceRef: 2.5,
            sku: "harina",
          } as Parameters<typeof ProductFormModal>[0]["product"]
        }
      />,
    );

    expect(screen.getByLabelText("Costo ref")).toHaveValue("1.25");
    expect(screen.getByLabelText("Precio ref")).toHaveValue("2.5");
    expect(screen.getByLabelText("Stock actual")).toHaveValue("7");
    expect(screen.getByLabelText("Stock actual")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      currentCostRef: 1.25,
      minStock: 2,
      salePriceRef: 2.5,
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("currentStock");
  });
});
