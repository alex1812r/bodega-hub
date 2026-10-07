import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("ProductImportRowEditModal · stocks enteros (SHR-09J)", () => {
  it.each([
    ["Stock inicial", "2.5"],
    ["Stock inicial", "2,5"],
    ["Stock mínimo", "2.5"],
  ])("%s = %s: se ve 2.5, avisa y no guarda (ni con Enter ni con el boton)", async (label, typed) => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    const onSave = jest.fn();

    render(
      <ProductImportRowEditModal categories={[]} onOpenChange={onOpenChange} onSave={onSave} open row={row} />,
    );

    const field = await screen.findByLabelText(label);

    await user.clear(field);
    await user.type(field, `${typed}{Enter}`);

    expect(field).toHaveValue("2.5");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();

    // El pie queda fuera del <form>: el envio implicito de Enter se simula aparte.
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await user.click(screen.getByRole("button", { name: "Guardar fila" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(field).toHaveFocus();
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
  });

  it("stocks enteros: guarda una vez con el borrador de siempre", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();

    render(
      <ProductImportRowEditModal categories={[]} onOpenChange={jest.fn()} onSave={onSave} open row={row} />,
    );

    const stock = await screen.findByLabelText("Stock inicial");

    await user.clear(stock);
    await user.type(stock, "3{Enter}");
    await user.click(screen.getByRole("button", { name: "Guardar fila" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ ...draft, stock_inicial: "3" });
  });
});
