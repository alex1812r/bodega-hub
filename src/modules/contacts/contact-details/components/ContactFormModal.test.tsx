import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/shared/components/Toast";

import { ContactFormModal } from "./ContactFormModal";

// El formulario lleva el guardia de cambios sin guardar (`useProcessGuard`), que usa el router.
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

/** PRO-04 · "Guardar y crear otro" en el alta de contacto. */

type ModalProps = Parameters<typeof ContactFormModal>[0];
type UserSession = ReturnType<typeof userEvent.setup>;

const SAVE_BUTTONS = ["Cancelar", "Guardar y crear otro", "Crear contacto"];

const supplier = {
  address: "Av. Principal",
  email: "ventas@polar.test",
  id: "cont-1",
  isActive: true,
  name: "Distribuidora Polar",
  phone: "0412-0000001",
  taxId: "J-00000001-1",
  type: "proveedor",
} as NonNullable<ModalProps["contact"]>;

function renderCreate(props: ModalProps = {}) {
  const user = userEvent.setup({ delay: null });

  render(<ContactFormModal onOpenChange={jest.fn()} open {...props} />);

  return user;
}

function createAnotherButton() {
  return screen.getByRole("button", { name: "Guardar y crear otro" });
}

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

async function fillEverything(user: UserSession) {
  await paste(user, "Nombre", "Distribuidora Polar");
  await user.selectOptions(screen.getByLabelText("Tipo"), "proveedor");
  await paste(user, "Teléfono", "0412-0000001");
  await paste(user, "Correo", "ventas@polar.test");
  await paste(user, "RIF / Cédula", "J-00000001-1");
  await paste(user, "Dirección", "Av. Principal");
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

describe("ContactFormModal · Guardar y crear otro (PRO-04)", () => {
  it("solo el alta lo ofrece, entre Cancelar y el botón principal", () => {
    const { unmount } = render(<ContactFormModal onOpenChange={jest.fn()} open />);

    // No es un botón de envío: Enter en un campo nunca lo elige (PRO-F3).
    expect(createAnotherButton()).toHaveAttribute("type", "button");
    expect(
      within(screen.getByRole("dialog"))
        .getAllByRole("button")
        .map((button) => button.textContent ?? "")
        .filter((text) => SAVE_BUTTONS.includes(text)),
    ).toEqual(SAVE_BUTTONS);
    unmount();

    render(<ContactFormModal contact={supplier} mode="edit" onOpenChange={jest.fn()} open />);

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar y crear otro" })).not.toBeInTheDocument();
  });

  it("guarda, deja el modal abierto y vacío, con el foco en Nombre y el tipo conservado", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ onOpenChange, onSubmit });

    expect(screen.getByLabelText("Tipo")).toHaveValue("cliente");

    await fillEverything(user);
    await user.click(createAnotherButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      address: "Av. Principal",
      email: "ventas@polar.test",
      name: "Distribuidora Polar",
      phone: "0412-0000001",
      taxId: "J-00000001-1",
      type: "proveedor",
    });

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Crear contacto" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Tipo")).toHaveValue("proveedor");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("");
    expect(screen.getByLabelText("Correo")).toHaveValue("");
    expect(screen.getByLabelText("RIF / Cédula")).toHaveValue("");
    expect(screen.getByLabelText("Dirección")).toHaveValue("");

    // El segundo contacto viaja con lo nuevo y el mismo tipo; el principal cierra.
    await paste(user, "Nombre", "Alimentos Mary");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    // Los opcionales vacíos no viajan (PRO-F3).
    expect(onSubmit.mock.calls[1][0]).toEqual({ name: "Alimentos Mary", type: "proveedor" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("al cerrar y volver a abrir, el tipo vuelve a Cliente", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup({ delay: null });

    render(<ContactFormModal onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Nuevo contacto" }));
    await paste(user, "Nombre", "Distribuidora Polar");
    await user.selectOptions(screen.getByLabelText("Tipo"), "proveedor");
    await user.click(createAnotherButton());
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(screen.getByLabelText("Tipo")).toHaveValue("proveedor");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Nuevo contacto" }));

    expect(screen.getByLabelText("Tipo")).toHaveValue("cliente");
    expect(screen.getByLabelText("Nombre")).toHaveValue("");
  });

  it("si el guardado falla no limpia nada, el modal sigue abierto y se ve el error", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockRejectedValue(new Error("Ya existe un contacto con ese RIF."));
    const rejections = watchUnhandledRejections();
    const props = { onOpenChange, onSubmit, open: true };
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ContactFormModal {...props} />);

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
    rerender(<ContactFormModal {...props} errorMessage="Ya existe un contacto con ese RIF." />);

    expect(screen.getByText("Ya existe un contacto con ese RIF.")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Crear contacto" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Distribuidora Polar");
    expect(screen.getByLabelText("Tipo")).toHaveValue("proveedor");
    expect(screen.getByLabelText("RIF / Cédula")).toHaveValue("J-00000001-1");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Se puede reintentar: el candado se suelta tras el fallo.
    onSubmit.mockResolvedValueOnce(undefined);
    await user.click(createAnotherButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
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

    await paste(user, "Nombre", "Distribuidora Polar");
    await user.dblClick(createAnotherButton());
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => finishSave());

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("con isSubmitting el formulario ignora el envío y deshabilita los dos botones", async () => {
    const onSubmit = jest.fn();
    const user = renderCreate({ isSubmitting: true, onSubmit });

    await paste(user, "Nombre", "Distribuidora Polar");
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(createAnotherButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
  });

  it("edición: precarga el contacto, guarda y cierra como siempre", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ contact: supplier, mode: "edit", onOpenChange, onSubmit });

    expect(screen.getByLabelText("Nombre")).toHaveValue("Distribuidora Polar");
    expect(screen.getByLabelText("Tipo")).toHaveValue("proveedor");

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "Distribuidora Polar",
      type: "proveedor",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("ContactFormModal · fallos de QA (PRO-F3)", () => {
  /**
   * Botón que el navegador pulsa con Enter en un campo (envío implícito): el
   * primer botón de envío del formulario en orden de documento, esté dentro o
   * asociado con `form=`. jsdom no simula ese Enter, así que se calcula igual.
   */
  function implicitSubmitButton() {
    const form = document.querySelector("form") as HTMLFormElement;

    return Array.from(form.elements).find(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && element.type === "submit",
    );
  }

  it("Enter en un campo equivale al botón principal: guarda una vez y cierra", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ onOpenChange, onSubmit });

    expect(implicitSubmitButton()).toHaveTextContent("Crear contacto");

    await paste(user, "Nombre", "Distribuidora Polar");
    await user.click(implicitSubmitButton() as HTMLButtonElement);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("Guardar y crear otro se activa con Enter o Espacio teniendo el foco", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ onOpenChange, onSubmit });

    await paste(user, "Nombre", "Distribuidora Polar");
    act(() => createAnotherButton().focus());
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));

    await paste(user, "Nombre", "Alimentos Mary");
    act(() => createAnotherButton().focus());
    await user.keyboard(" ");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Guardar y crear otro con el nombre vacío no envía ni deja la intención pendiente", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ onOpenChange, onSubmit });

    await user.click(createAnotherButton());
    expect(onSubmit).not.toHaveBeenCalled();

    // El siguiente envío con el botón principal cierra: no hereda "crear otro".
    await paste(user, "Nombre", "Distribuidora Polar");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("alta: los opcionales vacíos o en blanco no viajan (el BFF rechaza email vacío)", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ onSubmit });

    await paste(user, "Nombre", "Distribuidora Polar");
    await paste(user, "Teléfono", "   ");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const input = onSubmit.mock.calls[0][0];

    expect(input).toEqual({ name: "Distribuidora Polar", type: "cliente" });
    // Lo que llega al BFF: ni `email: ""` ni ningún otro opcional vacío.
    expect(JSON.parse(JSON.stringify(input))).toStrictEqual({
      name: "Distribuidora Polar",
      type: "cliente",
    });
  });

  it("edición: un correo vacío no viaja; vaciar teléfono, RIF o dirección sí los borra", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderCreate({ contact: supplier, mode: "edit", onSubmit });

    for (const label of ["Teléfono", "Correo", "RIF / Cédula", "Dirección"]) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(JSON.parse(JSON.stringify(onSubmit.mock.calls[0][0]))).toStrictEqual({
      address: "",
      name: "Distribuidora Polar",
      phone: "",
      taxId: "",
      type: "proveedor",
    });
  });

  it("un error del servidor sin espacios hace wrap dentro del modal", () => {
    const message = "X".repeat(140);

    renderCreate({ errorMessage: message });

    expect(screen.getByText(message)).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
  });
});

describe("ContactFormModal · aviso de contacto creado (PRO-04)", () => {
  function renderWithToasts(props: ModalProps = {}) {
    render(
      <ToastProvider>
        <ContactFormModal onOpenChange={jest.fn()} open {...props} />
      </ToastProvider>,
    );

    return userEvent.setup({ delay: null });
  }

  function toasts() {
    return within(screen.getByRole("status"));
  }

  it("el botón principal avisa con el nombre guardado y el enlace Ver al detalle", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(supplier);
    const user = renderWithToasts({ onOpenChange, onSubmit });

    await paste(user, "Nombre", "polar");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    expect(await toasts().findByText("Contacto creado: Distribuidora Polar")).toBeInTheDocument();
    expect(toasts().getByRole("link", { name: "Ver" })).toHaveAttribute("href", "/contacts/cont-1");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Guardar y crear otro avisa con el modal aún abierto y el foco sigue en Nombre", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValue(supplier);
    const user = renderWithToasts({ onOpenChange, onSubmit });

    await paste(user, "Nombre", "Distribuidora Polar");
    await user.click(createAnotherButton());

    expect(await toasts().findByText("Contacto creado: Distribuidora Polar")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Crear contacto" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveFocus());
  });

  it("si onSubmit no devuelve el contacto, avisa con el nombre escrito y sin enlace", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const user = renderWithToasts({ onSubmit });

    await paste(user, "Nombre", "Alimentos Mary");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    expect(await toasts().findByText("Contacto creado: Alimentos Mary")).toBeInTheDocument();
    expect(toasts().queryByRole("link")).not.toBeInTheDocument();
  });

  it("si el guardado falla no avisa de ningún alta", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error("Ya existe un contacto con ese RIF."));
    const user = renderWithToasts({ onSubmit });

    await paste(user, "Nombre", "Alimentos Mary");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Alimentos Mary");
  });

  it("la edición no avisa, y si falla el modal queda abierto sin rechazo pendiente", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn().mockResolvedValueOnce(supplier).mockRejectedValueOnce(new Error("Sin red"));
    const rejections = watchUnhandledRejections();
    const user = renderWithToasts({ contact: supplier, mode: "edit", onOpenChange, onSubmit });

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    onOpenChange.mockClear();

    try {
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
      await rejections.settle();
    } finally {
      rejections.stop();
    }

    expect(rejections.unhandled).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog", { name: "Editar contacto" })).toBeInTheDocument();
  });
});
