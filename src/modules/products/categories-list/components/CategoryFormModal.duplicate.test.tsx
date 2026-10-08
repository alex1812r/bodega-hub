/**
 * PRO-F13 · una categoría con nombre repetido responde 409 "El recurso ya
 * existe.", que no dice el campo: los dos modales muestran "Ya existe una
 * categoría con ese nombre.". Se decide por el status, no por el texto.
 */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "@/shared/api/apiFetch";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { CategoryFormModal } from "./CategoryFormModal";
import { CategoryQuickCreateModal } from "./CategoryQuickCreateModal";

const NAME_TAKEN = "Ya existe una categoría con ese nombre.";
const GENERIC = "El recurso ya existe.";

async function typeNameAndSave(user: ReturnType<typeof userEvent.setup>, button: string) {
  await user.click(screen.getByLabelText("Nombre"));
  await user.paste("Bebidas");
  await user.click(screen.getByRole("button", { name: button }));
}

describe("CategoryFormModal · nombre repetido (PRO-F13)", () => {
  function renderModal(props: Parameters<typeof CategoryFormModal>[0] = {}) {
    const user = userEvent.setup({ delay: null });
    const onSubmit = jest.fn();

    installFetchStub(() => ({ items: [] }));

    const view = render(<CategoryFormModal onSubmit={onSubmit} open {...props} />, {
      wrapper: createQueryWrapper(),
    });

    return { onSubmit, user, view };
  }

  it.each([
    ["crear", {}, "Guardar"],
    [
      "renombrar",
      {
        category: { id: "cat-1", isActive: true, name: "Refrescos", taxRate: 16 },
        mode: "edit" as const,
      },
      "Guardar cambios",
    ],
  ])("al %s, un 409 dice que el nombre ya existe en vez del mensaje genérico", async (_case, props, button) => {
    const { onSubmit, user, view } = renderModal(props);

    onSubmit.mockRejectedValueOnce(new ClientApiError(409, "CONFLICT", GENERIC));
    await user.clear(screen.getByLabelText("Nombre"));
    await typeNameAndSave(user, button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // El consumidor pinta el motivo del servidor con `errorMessage`.
    view.rerender(<CategoryFormModal errorMessage={GENERIC} onSubmit={onSubmit} open {...props} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(NAME_TAKEN);
    expect(screen.queryByText(GENERIC)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Bebidas");
  });

  it("otro rechazo (400, o un 409 reintentable) muestra el motivo del servidor tal cual", async () => {
    const { onSubmit, user, view } = renderModal();
    const retryable = "La operacion choco con otra. Vuelve a intentarlo.";

    onSubmit.mockRejectedValueOnce(
      new ClientApiError(409, "CONFLICT", retryable, undefined, { retryable: true }),
    );
    await typeNameAndSave(user, "Guardar");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    view.rerender(<CategoryFormModal errorMessage={retryable} onSubmit={onSubmit} open />);

    expect(await screen.findByRole("alert")).toHaveTextContent(retryable);

    // Tras un 409 de nombre, un rechazo distinto ya no arrastra el aviso del nombre.
    onSubmit.mockRejectedValueOnce(new ClientApiError(409, "CONFLICT", GENERIC));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(NAME_TAKEN));

    onSubmit.mockRejectedValueOnce(new ClientApiError(400, "BAD_REQUEST", "Datos invalidos."));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    view.rerender(<CategoryFormModal errorMessage="Datos invalidos." onSubmit={onSubmit} open />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Datos invalidos."));
    expect(screen.queryByText(NAME_TAKEN)).not.toBeInTheDocument();
  });
});

describe("CategoryQuickCreateModal · nombre repetido (PRO-F13)", () => {
  function renderModal() {
    const user = userEvent.setup({ delay: null });
    const onCreated = jest.fn();
    const onOpenChange = jest.fn();
    const api = installFetchStub(() => ({ items: [] }));

    render(<CategoryQuickCreateModal onCreated={onCreated} onOpenChange={onOpenChange} />, {
      wrapper: createQueryWrapper(),
    });

    return { api, onCreated, onOpenChange, user };
  }

  it("un 409 al crear dice que el nombre ya existe y el modal sigue abierto", async () => {
    const { api, onCreated, onOpenChange, user } = renderModal();

    api.respondToNextPost({ error: { code: "CONFLICT", message: GENERIC } }, 409);
    await typeNameAndSave(user, "Crear categoría");

    expect(await screen.findByRole("alert")).toHaveTextContent(NAME_TAKEN);
    expect(screen.queryByText(GENERIC)).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("otro rechazo muestra el motivo del servidor tal cual", async () => {
    const { api, user } = renderModal();

    api.respondToNextPost({ error: { code: "BAD_REQUEST", message: "Datos invalidos." } }, 400);
    await typeNameAndSave(user, "Crear categoría");

    expect(await screen.findByRole("alert")).toHaveTextContent("Datos invalidos.");
  });
});
