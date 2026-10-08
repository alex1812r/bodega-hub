import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContactFormModal } from "./ContactFormModal";

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

function captureUnhandledRejections() {
  const jestListeners = process.listeners("unhandledRejection");
  const unhandled = jest.fn();

  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", unhandled);

  return {
    restore() {
      process.removeAllListeners("unhandledRejection");
      jestListeners.forEach((listener) => process.on("unhandledRejection", listener));
    },
    unhandled,
  };
}

describe("ContactFormModal · Guardar y crear otro (PRO-04)", () => {
  it("solo el alta lo ofrece, entre Cancelar y el botón principal", () => {
    const { unmount } = render(<ContactFormModal onOpenChange={jest.fn()} open />);

    expect(createAnotherButton()).toHaveAttribute("type", "submit");
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
    expect(onSubmit.mock.calls[1][0]).toEqual({
      address: "",
      email: "",
      name: "Alimentos Mary",
      phone: "",
      taxId: "",
      type: "proveedor",
    });
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
    const rejections = captureUnhandledRejections();
    const props = { onOpenChange, onSubmit, open: true };
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<ContactFormModal {...props} />);

    try {
      await fillEverything(user);
      await user.click(createAnotherButton());
      await waitFor(() => expect(rejections.unhandled).toHaveBeenCalledTimes(1));
    } finally {
      rejections.restore();
    }

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
