/** PRO-F13 · M1: la "Descripción" de "Más opciones" se guarda (alta y edición). */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProductFormModal } from "./ProductFormModal";

// Con permiso: el campo de imagen ("Subir imagen") va antes de "Nombre", como en la pantalla.
// El formulario lleva el guardia de cambios sin guardar (`useProcessGuard`), que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

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
type ProductProp = NonNullable<ModalProps["product"]>;

const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};

const savedProduct = {
  categoryId: "cat-1",
  currentCostRef: 1,
  currentStock: 7,
  description: "Harina de trigo\n1 kg",
  id: "prod-1",
  isActive: true,
  minStock: 2,
  name: "Harina",
  salePriceRef: 2,
  sku: "harina",
} as ProductProp;

function renderModal(props: ModalProps = {}) {
  const user = userEvent.setup({ delay: null });
  const onSubmit = jest.fn();

  render(
    <ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open {...props} />,
  );

  return { onSubmit, user };
}

async function openMoreOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Más opciones/ }));
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Nombre"));
  await user.paste("Harina");
  await user.type(screen.getByLabelText("Precio REF"), "2");
}

describe("ProductFormModal · descripción (PRO-F13 · M1)", () => {
  it("el alta envía la descripción escrita, saneada", async () => {
    const { onSubmit, user } = renderModal();

    await fillRequired(user);
    await openMoreOptions(user);
    await user.click(screen.getByLabelText("Descripción"));
    await user.paste("  Harina de trigo\u0000 1 kg  ");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      description: "Harina de trigo 1 kg",
      name: "Harina",
    });
  });

  it.each<[string, ModalProps]>([
    ["el alta sin descripción", {}],
    ["el alta rápida (compact), que no la muestra", { compact: true }],
  ])("%s no la envía", async (_case, props) => {
    const { onSubmit, user } = renderModal(props);

    if (props.compact) {
      expect(screen.queryByLabelText("Descripción")).toBeNull();
    }

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("description");
  });

  it("limita la descripción a 500 caracteres y muestra el contador", async () => {
    const { user } = renderModal();

    await openMoreOptions(user);

    const description = screen.getByLabelText("Descripción");

    expect(description).toHaveAttribute("maxlength", "500");
    expect(screen.getByText("0/500")).toBeVisible();

    await user.click(description);
    await user.paste("Fina");

    expect(screen.getByText("4/500")).toBeVisible();
  });

  it("la edición precarga la descripción y envía el cambio", async () => {
    const { onSubmit, user } = renderModal({ mode: "edit", product: savedProduct });

    await openMoreOptions(user);

    const description = screen.getByLabelText("Descripción");

    expect(description).toHaveValue("Harina de trigo\n1 kg");

    await user.clear(description);
    await user.click(description);
    await user.paste("Harina integral");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ description: "Harina integral" });
  });

  it("vaciar la descripción en la edición envía `null`", async () => {
    const { onSubmit, user } = renderModal({ mode: "edit", product: savedProduct });

    await openMoreOptions(user);
    await user.clear(screen.getByLabelText("Descripción"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toHaveProperty("description", null);
  });

  it("la edición con 'Más opciones' cerrada conserva la descripción: no viaja ni vacía ni `null`", async () => {
    const { onSubmit, user } = renderModal({ mode: "edit", product: savedProduct });

    expect(screen.getByRole("button", { name: /Más opciones/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("description");
  });

  it("'Guardar y crear otro' deja la descripción vacía para el siguiente producto", async () => {
    const { onSubmit, user } = renderModal();

    onSubmit.mockResolvedValue({ ...savedProduct });
    await fillRequired(user);
    await openMoreOptions(user);
    await user.click(screen.getByLabelText("Descripción"));
    await user.paste("Fina");
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(screen.getByLabelText("Descripción")).toHaveValue("");
  });
});
