import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import { ProductFormModal, type ProductFormModalProps } from "./ProductFormModal";

/** PRO-04 · aviso "Producto creado" con enlace al detalle tras un alta. */

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

type Product = NonNullable<ProductFormModalProps["product"]>;

const created = {
  categoryId: "cat-1",
  currentStock: 0,
  id: "prod-new",
  isActive: true,
  minStock: 0,
  name: "Harina PAN 1 kg",
  salePriceRef: 2,
  sku: "harina-pan-1-kg",
} as Product;

function renderForm(props: Partial<ProductFormModalProps> = {}) {
  render(
    <ToastProvider>
      <ProductFormModal onOpenChange={jest.fn()} open {...props} />
    </ToastProvider>,
  );

  return userEvent.setup({ delay: null });
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Nombre"));
  await user.paste("Harina");
  await user.click(screen.getByLabelText("Precio REF"));
  await user.paste("2");
}

function toasts() {
  return within(screen.getByRole("status"));
}

describe("ProductFormModal · aviso de producto creado (PRO-04)", () => {
  it("el botón principal avisa con el nombre guardado y el enlace Ver al detalle", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);
    const user = renderForm({ onOpenChange, onSubmit });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(await toasts().findByText("Producto creado: Harina PAN 1 kg")).toBeInTheDocument();
    expect(toasts().getByRole("link", { name: "Ver" })).toHaveAttribute("href", "/products/prod-new");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Guardar y crear otro avisa con el modal aún abierto, sin quitar el foco de Nombre, y apila un aviso por alta", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest
      .fn()
      .mockResolvedValueOnce(created)
      .mockResolvedValueOnce({ ...created, id: "prod-2", name: "Arroz" });
    const user = renderForm({ onOpenChange, onSubmit });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    expect(await toasts().findByText("Producto creado: Harina PAN 1 kg")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    expect(await toasts().findByText("Producto creado: Arroz")).toBeInTheDocument();
    expect(
      toasts()
        .getAllByRole("link", { name: "Ver" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/products/prod-new", "/products/prod-2"]);
  });

  it("si onSubmit no devuelve el producto, avisa con el nombre escrito y sin enlace", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderForm({ onSubmit });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(await toasts().findByText("Producto creado: Harina")).toBeInTheDocument();
    expect(toasts().queryByRole("link")).not.toBeInTheDocument();
  });

  it("si el guardado falla no avisa de ningún alta", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error("Ya existe un producto con ese SKU."));
    const user = renderForm({ onSubmit });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina");
  });

  it("showCreatedToast={false} lo apaga en el alta completa", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);
    const user = renderForm({ onOpenChange, onSubmit, showCreatedToast: false });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("compact no avisa por defecto: lo decide el consumidor", async () => {
    const onCreated = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);
    const user = renderForm({ compact: true, onCreated, onSubmit });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("compact con showCreatedToast avisa igual que el alta completa", async () => {
    const onSubmit = jest.fn().mockResolvedValue(created);
    const user = renderForm({ compact: true, onSubmit, showCreatedToast: true });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(await toasts().findByText("Producto creado: Harina PAN 1 kg")).toBeInTheDocument();
    expect(toasts().getByRole("link", { name: "Ver" })).toHaveAttribute("href", "/products/prod-new");
  });

  it("la edición no avisa, ni pidiéndolo", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(
      <ToastProvider>
        <ProductFormModal
          mode="edit"
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          open
          product={created}
          showCreatedToast
        />
      </ToastProvider>,
    );

    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("sin ToastProvider el alta funciona igual", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(<ProductFormModal onOpenChange={onOpenChange} onSubmit={onSubmit} open />);

    const user = userEvent.setup({ delay: null });

    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/Producto creado/)).not.toBeInTheDocument();
  });
});
