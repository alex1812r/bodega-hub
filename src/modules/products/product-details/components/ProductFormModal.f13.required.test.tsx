/**
 * PRO-F13 · formulario de producto:
 * - B1: al abrir un alta el foco va a "Nombre".
 * - B2: "Nombre" vacío avisa con mensaje propio, no con el globo del navegador.
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductFormModal } from "./ProductFormModal";

// Con permiso: el campo de imagen ("Subir imagen") va antes de "Nombre", como en la pantalla.
jest.mock("../../../../shared/auth/Can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

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

type ModalProps = Parameters<typeof ProductFormModal>[0];

const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};

function renderModal(props: ModalProps = {}) {
  const user = userEvent.setup({ delay: null });
  const onSubmit = jest.fn();

  render(
    <ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open {...props} />,
  );

  return { onSubmit, user };
}

describe("ProductFormModal · foco inicial (PRO-F13 · B1)", () => {
  it("al abrir un alta el foco va a 'Nombre', no a 'Subir imagen'", async () => {
    renderModal();

    expect(screen.getByRole("button", { name: "Subir imagen" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());
  });
});

describe("ProductFormModal · nombre obligatorio (PRO-F13 · B2)", () => {
  it("sin nombre avisa en el campo con mensaje propio, lo enfoca y no envía", async () => {
    const { onSubmit, user } = renderModal();
    const name = screen.getByLabelText("Nombre");

    await user.type(screen.getByLabelText("Precio REF"), "2");

    // El navegador lanza `invalid` en cada campo que no vale; sin cancelarlo pinta su globo.
    const notCancelled = fireEvent.invalid(name);

    expect(notCancelled).toBe(false);
    expect(screen.getByText("Escribe el nombre del producto.")).toBeVisible();
    expect(name).toHaveFocus();
    expect(name).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(name);
    await user.paste("Harina");

    expect(screen.queryByText("Escribe el nombre del producto.")).toBeNull();
  });
});
