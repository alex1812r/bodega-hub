import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

/** PRO-04 · "Guardar y crear otro" en el alta de producto. */

// El formulario lleva el guardia de cambios sin guardar (`useProcessGuard`), que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../../shared/auth/Can", () => ({
  Can: () => null,
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

type UserSession = ReturnType<typeof userEvent.setup>;
type Product = NonNullable<ProductFormModalProps["product"]>;

const SAVE_BUTTONS = ["Cancelar", "Guardar y crear otro", "Crear producto"];

const categories = [
  { id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 },
  { id: "cat-2", isActive: true, name: "Víveres", taxRate: 16 },
];

const created = {
  categoryId: "cat-2",
  currentStock: 4,
  id: "prod-new",
  isActive: true,
  minStock: 1,
  name: "Harina",
  salePriceRef: 2,
  sku: "harina",
} as Product;

function renderCreate(props: Partial<ProductFormModalProps> = {}) {
  const user = userEvent.setup({ delay: null });

  render(<ProductFormModal {...withCategory} categories={categories} onOpenChange={jest.fn()} open {...props} />);

  return user;
}

function createAnotherButton() {
  return screen.getByRole("button", { name: "Guardar y crear otro" });
}

function moreOptionsToggle() {
  return screen.getByRole("button", { name: /Más opciones/ });
}

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

/** Rellena los dos niveles: lo básico y "Más opciones". */
async function fillEverything(user: UserSession) {
  await paste(user, "Nombre", "Harina");
  await user.selectOptions(screen.getByLabelText("Categoría"), "cat-2");
  await paste(user, "Código de barras", "7591234567890");
  await paste(user, "Precio REF", "2");
  await paste(user, "Costo REF", "1.5");
  await user.click(moreOptionsToggle());
  await paste(user, "SKU", "harina");
  await paste(user, "Stock inicial", "4");
  await paste(user, "Stock mínimo", "1");
}

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

// PRO-F10: la Categoría es obligatoria en el alta; estas pruebas abren con una ya elegida.
const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};

describe("ProductFormModal · Guardar y crear otro (PRO-04)", () => {
  it("solo el alta completa lo ofrece, entre Cancelar y el botón principal", () => {
    const { unmount } = render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} open />);

    // PRO-F4: no es un botón de envío, para que Enter nunca lo elija.
    expect(createAnotherButton()).toHaveAttribute("type", "button");
    expect(
      within(screen.getByRole("dialog"))
        .getAllByRole("button")
        .map((button) => button.textContent ?? "")
        .filter((text) => SAVE_BUTTONS.includes(text)),
    ).toEqual(SAVE_BUTTONS);
    unmount();

    const edit = render(
      <ProductFormModal {...withCategory} mode="edit" onOpenChange={jest.fn()} open product={created} />,
    );

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar y crear otro" })).not.toBeInTheDocument();
    edit.unmount();

    render(<ProductFormModal {...withCategory} compact onOpenChange={jest.fn()} open />);

    expect(screen.getByRole("button", { name: "Crear producto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar y crear otro" })).not.toBeInTheDocument();
  });

  it("guarda, deja el modal abierto y vacío, con el foco en Nombre y la categoría conservada", async () => {
    const onCreated = jest.fn();
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);
    const user = renderCreate({ onCreated, onOpenChange, onSubmit });

    await fillEverything(user);
    await user.click(createAnotherButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      barcode: "7591234567890",
      categoryId: "cat-2",
      currentCostRef: 1.5,
      currentStock: 4,
      minStock: 1,
      name: "Harina",
      salePriceRef: 2,
      sku: "harina",
    });

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(created);

    // La categoría recién usada sigue elegida; todo lo demás vuelve al inicio.
    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-2");
    expect(screen.getByLabelText("Código de barras")).toHaveValue("");
    expect(screen.getByLabelText("Precio REF")).toHaveValue("");
    expect(screen.getByLabelText("Costo REF")).toHaveValue("");
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");

    await user.click(moreOptionsToggle());

    expect(screen.getByLabelText("SKU")).toHaveValue("");
    expect(screen.getByLabelText("Stock inicial")).toHaveValue("");
    expect(screen.getByLabelText("Stock mínimo")).toHaveValue("");

    // El segundo producto viaja con lo nuevo y la misma categoría.
    await paste(user, "Nombre", "Arroz");
    await paste(user, "Precio REF", "3");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    const second = onSubmit.mock.calls[1][0];

    expect(second).toMatchObject({ categoryId: "cat-2", name: "Arroz", salePriceRef: 3 });
    expect(second.barcode).toBeFalsy();
    expect(second.currentStock).toBeUndefined();
    expect(second.sku).toBeUndefined();
    expect(onSubmit.mock.calls[1][1]).toEqual({ pendingImageBlob: null });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("vuelve a los valores iniciales del alta, no a un formulario en blanco", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({
      initialValues: { categoryId: "cat-1", currentCostRef: 1.5 },
      onSubmit,
    });

    await paste(user, "Nombre", "Harina");
    await paste(user, "Precio REF", "2");
    await user.click(createAnotherButton());

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(screen.getByLabelText("Precio REF")).toHaveValue("");
    expect(screen.getByLabelText("Costo REF")).toHaveValue("1.5");
    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-1");
  });

  it("sin categoría elegida no guarda: avisa en el campo y lo enfoca (PRO-F10)", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ initialValues: {}, onSubmit });

    await paste(user, "Nombre", "Harina");
    await paste(user, "Precio REF", "2");
    await user.click(createAnotherButton());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Elige una categoría.")).toBeVisible();
    expect(screen.getByLabelText("Categoría")).toHaveFocus();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina");

    await user.selectOptions(screen.getByLabelText("Categoría"), "cat-2");
    await user.click(createAnotherButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ categoryId: "cat-2", name: "Harina" });
  });

  it("limpia los avisos de un intento anterior", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ onSubmit });

    await paste(user, "Nombre", "Harina");
    await paste(user, "Precio REF", "2");
    await user.click(moreOptionsToggle());
    await paste(user, "Stock mínimo", "1.5");
    await user.click(createAnotherButton());

    // No envía: el stock mínimo no admite decimales.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Stock mínimo")).toHaveFocus();

    await user.clear(screen.getByLabelText("Stock mínimo"));
    await paste(user, "Stock mínimo", "2");
    await user.click(createAnotherButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Stock mínimo")).toHaveValue("");
    expect(screen.getByLabelText("Stock mínimo")).not.toBeInvalid();
  });

  it("si el guardado falla no limpia nada, el modal sigue abierto y se ve el error", async () => {
    const onCreated = jest.fn();
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockRejectedValue(new Error("Ya existe un producto con ese SKU."));
    const rejections = watchUnhandledRejections();
    const props = { categories, onCreated, onOpenChange, onSubmit, open: true };
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ProductFormModal {...withCategory} {...props} />);

    try {
      await fillEverything(user);
      await user.click(createAnotherButton());
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      await rejections.settle();
    } finally {
      rejections.stop();
    }

    expect(rejections.unhandled).not.toHaveBeenCalled();

    // Como las páginas: el motivo llega con el siguiente render.
    rerender(<ProductFormModal {...withCategory} {...props} errorMessage="Ya existe un producto con ese SKU." />);

    expect(screen.getByText("Ya existe un producto con ese SKU.")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina");
    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-2");
    expect(screen.getByLabelText("Precio REF")).toHaveValue("2");
    expect(screen.getByLabelText("SKU")).toHaveValue("harina");
    expect(screen.getByLabelText("Stock inicial")).toHaveValue("4");
    expect(moreOptionsToggle()).toHaveAttribute("aria-expanded", "true");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Se puede reintentar: el candado se suelta tras el fallo.
    onSubmit.mockResolvedValueOnce(created);
    await user.click(createAnotherButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("doble clic y clic en el otro botón con el guardado en vuelo: un solo envío", async () => {
    let finishSave: () => void = () => undefined;
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = renderCreate({ onOpenChange, onSubmit });

    await paste(user, "Nombre", "Harina");
    await paste(user, "Precio REF", "2");
    await user.dblClick(createAnotherButton());
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => finishSave());

    // Manda el primer clic: guardar y seguir, no cerrar.
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("con isSubmitting los dos botones de guardar quedan deshabilitados", () => {
    render(<ProductFormModal {...withCategory} isSubmitting onOpenChange={jest.fn()} open />);

    expect(createAnotherButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  });

  it("el botón principal sigue guardando y cerrando", async () => {
    const onCreated = jest.fn();
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);
    const user = renderCreate({ onCreated, onOpenChange, onSubmit });

    await paste(user, "Nombre", "Harina");
    await paste(user, "Precio REF", "2");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(created);
  });
});
