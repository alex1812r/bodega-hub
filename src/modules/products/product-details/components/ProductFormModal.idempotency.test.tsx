import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { ProductFormModal } from "./ProductFormModal";

/**
 * PRO-F9 · ALTA-2: el alta de producto lleva una clave de idempotencia por
 * intento. Antes, el POST llegaba al servidor, la respuesta se perdía, el
 * formulario seguía abierto con "Failed to fetch" y el segundo clic creaba otro
 * producto con su stock inicial (2 productos y 18 u por 9).
 */

// El formulario lleva el guardia de cambios sin guardar (`useProcessGuard`), que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true }),
}));
jest.mock("../../../settings/hooks/useSettings", () => ({
  usePricingSettings: () => ({ data: undefined }),
}));
jest.mock("../../hooks/useProducts", () => ({
  ...jest.requireActual("../../hooks/useProducts"),
  useCreateCategory: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useCreateProduct: () => ({ error: null, isPending: false, mutateAsync: jest.fn() }),
}));
jest.mock("../../../../shared/components/Toast", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

type UserSession = ReturnType<typeof userEvent.setup>;
type SubmittedInput = { clientRequestId?: string; name: string };

const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};
const created = { categoryId: "cat-1", currentCostRef: 0, currentStock: 9, id: "prod-1", isActive: true, minStock: 5, name: "Harina", salePriceRef: 5, sku: "harina" };

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

async function fill(user: UserSession, name = "Harina") {
  await paste(user, "Nombre", name);
  await paste(user, "Precio REF", "5");
}

function keys(onSubmit: jest.Mock) {
  return onSubmit.mock.calls.map(([input]: [SubmittedInput]) => input.clientRequestId);
}

describe("ProductFormModal · clave de idempotencia del alta (PRO-F9)", () => {
  it("respuesta perdida y reintento: el segundo envío lleva la MISMA clave, así el servidor no crea otro producto", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // El formulario sigue abierto con lo escrito: el usuario vuelve a pulsar.
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue("Harina"));
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = keys(onSubmit);
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toBe(first);
  });

  it("un 5xx también conserva la clave; un rechazo definitivo (400) con el contenido corregido la renueva", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new ClientApiError(500, "INTERNAL_ERROR", "Ocurrio un error inesperado."))
      .mockRejectedValueOnce(new ClientApiError(400, "BAD_REQUEST", "Los datos enviados no son validos."))
      .mockResolvedValueOnce(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    // El 400 dice que no se creó nada: al cambiar el contenido es otro intento.
    await paste(user, "Nombre", " integral");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));

    const [first, second, third] = keys(onSubmit);
    expect(second).toBe(first);
    expect(third).toMatch(UUID_PATTERN);
    expect(third).not.toBe(first);
  });

  it("tras un alta correcta, Guardar y crear otro estrena clave para el siguiente producto", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    // Mismo contenido que el anterior: aun así es otro alta, con otra clave.
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = keys(onSubmit);
    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("cerrar y reabrir el formulario estrena clave aunque el envío anterior quedara sin respuesta", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(created);
    const props = { ...withCategory, onOpenChange: jest.fn(), onSubmit };

    const view = render(<ProductFormModal {...props} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    view.rerender(<ProductFormModal {...props} open={false} />);
    view.rerender(<ProductFormModal {...props} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = keys(onSubmit);
    expect(second).toMatch(UUID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("el alta compacta (compra) también lleva clave; la edición no", async () => {
    const user = userEvent.setup({ delay: null });
    const onCreate = jest.fn().mockResolvedValue(created);
    const onEdit = jest.fn().mockResolvedValue(created);

    const compact = render(
      <ProductFormModal {...withCategory} compact onOpenChange={jest.fn()} onSubmit={onCreate} open />,
    );
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    compact.unmount();

    render(
      <ProductFormModal
        categories={withCategory.categories}
        mode="edit"
        onOpenChange={jest.fn()}
        onSubmit={onEdit}
        open
        product={created}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));

    expect(keys(onCreate)[0]).toMatch(UUID_PATTERN);
    expect(onEdit.mock.calls[0][0]).not.toHaveProperty("clientRequestId");
  });
});
