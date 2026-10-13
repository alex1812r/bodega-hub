import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import { ProductFormModal } from "./ProductFormModal";

/**
 * PRO-F11 · alta con la respuesta perdida y un campo cambiado antes de
 * reintentar: la misma clave con otro cuerpo daba 409 con un mensaje técnico
 * ("La clave de idempotencia ya se usó…") y el formulario se atascaba. Ahora no
 * se envía: avisa de que el producto pudo haberse creado y ofrece buscarlo en la
 * lista o crearlo de todos modos (con clave nueva), sin perder lo escrito.
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

const NOTICE =
  "Este producto pudo haberse creado en el intento anterior. Revisa la lista antes de volver a intentarlo.";
const withCategory = {
  categories: [{ id: "cat-1", isActive: true, name: "Bebidas", taxRate: 16 }],
  initialValues: { categoryId: "cat-1" },
};
const created = { categoryId: "cat-1", currentCostRef: 0, currentStock: 9, id: "prod-1", isActive: true, minStock: 5, name: "Harina", salePriceRef: 5, sku: "harina" };

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

async function fill(user: UserSession) {
  await paste(user, "Nombre", "Harina & Maíz");
  await paste(user, "Precio REF", "5");
}

function inputs(onSubmit: jest.Mock) {
  return onSubmit.mock.calls.map(([input]: [SubmittedInput]) => input);
}

const submit = (user: UserSession) => user.click(screen.getByRole("button", { name: "Crear producto" }));

describe("ProductFormModal · respuesta perdida y contenido cambiado (PRO-F11)", () => {
  it("no reenvía la misma clave con otro contenido: avisa y ofrece buscar en la lista", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    await paste(user, "Nombre", " integral");
    await submit(user);

    expect(await screen.findByText(NOTICE)).toBeVisible();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Lo escrito sigue ahí.
    expect(screen.getByLabelText("Nombre")).toHaveValue("Harina & Maíz integral");

    // Busca el nombre del intento que pudo crearse, en otra pestaña.
    const link = screen.getByRole("link", { name: "Buscar en la lista" });

    expect(link).toHaveAttribute("href", "/products?search=Harina%20%26%20Ma%C3%ADz");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("Crear de todos modos envía lo escrito con una clave nueva", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new ClientApiError(500, "INTERNAL_ERROR", "Ocurrio un error inesperado."))
      .mockResolvedValueOnce(created);

    render(<ProductFormModal {...withCategory} onOpenChange={onOpenChange} onSubmit={onSubmit} open />);
    await fill(user);
    await submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await paste(user, "Nombre", " integral");
    await submit(user);
    await user.click(await screen.findByRole("button", { name: "Crear de todos modos" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = inputs(onSubmit);

    expect(second?.name).toBe("Harina & Maíz integral");
    expect(second?.clientRequestId).toBeTruthy();
    expect(second?.clientRequestId).not.toBe(first?.clientRequestId);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("volver al contenido del intento anterior reintenta con la misma clave, sin aviso", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await paste(user, "Nombre", "X");
    await submit(user);
    expect(await screen.findByText(NOTICE)).toBeVisible();

    await user.clear(screen.getByLabelText("Nombre"));
    await paste(user, "Nombre", "Harina & Maíz");
    await submit(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const [first, second] = inputs(onSubmit);

    expect(second?.clientRequestId).toBe(first?.clientRequestId);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("un rechazo que dice que no se creó nada (SKU repetido, 409) no dispara el aviso al corregir", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest
      .fn()
      .mockRejectedValueOnce(new ClientApiError(409, "CONFLICT", "Ya existe un producto con ese SKU."))
      .mockResolvedValueOnce(created);

    render(<ProductFormModal {...withCategory} onOpenChange={jest.fn()} onSubmit={onSubmit} open />);
    await fill(user);
    await submit(user);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await paste(user, "Nombre", " 2");
    await submit(user);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
