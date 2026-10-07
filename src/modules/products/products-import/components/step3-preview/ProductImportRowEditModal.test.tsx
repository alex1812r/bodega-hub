import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProductImportValidatedRow } from "../../types";
import { ProductImportRowEditModal } from "./ProductImportRowEditModal";

const draft = {
  categoryId: "",
  codigo_barras: "",
  costo_ref: "1",
  nombre: "Harina",
  precio_ref: "2",
  sku: "harina",
  stock_inicial: "4",
  stock_minimo: "5",
};

jest.mock("../../services/validateProductImportRows", () => ({
  validatedRowToDraft: () => draft,
}));

const row = { rowIndex: 2 } as ProductImportValidatedRow;

describe("ProductImportRowEditModal · NumberInput (SHR-09)", () => {
  it("precios con 3 decimales se guardan con 2 y los stocks solo admiten enteros", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();

    render(
      <ProductImportRowEditModal categories={[]} onOpenChange={jest.fn()} onSave={onSave} open row={row} />,
    );

    const price = await screen.findByLabelText("Precio ref (USD)");
    const cost = screen.getByLabelText("Costo ref (USD)");
    const stock = screen.getByLabelText("Stock inicial");

    expect(price).toHaveAttribute("type", "text");
    expect(stock).toHaveAttribute("inputmode", "numeric");

    await user.clear(price);
    await user.type(price, "2,345");
    await user.clear(cost);
    await user.type(cost, "1.004");
    await user.clear(stock);
    await user.type(stock, "12");
    await user.click(screen.getByRole("button", { name: "Guardar fila" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      ...draft,
      costo_ref: "1",
      precio_ref: "2.35",
      stock_inicial: "12",
    });
  });
});
