import "@testing-library/jest-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { type ProductWithCategory, useProduct } from "../../hooks/useProducts";
import { ProductFormModal } from "./ProductFormModal";

/** PRO-03 · botón "Ajustar stock" junto al stock bloqueado del formulario de producto. */

const mockGrantedPermissions = new Set<string>();

jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children, permission }: { children: React.ReactNode; permission: string }) =>
    mockGrantedPermissions.has(permission) ? children : null,
}));

jest.mock("../../services/uploadProductImage", () => ({
  removeProductImage: jest.fn(),
  uploadProductImageBlob: jest.fn(),
}));

type UserSession = ReturnType<typeof userEvent.setup>;

const baseProduct = {
  barcode: "7591234567890",
  categoryId: "cat-1",
  currentCostRef: 10,
  currentStock: 7,
  id: "prod-1",
  isActive: true,
  minStock: 2,
  name: "Caja Cola x6",
  salePriceRef: 12.5,
  sku: "caja-cola",
} as ProductWithCategory;

/** Catálogo que responde el `fetch` de prueba: el detalle del producto y nada más. */
function installApi() {
  const server = { currentStock: baseProduct.currentStock };
  const gets: string[] = [];
  const api = installFetchStub((url) => {
    gets.push(url);

    return url.startsWith("/api/products/prod-1")
      ? { ...baseProduct, currentStock: server.currentStock }
      : { items: [], limit: 100, skip: 0, total: 0 };
  });

  return { ...api, gets, server };
}

type HarnessProps = {
  onOpenChange?: (open: boolean) => void;
  onSubmit?: jest.Mock;
};

/** Como las páginas de Productos: el formulario edita el producto de la query de detalle. */
function EditHarness({ onOpenChange, onSubmit }: HarnessProps) {
  const product = useProduct(baseProduct.id);

  return product.data ? (
    <ProductFormModal
      mode="edit"
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      open
      product={product.data}
    />
  ) : null;
}

async function renderEdit(props: HarnessProps = {}) {
  const user = userEvent.setup({ delay: null });

  render(<EditHarness {...props} />, { wrapper: createQueryWrapper() });
  await user.click(await screen.findByRole("button", { name: /Más opciones/ }));

  return user;
}

function adjustmentDialog() {
  return screen.getByRole("dialog", { name: "Ajuste de stock" });
}

/** CNF-08: el ajuste pide motivo y se confirma con su efecto antes de registrarse. */
async function continueAndConfirm(user: UserSession, dialog: ReturnType<typeof within>) {
  await user.click(dialog.getByLabelText("Motivo"));
  await user.paste("Conteo físico");
  await user.click(dialog.getByRole("button", { name: "Continuar" }));

  const confirmation = within(
    await screen.findByRole("dialog", { name: "Confirmar ajuste de stock" }),
  );

  expect(confirmation.getByText("Conteo físico")).toBeInTheDocument();
  await user.click(confirmation.getByRole("button", { name: "Registrar movimiento" }));
}

async function openAdjustment(user: UserSession) {
  await user.click(screen.getByRole("button", { name: "Ajustar stock" }));

  return within(adjustmentDialog());
}

beforeEach(() => {
  mockGrantedPermissions.clear();
  mockGrantedPermissions.add("inventory.manage");
});

describe("ProductFormModal · Ajustar stock (PRO-03)", () => {
  it("en edición con inventory.manage muestra el botón junto al stock, que sigue bloqueado", async () => {
    installApi();
    await renderEdit();

    const stock = screen.getByLabelText("Stock actual");

    expect(stock).toHaveValue("7");
    expect(stock).toBeDisabled();
    expect(stock).toHaveAttribute("readonly");
    expect(stock).not.toHaveAttribute("name");
    expect(stock).toHaveAccessibleDescription(
      "Se corrige desde Inventario con un ajuste, para que quede registrado el movimiento.",
    );
    expect(screen.getByRole("button", { name: "Ajustar stock" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Ajuste de stock" })).not.toBeInTheDocument();
  });

  it("sin inventory.manage no hay botón, aunque pueda editar el producto", async () => {
    installApi();
    mockGrantedPermissions.clear();
    mockGrantedPermissions.add("products.manage");
    await renderEdit();

    expect(screen.getByLabelText("Stock actual")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Ajustar stock" })).not.toBeInTheDocument();
  });

  it("en el alta no hay botón: el stock inicial se escribe en el formulario", async () => {
    const user = userEvent.setup({ delay: null });

    installApi();
    render(<ProductFormModal onOpenChange={jest.fn()} open />, { wrapper: createQueryWrapper() });
    await user.click(screen.getByRole("button", { name: /Más opciones/ }));

    expect(screen.getByLabelText("Stock inicial")).toBeEnabled();
    expect(screen.getByLabelText("Stock inicial")).toHaveAttribute("name", "currentStock");
    expect(screen.queryByLabelText("Stock actual")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajustar stock" })).not.toBeInTheDocument();
  });

  it("abre el ajuste con el producto precargado y bloqueado, sin cargar el catálogo", async () => {
    const api = installApi();
    const user = await renderEdit();
    const dialog = await openAdjustment(user);
    const productField = dialog.getByLabelText("Producto");

    expect(productField).toHaveValue("Caja Cola x6 (caja-cola)");
    expect(productField).toBeDisabled();
    expect(productField).toHaveAttribute("readonly");
    expect(productField.tagName).toBe("INPUT");
    expect(dialog.getByText("Stock actual:")).toHaveTextContent("Stock actual: 7");
    expect(api.gets.some((url) => url.startsWith("/api/inventory"))).toBe(false);
    // El formulario de producto sigue montado debajo, fuera del árbol accesible.
    expect(screen.getByText("Editar producto")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Editar producto" })).not.toBeInTheDocument();
  });

  it("al registrar el ajuste refresca el Stock actual sin perder lo escrito ni cerrar el formulario", async () => {
    const api = installApi();
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn();
    const user = await renderEdit({ onOpenChange, onSubmit });

    await user.clear(screen.getByLabelText("Nombre"));
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Caja Cola x12");
    await user.click(screen.getByLabelText("Stock mínimo"));
    await user.keyboard("{Control>}a{/Control}");
    await user.paste("9");

    const dialog = await openAdjustment(user);

    api.server.currentStock = 10;
    api.respondToNextPost({ data: { id: "mov-1" } });
    await user.click(dialog.getByLabelText("Cantidad"));
    await user.paste("3");
    expect(api.posts).toHaveLength(0);
    await continueAndConfirm(user, dialog);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Ajuste de stock" })).not.toBeInTheDocument(),
    );
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]?.url).toBe("/api/inventory/adjustments");
    expect(api.posts[0]?.body).toMatchObject({
      clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      productId: "prod-1",
      quantityDelta: 3,
      reason: "Conteo físico",
      type: "ajuste_entrada",
    });

    await waitFor(() => expect(screen.getByLabelText("Stock actual")).toHaveValue("10"));
    expect(screen.getByLabelText("Stock actual")).toBeDisabled();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Caja Cola x12");
    expect(screen.getByLabelText("Stock mínimo")).toHaveValue("9");
    expect(screen.getByRole("button", { name: /Más opciones/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("dialog", { name: "Editar producto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajustar stock" })).toHaveFocus();
    // Registrar el ajuste no envía ni cierra el formulario del producto.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("tras el ajuste, guardar el producto sigue sin enviar currentStock", async () => {
    const api = installApi();
    const onSubmit = jest.fn();
    const user = await renderEdit({ onSubmit });
    const dialog = await openAdjustment(user);

    api.server.currentStock = 5;
    api.respondToNextPost({ data: { id: "mov-1" } });
    await user.selectOptions(dialog.getByLabelText("Tipo de movimiento"), "ajuste_salida");
    await user.click(dialog.getByLabelText("Cantidad"));
    await user.paste("2");
    await continueAndConfirm(user, dialog);
    await waitFor(() => expect(screen.getByLabelText("Stock actual")).toHaveValue("5"));
    expect(api.posts[0]?.body).toMatchObject({ productId: "prod-1", quantityDelta: -2 });

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("currentStock");
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Caja Cola x6", sku: "caja-cola" });
    expect(api.posts).toHaveLength(1);
  });

  it.each(["Escape", "Cancelar", "Cerrar modal"])(
    "modal sobre modal: cerrar el ajuste con %s deja abierto el formulario y devuelve el foco al botón",
    async (how) => {
      const api = installApi();
      const onOpenChange = jest.fn();
      const user = await renderEdit({ onOpenChange });
      const dialog = await openAdjustment(user);

      // El foco entra en el ajuste, no se queda en el formulario de debajo.
      expect(adjustmentDialog()).toContainElement(document.activeElement as HTMLElement);

      if (how === "Escape") {
        await user.keyboard("{Escape}");
      } else {
        await user.click(dialog.getByRole("button", { name: how }));
      }

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Ajuste de stock" })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole("dialog", { name: "Editar producto" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ajustar stock" })).toHaveFocus();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(api.posts).toHaveLength(0);

      // Se puede volver a abrir, limpio.
      const reopened = await openAdjustment(user);

      expect(reopened.getByLabelText("Cantidad")).toHaveValue("");
    },
  );
});
