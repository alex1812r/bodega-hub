/** PRO-02 · un guardado rechazado no deja una promesa sin manejar y el modal sigue abierto. */
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createQueryWrapper,
  installFetchStub,
} from "../../../inventory/utils/requestAttempt.testUtils";
import { CategoryFormModal } from "./CategoryFormModal";

type ModalProps = Parameters<typeof CategoryFormModal>[0];

function renderModal(props: ModalProps = {}) {
  const user = userEvent.setup({ delay: null });
  const onSubmit = jest.fn();
  const onOpenChange = jest.fn();

  installFetchStub(() => ({ items: [] }));
  render(<CategoryFormModal onOpenChange={onOpenChange} onSubmit={onSubmit} open {...props} />, {
    wrapper: createQueryWrapper(),
  });

  return { onOpenChange, onSubmit, user };
}

describe("CategoryFormModal · guardado rechazado (PRO-02)", () => {
  /**
   * Deja pasar los ticks en los que Node avisa de un rechazo sin manejar: jest
   * lo convierte en fallo del test en curso (así fallaba antes del arreglo).
   */
  function settle() {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("si onSubmit rechaza no queda una promesa sin manejar, el modal sigue abierto y se puede reintentar", async () => {
    const { onOpenChange, onSubmit, user } = renderModal({
      errorMessage: 'Ya existe una categoría activa llamada "Bebidas".',
    });

    onSubmit.mockRejectedValueOnce(new Error("duplicada"));
    await user.click(screen.getByLabelText("Nombre"));
    await user.paste("Bebidas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await settle();

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "Nueva categoría" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Bebidas");
    expect(
      screen.getByText('Ya existe una categoría activa llamada "Bebidas".'),
    ).toBeInTheDocument();

    // El candado se suelta: el segundo intento llega y, ya aceptado, cierra.
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
