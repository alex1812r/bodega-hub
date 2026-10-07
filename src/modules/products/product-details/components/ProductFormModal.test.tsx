import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);

    const cost = screen.getByLabelText("Costo ref");
    const price = screen.getByLabelText("Precio ref");
    const stock = screen.getByLabelText("Stock inicial");

    expect(cost).toHaveAttribute("type", "text");
    expect(price).toHaveAttribute("type", "text");
    expect(stock).toHaveAttribute("inputmode", "numeric");

    // Nombre y SKU son texto libre: se pegan de una vez. El tecleo caracter a
    // caracter se reserva para los NumberInput, que es lo que se prueba aqui.
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByLabelText("SKU"));
    await user.paste("harina");
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
    const user = userEvent.setup({ delay: null });
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

describe("ProductFormModal · enteros y limites (SHR-09J)", () => {
  async function renderFilled() {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByLabelText("SKU"));
    await user.paste("harina");
    await user.click(screen.getByLabelText("Precio ref"));
    await user.paste("2");

    return { onSubmit, user };
  }

  it.each([
    ["Stock inicial", "2.5"],
    ["Stock inicial", "2,5"],
    ["Stock minimo", "2.5"],
  ])("%s = %s: se ve 2.5, avisa y no envia (ni con Enter ni con el boton)", async (label, typed) => {
    const { onSubmit, user } = await renderFilled();
    const field = screen.getByLabelText(label);

    await user.type(field, `${typed}{Enter}`);

    expect(field).toHaveValue("2.5");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();

    // El pie queda fuera del <form>: el envio implicito de Enter se simula aparte.
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(field).toHaveValue("2.5");
    expect(field).toHaveFocus();
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
  });

  it("stocks enteros: un solo envio con el payload de siempre", async () => {
    const { onSubmit, user } = await renderFilled();

    await user.type(screen.getByLabelText("Stock inicial"), "3");
    await user.type(screen.getByLabelText("Stock minimo"), "2.0{Enter}");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      barcode: null,
      categoryId: undefined,
      currentCostRef: undefined,
      currentStock: 3,
      minStock: 2,
      name: "Harina",
      packConversion: undefined,
      salePriceRef: 2,
      sku: "harina",
    });
  });

  async function enablePackConversion(user: ReturnType<typeof userEvent.setup>, unitsPerPack: string) {
    await user.click(screen.getByLabelText("Se puede vender por unidad"));
    await user.click(screen.getByLabelText("Precio venta unidad (ref)"));
    await user.paste("1");

    const units = screen.getByLabelText("Unidades por empaque");

    await user.clear(units);
    await user.type(units, `${unitsPerPack}{Enter}`);

    return units;
  }

  it.each([
    ["1", "Indica unidades por empaque (minimo 2)."],
    ["0", "Indica unidades por empaque (minimo 2)."],
    ["2.5", "Debe ser un número entero."],
  ])("unidades por empaque = %s: no envia y muestra el aviso %s", async (typed, message) => {
    const { onSubmit, user } = await renderFilled();
    const units = await enablePackConversion(user, typed);

    fireEvent.submit(units.closest("form") as HTMLFormElement);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(units).toHaveValue(typed);
    expect(units).toHaveAttribute("aria-invalid", "true");
    expect(units).toHaveAccessibleDescription(message);
    expect(screen.getByText(message)).toBeVisible();
    expect(units).toHaveFocus();
  });

  it("unidades por empaque: el aviso de minimo no aparece antes de intentar enviar", async () => {
    const { user } = await renderFilled();
    const units = await enablePackConversion(user, "1");

    expect(units).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Indica unidades por empaque (minimo 2).")).not.toBeInTheDocument();
  });

  it("unidades por empaque = 2: un solo envio con el payload de siempre", async () => {
    const { onSubmit, user } = await renderFilled();

    await enablePackConversion(user, "2");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].packConversion).toEqual({
      enabled: true,
      mode: "create_unit",
      unitProduct: { barcode: null, name: undefined, salePriceRef: 1, sku: undefined },
      unitsPerPack: 2,
    });
  });
});
