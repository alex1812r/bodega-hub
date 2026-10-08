/**
 * PRO-F4 · envío implícito del alta de producto y campos a la vista al abrir.
 *
 * Enter dentro de un campo (o un lector que envía Enter en "Código de barras")
 * hace lo que el navegador llama envío implícito: activa el PRIMER botón de
 * envío del formulario en orden de documento. Ese botón debe ser siempre el
 * principal ("Crear producto"), nunca "Guardar y crear otro".
 *
 * user-event no reproduce el envío implícito cuando los botones viven fuera del
 * <form> (el pie del modal los asocia con `form=`), así que aquí se hace lo que
 * hace el navegador: `requestSubmit` con el botón por defecto del formulario.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

// Con permiso: el campo de imagen y "+ Nueva categoría" se pintan, como para un administrador.
jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

// Sin configuración de la tienda: el formulario usa los chips y el semáforo por defecto.
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));

jest.mock("../../hooks/useProducts", () => ({
  useProducts: () => ({ data: undefined }),
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type Product = NonNullable<ProductFormModalProps["product"]>;

const created = {
  categoryId: "cat-1",
  currentStock: 0,
  id: "prod-new",
  isActive: true,
  minStock: 0,
  name: "Harina",
  salePriceRef: 2,
  sku: "harina",
} as Product;

function getForm() {
  return document.querySelector("form") as HTMLFormElement;
}

/** El botón que el navegador activa con Enter: el primer botón de envío habilitado del formulario. */
function getDefaultButton() {
  return Array.from(getForm().elements).find(
    (element): element is HTMLButtonElement =>
      element instanceof HTMLButtonElement && element.type === "submit" && !element.disabled,
  );
}

/** Enter en un campo de texto: envío implícito con el botón por defecto. */
function pressEnterIn(field: HTMLElement) {
  field.focus();
  getForm().requestSubmit(getDefaultButton());
}

/** Campos que el usuario ve al abrir (sin los ocultos ni los de una sección cerrada). */
function visibleFields() {
  return Array.from(getForm().elements).filter(
    (element) =>
      (element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) &&
      element.type !== "hidden" &&
      !element.closest("[hidden]"),
  );
}

// PRO-F10: la Categoría es obligatoria en el alta; estas pruebas abren con una ya elegida.
const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};

describe("ProductFormModal · Enter equivale al botón principal (PRO-F4)", () => {
  it("el botón por defecto del alta completa es Crear producto, no Guardar y crear otro", () => {
    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} open />);

    expect(getDefaultButton()).toHaveTextContent("Crear producto");
    expect(screen.getByRole("button", { name: "Guardar y crear otro" })).not.toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("Enter en Código de barras (lector) crea el producto y cierra, como el botón principal", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open />);

    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
    await user.click(screen.getByLabelText("Código de barras"));
    await user.paste("7591234567890");
    pressEnterIn(screen.getByLabelText("Código de barras"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ barcode: "7591234567890", name: "Harina" });
  });

  it("Enter en Código de barras con el nombre vacío no crea nada: Nombre es obligatorio", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn();

    render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open />);

    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
    await user.click(screen.getByLabelText("Código de barras"));
    await user.paste("7591234567890");
    pressEnterIn(screen.getByLabelText("Código de barras"));

    expect(screen.getByLabelText("Nombre")).toBeRequired();
    expect(screen.getByLabelText("Nombre")).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Código de barras")).toHaveValue("7591234567890");
  });

  it("Guardar y crear otro con el nombre vacío tampoco crea nada ni deja el siguiente Enter marcado", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open />);

    await user.click(screen.getByLabelText("Precio REF"));
    await user.paste("2");
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    expect(onSubmit).not.toHaveBeenCalled();

    // El intento fallido no se queda pendiente: el Enter siguiente guarda y CIERRA.
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Harina");
    pressEnterIn(screen.getByLabelText("Nombre"));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Guardar y crear otro sigue funcionando con clic y con Enter o Espacio sobre el botón", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open />);

    for (const key of ["{Enter}", " "]) {
      await user.click(screen.getByLabelText("Nombre"));
      await user.paste("Harina");
      await user.click(screen.getByLabelText("Precio REF"));
      await user.paste("2");
      screen.getByRole("button", { name: "Guardar y crear otro" }).focus();
      await user.keyboard(key);

      await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    }

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("en compact y en edición el único botón de envío es el principal", () => {
    const compact = render(<ProductFormModal {...withCategory} compact onOpenChange={jest.fn()} open />);

    expect(getDefaultButton()).toHaveTextContent("Crear producto");
    compact.unmount();

    render(<ProductFormModal {...withCategory} mode="edit" onOpenChange={jest.fn()} open product={created} />);

    expect(getDefaultButton()).toHaveTextContent("Guardar cambios");
  });
});

describe("ProductFormModal · campos a la vista al abrir Nuevo producto (PRO-F4)", () => {
  function labels() {
    return visibleFields().map(
      (field) => (field as HTMLInputElement).labels?.[0]?.textContent?.trim() || field.getAttribute("type"),
    );
  }

  it("alta completa: 6 campos (imagen, Nombre, Categoría, Código de barras, Costo REF, Precio REF)", () => {
    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} open />);

    expect(visibleFields()).toHaveLength(6);
    expect(labels().slice(1)).toEqual([
      "Nombre",
      "Categoría",
      "Código de barras",
      "Costo REF",
      "Precio REF",
    ]);
    expect((visibleFields()[0] as HTMLInputElement).type).toBe("file");
    // Los % recomendados siguen a un clic, como botones.
    for (const chip of ["12 %", "20 %", "30 %", "Otro %"]) {
      expect(screen.getByRole("button", { name: chip })).toBeVisible();
    }
  });

  it("compact: 5 campos (Nombre, Categoría, Código de barras, Costo REF, Precio REF)", () => {
    render(<ProductFormModal {...withCategory} compact onOpenChange={jest.fn()} open />);

    expect(labels()).toEqual(["Nombre", "Categoría", "Código de barras", "Costo REF", "Precio REF"]);
    expect(screen.getByRole("button", { name: "Otro %" })).toBeVisible();
  });
});
