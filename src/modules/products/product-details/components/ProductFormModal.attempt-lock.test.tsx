import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { ProductFormModal } from "./ProductFormModal";

/**
 * INT-02 · B3 (D33) — el alta de producto usa
 * `useRequestAttempt({ renewOnContentChange, lockAfterSuccess })`:
 * - una clave nunca viaja con un contenido distinto del que estrenó (antes, tras
 *   un 409 la clave se conservaba y el alta corregida chocaba otra vez);
 * - con el alta ya confirmada y el formulario todavía montado (quien lo
 *   controla aún no lo cerró), otro «Crear producto» no crea un segundo producto.
 */

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

describe("ProductFormModal · intento del alta (INT-02 · D33)", () => {
  it("409 y contenido corregido: el nuevo envío estrena clave; repetir lo mismo tras un 409 la conserva", async () => {
    const user = userEvent.setup({ delay: null });
    const conflict = new ClientApiError(409, "CONFLICT", "Ya existe un producto con este SKU.");
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await paste(user, "Nombre", " integral");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));

    const [first, second, third] = keys(onSubmit);

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toBe(first);
    expect(third).toMatch(UUID_PATTERN);
    expect(third).not.toBe(first);
  });

  it("alta confirmada con el formulario aún montado: otro «Crear producto» no envía un segundo alta", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn().mockResolvedValue(created);
    const onOpenChange = jest.fn();

    // Quien controla el modal todavía no lo cerró (p. ej. espera a otra cosa).
    render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("tras ese alta, cerrar y reabrir el formulario permite crear otro producto, con otra clave", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn().mockResolvedValue(created);
    const props = { ...withCategory, onOpenChange: jest.fn(), onSubmit };

    const view = render(<ProductFormModal {...props} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Crear producto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    view.rerender(<ProductFormModal {...props} open={false} />);
    view.rerender(<ProductFormModal {...props} open />);
    await fill(user, "Arroz");
    await user.click(screen.getByRole("button", { name: "Crear producto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = keys(onSubmit);

    expect(second).toMatch(UUID_PATTERN);
    expect(second).not.toBe(first);
  });

  it("«Guardar y crear otro» sigue enviando el siguiente producto (otro alta a propósito), con clave nueva", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn().mockResolvedValue(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    await fill(user, "Arroz");
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = keys(onSubmit);

    expect(second).toMatch(UUID_PATTERN);
    expect(second).not.toBe(first);
  });
});
