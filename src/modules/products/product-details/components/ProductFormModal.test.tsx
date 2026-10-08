import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { jsonResponse } from "@/modules/inventory/utils/requestAttempt.testUtils";

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

type UserSession = ReturnType<typeof userEvent.setup>;
type ProductProp = NonNullable<Parameters<typeof ProductFormModal>[0]["product"]>;

/**
 * Vigila los rechazos sin manejar: el formulario captura el de `onSubmit` y
 * no debe quedar ninguno (en el navegador sería un `pageerror` por guardado fallido).
 */
function watchUnhandledRejections() {
  const unhandled = jest.fn();

  process.on("unhandledRejection", unhandled);

  return {
    /** Node avisa de un rechazo sin manejar en el turno siguiente: se le da ese turno. */
    async settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    stop() {
      process.off("unhandledRejection", unhandled);
    },
    unhandled,
  };
}

function moreOptionsToggle() {
  return screen.getByRole("button", { name: /Más opciones/ });
}

async function openMoreOptions(user: UserSession) {
  await user.click(moreOptionsToggle());
  expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
}

/** Etiquetas de los campos que el usuario ve, en orden (sin los de una sección cerrada). */
function visibleFieldLabels() {
  const form = document.querySelector("form") as HTMLFormElement;

  return Array.from(form.elements)
    .filter(
      (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
        (element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement) &&
        !element.closest("[hidden]"),
    )
    .map((element) => element.labels?.[0]?.textContent?.trim());
}

describe("ProductFormModal · NumberInput (SHR-09)", () => {
  it("al enviar con Enter los precios con 3 decimales viajan redondeados a 2 y los stocks como enteros", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await openMoreOptions(user);

    const cost = screen.getByLabelText("Costo REF");
    const price = screen.getByLabelText("Precio REF");
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
    await user.type(screen.getByLabelText("Stock mínimo"), "3");
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

    expect(screen.getByLabelText("Costo REF")).toHaveValue("1.25");
    expect(screen.getByLabelText("Precio REF")).toHaveValue("2.5");
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
    await openMoreOptions(user);

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByLabelText("SKU"));
    await user.paste("harina");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");

    return { onSubmit, user };
  }

  it.each([
    ["Stock inicial", "2.5"],
    ["Stock inicial", "2,5"],
    ["Stock mínimo", "2.5"],
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
    await user.type(screen.getByLabelText("Stock mínimo"), "2.0{Enter}");
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
    ["1", "Indica unidades por empaque (mínimo 2)."],
    ["0", "Indica unidades por empaque (mínimo 2)."],
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
    expect(screen.queryByText("Indica unidades por empaque (mínimo 2).")).not.toBeInTheDocument();
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

describe("ProductFormModal · dos niveles (PRO-01)", () => {
  const BASIC_FIELDS = ["Nombre", "Categoría", "Código de barras", "Precio REF", "Costo REF"];
  const packProduct = {
    barcode: "7591234567890",
    categoryId: "cat-1",
    currentCostRef: 10,
    currentStock: 7,
    id: "prod-1",
    minStock: 2,
    name: "Caja Cola x6",
    packConversion: {
      id: "conv-1",
      linkedProduct: { id: "prod-2", name: "Cola", salePriceRef: 2.5, sku: "cola" },
      role: "pack",
      unitsPerPack: 6,
    },
    salePriceRef: 12.5,
    sku: "caja-cola",
  } as ProductProp;
  const categories = [{ id: "cat-1", name: "Bebidas" }] as NonNullable<
    Parameters<typeof ProductFormModal>[0]["categories"]
  >;

  async function fillBasics(user: UserSession) {
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
  }

  it("al abrir un alta solo se ven los 5 campos basicos y Mas opciones esta cerrada", () => {
    render(<ProductFormModal onOpenChange={jest.fn()} open />);

    expect(visibleFieldLabels()).toEqual(BASIC_FIELDS);
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("SKU, descripción, stock y empaque")).toBeVisible();
    expect(screen.getByLabelText("SKU")).not.toBeVisible();
    expect(screen.getByLabelText("Stock inicial")).not.toBeVisible();
  });

  it("al abrir Mas opciones aparecen SKU, Descripcion, Stock inicial, Stock minimo y el empaque", async () => {
    const user = userEvent.setup({ delay: null });

    render(<ProductFormModal onOpenChange={jest.fn()} open />);
    await openMoreOptions(user);

    expect(visibleFieldLabels()).toEqual([
      ...BASIC_FIELDS,
      "SKU",
      "Descripción",
      "Stock inicial",
      "Stock mínimo",
      "Se puede vender por unidad",
    ]);
    expect(screen.getByLabelText("SKU")).toBeVisible();
    expect(screen.getByLabelText("SKU")).not.toHaveAttribute("aria-required");
    expect(screen.getByLabelText("SKU")).toHaveAccessibleDescription(
      "Código interno; si tienes código de barras, úsalo. Si lo dejas vacío se genera solo.",
    );
    expect(
      screen.getByText(
        "Código interno; si tienes código de barras, úsalo. Si lo dejas vacío se genera solo.",
      ),
    ).toBeVisible();
  });

  it("edicion sin abrir Mas opciones: envia el mismo payload, con los campos de la seccion cerrada y sin stock", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn().mockResolvedValue(packProduct);
    const onCreated = jest.fn();

    render(
      <ProductFormModal
        categories={categories}
        mode="edit"
        onCreated={onCreated}
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
        product={packProduct}
      />,
    );

    expect(visibleFieldLabels()).toEqual(BASIC_FIELDS);
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("SKU caja-cola · Stock actual 7")).toBeVisible();

    const stock = screen.getByLabelText("Stock actual");

    expect(stock).toHaveValue("7");
    expect(stock).toBeDisabled();
    expect(stock).toHaveAttribute("readonly");
    expect(stock).not.toHaveAttribute("name");
    expect(stock).toHaveAccessibleDescription(
      "Se corrige desde Inventario con un ajuste, para que quede registrado el movimiento.",
    );

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      barcode: "7591234567890",
      categoryId: "cat-1",
      currentCostRef: 10,
      minStock: 2,
      name: "Caja Cola x6",
      packConversion: {
        enabled: true,
        mode: "link_existing",
        unitProductId: "prod-2",
        unitsPerPack: 6,
      },
      salePriceRef: 12.5,
      sku: "caja-cola",
    });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("currentStock");
    expect(onSubmit.mock.calls[0][1]).toEqual({ pendingImageBlob: null });
    // `onCreated` es solo del alta.
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("alta sin SKU (PRO-05): envia a la primera, sin SKU, sin abrir Mas opciones ni avisar", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();
    const onOpenChange = jest.fn();

    render(<ProductFormModal onOpenChange={onOpenChange} onSubmit={onSubmit} open />);
    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      barcode: null,
      categoryId: undefined,
      currentCostRef: undefined,
      currentStock: undefined,
      minStock: undefined,
      name: "Harina",
      packConversion: undefined,
      salePriceRef: 2,
      sku: undefined,
    });
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("SKU")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("SKU")).not.toHaveFocus();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("el boton de generar sigue rellenando el SKU desde el nombre y ese SKU viaja", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina PAN 1kg");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
    await openMoreOptions(user);
    await user.click(screen.getByRole("button", { name: /generar/i }));

    expect(screen.getByLabelText("SKU")).toHaveValue("hari-pan-1kg");

    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ sku: "hari-pan-1kg" });
  });

  it("edicion con el SKU borrado (PRO-05): guarda sin SKU para que el servidor conserve el actual", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(
      <ProductFormModal
        categories={categories}
        mode="edit"
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
        product={packProduct}
      />,
    );
    await openMoreOptions(user);
    await user.clear(screen.getByLabelText("SKU"));
    await user.click(moreOptionsToggle());

    // Cerrada, la sección resume el SKU que el producto conserva.
    expect(screen.getByText("SKU caja-cola · Stock actual 7")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toHaveProperty("sku", undefined);
    expect(screen.getByLabelText("SKU")).not.toHaveAttribute("aria-invalid");
  });

  it("stock minimo con decimales y la seccion cerrada: no envia, la abre y enfoca el campo", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillBasics(user);
    await openMoreOptions(user);
    await user.click(screen.getByLabelText("SKU"));
    await user.paste("harina");
    await user.type(screen.getByLabelText("Stock mínimo"), "2.5");
    await user.click(moreOptionsToggle());

    const minStock = screen.getByLabelText("Stock mínimo");

    expect(minStock).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(minStock).toBeVisible();
    expect(minStock).toHaveFocus();
    expect(screen.getByText("Debe ser un número entero.")).toBeVisible();
  });

  it("unidades por empaque invalidas con la seccion cerrada: no envia, la abre, enfoca y avisa", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillBasics(user);
    await openMoreOptions(user);
    await user.click(screen.getByLabelText("SKU"));
    await user.paste("harina");
    await user.click(screen.getByLabelText("Se puede vender por unidad"));
    await user.click(screen.getByLabelText("Precio venta unidad (ref)"));
    await user.paste("1");
    await user.clear(screen.getByLabelText("Unidades por empaque"));
    await user.type(screen.getByLabelText("Unidades por empaque"), "1");
    await user.click(moreOptionsToggle());
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    const units = screen.getByLabelText("Unidades por empaque");

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(units).toHaveFocus();
    expect(screen.getByText("Indica unidades por empaque (mínimo 2).")).toBeVisible();
  });

  it("un required nativo vacio dentro de la seccion cerrada la abre y enfoca el campo en vez de bloquear en silencio", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillBasics(user);
    await openMoreOptions(user);
    await user.click(screen.getByLabelText("SKU"));
    await user.paste("harina");
    await user.click(screen.getByLabelText("Se puede vender por unidad"));
    await user.click(moreOptionsToggle());

    const unitPrice = screen.getByLabelText("Precio venta unidad (ref)");

    expect(unitPrice).toBeRequired();
    expect(unitPrice).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(unitPrice).toBeVisible();
    expect(unitPrice).toHaveFocus();
  });

  it("un basico vacio manda sobre la seccion cerrada: no se abre ni se roba el foco", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("SKU")).not.toHaveFocus();
  });

  it("si onSubmit rechaza el modal no se cierra ni avisa del alta", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onCreated = jest.fn();
    const onSubmit = jest.fn().mockRejectedValue(new Error("SKU duplicado"));
    const rejections = watchUnhandledRejections();

    try {
      render(
        <ProductFormModal
          compact
          onCreated={onCreated}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          open
        />,
      );
      await fillBasics(user);
      await user.click(screen.getByRole("button", { name: "Crear producto" }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      await rejections.settle();
    } finally {
      rejections.stop();
    }

    // El formulario captura el rechazo: el motivo lo pinta el consumidor.
    expect(rejections.unhandled).not.toHaveBeenCalled();

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina");
  });
});

describe("ProductFormModal · modo compact (PRO-01)", () => {
  const categories = [{ id: "cat-1", name: "Bebidas" }] as NonNullable<
    Parameters<typeof ProductFormModal>[0]["categories"]
  >;

  it("solo muestra el nivel basico: sin Mas opciones, sin SKU, sin stock ni empaque", () => {
    render(<ProductFormModal compact onOpenChange={jest.fn()} open />);

    expect(screen.getByRole("dialog", { name: "Nuevo producto" })).toBeInTheDocument();
    expect(visibleFieldLabels()).toEqual([
      "Nombre",
      "Categoría",
      "Código de barras",
      "Precio REF",
      "Costo REF",
    ]);
    expect(screen.queryByRole("button", { name: /Más opciones/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SKU")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Stock inicial")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Se puede vender por unidad")).not.toBeInTheDocument();
    expect(screen.getByText(/el SKU se genera solo/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Crear producto" })).toBeInTheDocument();
  });

  it("precarga initialValues, envia el alta sin SKU (lo pone el servidor) y entrega el producto creado antes de cerrar", async () => {
    const user = userEvent.setup({ delay: null });
    const created = { id: "prod-9", name: "Harina PAN 1kg", sku: "hari-pan-1kg" } as ProductProp;
    const calls: string[] = [];
    const onSubmit = jest.fn().mockResolvedValue(created);
    const onCreated = jest.fn(() => calls.push("created"));
    const onOpenChange = jest.fn((open: boolean) => calls.push(`open:${open}`));

    render(
      <ProductFormModal
        categories={categories}
        compact
        initialValues={{
          barcode: " 7591234567890 ",
          categoryId: "cat-1",
          currentCostRef: 1.5,
          name: "Harina PAN 1kg",
        }}
        onCreated={onCreated}
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        open
      />,
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina PAN 1kg");
    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-1");
    expect(screen.getByLabelText("Código de barras")).toHaveValue(" 7591234567890 ");
    expect(screen.getByLabelText("Costo REF")).toHaveValue("1.5");
    expect(screen.getByLabelText("Precio REF")).toHaveValue("");

    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      barcode: "7591234567890",
      categoryId: "cat-1",
      currentCostRef: 1.5,
      currentStock: undefined,
      minStock: undefined,
      name: "Harina PAN 1kg",
      packConversion: undefined,
      salePriceRef: 2,
      sku: undefined,
    });
    expect(onSubmit.mock.calls[0][1]).toEqual({ pendingImageBlob: null });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(calls).toEqual(["created", "open:false"]);
  });

  it("es siempre un alta: ignora mode=edit y product, y sin producto devuelto no llama a onCreated", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();
    const onCreated = jest.fn();
    const onOpenChange = jest.fn();

    render(
      <ProductFormModal
        compact
        mode="edit"
        onCreated={onCreated}
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        open
        product={{ id: "prod-1", name: "Viejo", salePriceRef: 9, sku: "viejo" } as ProductProp}
      />,
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("");

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Azúcar");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("3");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Azúcar", salePriceRef: 3 });
    expect(onSubmit.mock.calls[0][0]).toHaveProperty("currentStock", undefined);
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("ProductFormModal · fallos de QA (PRO-F1)", () => {
  const LONG_SKU = "refresco-cola-caja-x12-retornable-350ml";
  const linkedPackProduct = {
    currentStock: 7,
    id: "prod-1",
    name: "Caja Cola x6",
    packConversion: {
      id: "conv-1",
      linkedProduct: { id: "prod-2", name: "Cola", salePriceRef: 2.5, sku: "cola" },
      role: "pack",
      unitsPerPack: 6,
    },
    salePriceRef: 12.5,
    sku: "caja-cola",
  } as ProductProp;

  async function fillBasics(user: UserSession) {
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
  }

  async function enableLinkExisting(user: UserSession) {
    await openMoreOptions(user);
    await user.click(screen.getByLabelText("Se puede vender por unidad"));
    await user.selectOptions(screen.getByLabelText("Modo de vínculo"), "link_existing");
  }

  function unitField() {
    // `hidden`: también con "Más opciones" cerrada, donde el campo sigue montado.
    return screen.getByRole("combobox", { hidden: true, name: /Producto unidad/ });
  }

  /** `GET /api/products` con un único producto libre; devuelve las URL pedidas. */
  function installProductsApi() {
    const urls: URL[] = [];
    const drill = {
      barcode: "7501234567890",
      categoryId: "cat-1",
      currentCostRef: 40,
      currentStock: 5,
      id: "prod-drill",
      isActive: true,
      name: "Taladro percutor",
      salePriceRef: 60,
      sku: "her-tal-001",
    };

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      urls.push(new URL(String(input), "http://localhost"));

      return Promise.resolve(
        jsonResponse({ data: { items: [drill], limit: 9, skip: 0, total: 1 } }),
      );
    }) as unknown as typeof fetch;

    return urls;
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("edicion con un SKU largo: el resumen de Mas opciones se trunca y no ensancha el formulario", () => {
    render(
      <ProductFormModal
        mode="edit"
        onOpenChange={jest.fn()}
        open
        product={
          {
            currentStock: 7,
            id: "prod-1",
            name: "Refresco",
            salePriceRef: 2.5,
            sku: LONG_SKU,
          } as ProductProp
        }
      />,
    );

    const summary = screen.getByText(`SKU ${LONG_SKU} · Stock actual 7`);

    // El texto completo sigue disponible aunque se corte con puntos suspensivos.
    expect(summary).toHaveAttribute("title", `SKU ${LONG_SKU} · Stock actual 7`);
    expect(summary).toHaveClass("truncate");
    // La seccion es un item del grid del formulario: sin `min-w-0` su ancho
    // minimo es el del resumen en una sola linea y desborda el modal.
    expect(moreOptionsToggle().closest("section")).toHaveClass("min-w-0");
  });

  it("empaque en modo vincular sin producto unidad y la seccion cerrada: no envia, la abre, avisa y enfoca el campo", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillBasics(user);
    await enableLinkExisting(user);

    expect(screen.queryByText("Elige el producto unidad.")).not.toBeInTheDocument();

    await user.click(moreOptionsToggle());
    expect(unitField()).not.toBeVisible();

    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(unitField()).toBeVisible();
    expect(unitField()).toHaveFocus();
    expect(unitField()).toHaveAttribute("aria-invalid", "true");
    expect(unitField()).toHaveAccessibleDescription("Elige el producto unidad.");
  });

  it("edicion de un empaque al que se le quita la unidad: no envia y enfoca el campo", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(
      <ProductFormModal
        mode="edit"
        onOpenChange={jest.fn()}
        onSubmit={onSubmit}
        open
        product={linkedPackProduct}
      />,
    );
    await openMoreOptions(user);
    await user.click(screen.getByRole("button", { name: "Limpiar Producto unidad" }));
    await user.click(moreOptionsToggle());
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(unitField()).toHaveFocus();
    expect(screen.getByText("Elige el producto unidad.")).toBeVisible();
  });

  it("dos Enter y un clic mientras el guardado sigue en vuelo: un solo envio", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    let finishSave: () => void = () => undefined;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    // `isSubmitting` no llega a cambiar: el candado es del propio formulario.
    render(<ProductFormModal onOpenChange={onOpenChange} onSubmit={onSubmit} open />);
    await fillBasics(user);

    const form = document.querySelector("form") as HTMLFormElement;

    fireEvent.submit(form);
    fireEvent.submit(form);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => finishSave());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("con isSubmitting el formulario ignora el envio", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    render(<ProductFormModal isSubmitting onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fillBasics(user);
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("tras un guardado rechazado se puede reintentar y la misma busqueda de unidad vuelve al servidor", async () => {
    const user = userEvent.setup();
    const urls = installProductsApi();
    const onSubmit = jest
      .fn()
      .mockRejectedValue(new Error("El producto unidad ya está vinculado a otro empaque."));
    const rejections = watchUnhandledRejections();

    try {
      render(<ProductFormModal onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
      await fillBasics(user);
      await enableLinkExisting(user);
      await user.type(unitField(), "taladro");
      await user.click(await screen.findByRole("option", { name: /Taladro percutor/ }));

      const requestsPerSearch = urls.length;

      await user.click(screen.getByRole("button", { name: "Crear producto" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      await rejections.settle();

      // El campo conserva la unidad elegida; al repetir la busqueda se vuelve a pedir.
      expect(unitField()).toHaveValue("Taladro percutor");

      await user.click(screen.getByRole("button", { name: "Limpiar Producto unidad" }));
      await user.type(unitField(), "taladro");
      await screen.findByRole("option", { name: /Taladro percutor/ });

      expect(urls.length).toBe(requestsPerSearch * 2);

      await user.click(screen.getByRole("option", { name: /Taladro percutor/ }));
      await user.click(screen.getByRole("button", { name: "Crear producto" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
      await rejections.settle();
    } finally {
      rejections.stop();
    }

    expect(rejections.unhandled).not.toHaveBeenCalled();
  });
});
