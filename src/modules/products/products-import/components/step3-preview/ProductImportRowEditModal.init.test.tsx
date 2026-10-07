import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProductImportValidatedRow } from "../../types";
import { ProductImportRowEditModal } from "./ProductImportRowEditModal";

jest.mock("../../services/validateProductImportRows", () => ({
  validatedRowToDraft: (row: { rowIndex: number }) => ({
    categoryId: "",
    codigo_barras: "",
    costo_ref: "1",
    nombre: `Producto ${row.rowIndex}`,
    precio_ref: "2",
    sku: `sku-${row.rowIndex}`,
    stock_inicial: "4",
    stock_minimo: "5",
  }),
}));

const rowTwo = { rowIndex: 2 } as ProductImportValidatedRow;
const rowThree = { rowIndex: 3 } as ProductImportValidatedRow;

function modal(row: ProductImportValidatedRow | null, open: boolean) {
  return (
    <ProductImportRowEditModal
      categories={[]}
      onOpenChange={() => undefined}
      onSave={() => undefined}
      open={open}
      row={row}
    />
  );
}

describe("ProductImportRowEditModal · inicializacion del borrador", () => {
  it("opens with the values of the row", () => {
    render(modal(rowTwo, true));

    expect(screen.getByLabelText("Nombre")).toHaveValue("Producto 2");
    expect(screen.getByLabelText("SKU")).toHaveValue("sku-2");
  });

  it("renders nothing without a row or before it has ever been opened", () => {
    const { rerender } = render(modal(null, true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(modal(rowTwo, false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(modal(rowTwo, true));
    expect(screen.getByLabelText("Nombre")).toHaveValue("Producto 2");
  });

  it("discards unsaved edits when it is closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(rowTwo, true));

    await user.type(screen.getByLabelText("Nombre"), " editado");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Producto 2 editado");

    rerender(modal(rowTwo, false));
    rerender(modal(rowTwo, true));

    expect(screen.getByLabelText("Nombre")).toHaveValue("Producto 2");
  });

  it("loads the new row when the row changes while open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(modal(rowTwo, true));

    await user.type(screen.getByLabelText("Nombre"), " editado");
    rerender(modal(rowThree, true));

    expect(screen.getByLabelText("Nombre")).toHaveValue("Producto 3");
    expect(screen.getByLabelText("SKU")).toHaveValue("sku-3");
  });
});
