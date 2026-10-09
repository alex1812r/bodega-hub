import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ContactFormModal } from "./ContactFormModal";

/**
 * CNF-15 · guardia de cambios sin guardar del formulario de contacto: con cambios,
 * cerrar pregunta con el modal del tema y nombra el proceso; sin cambios, o tras
 * guardar, cierra sin preguntar.
 */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

type ModalProps = Parameters<typeof ContactFormModal>[0];
type UserSession = ReturnType<typeof userEvent.setup>;

const CLOSE_WAYS = ["Escape", "clic fuera", "Cancelar", "la X"] as const;

type CloseWay = (typeof CLOSE_WAYS)[number];

const supplier = {
  address: "Av. Principal",
  email: "ventas@distribuidorax.test",
  id: "cont-1",
  isActive: true,
  name: "Distribuidora X",
  phone: "0412-0000001",
  taxId: "J-00000001-1",
  type: "proveedor",
} as NonNullable<ModalProps["contact"]>;

/** Consumidor con el modal controlado: lo cierra cuando el formulario lo pide. */
function Host({
  onOpenChange,
  ...props
}: ModalProps & { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        abrir formulario
      </button>
      <ContactFormModal
        {...props}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          onOpenChange(nextOpen);
        }}
        open={open}
        trigger={<span />}
      />
    </>
  );
}

/** Radix registra su escucha de «clic fuera» en un setTimeout(0) tras montar el diálogo. */
async function settleDialog() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderForm(props: ModalProps = {}) {
  const user = userEvent.setup({ delay: null });
  const onOpenChange = jest.fn();

  render(<Host {...props} onOpenChange={onOpenChange} />);
  await settleDialog();

  return { onOpenChange, user };
}

function formDialog() {
  return screen.getByRole("dialog", { name: /^(Crear|Editar) contacto$/ });
}

/** Por su título: con la pregunta del guardia encima, el formulario queda fuera del árbol accesible. */
function queryFormDialog() {
  return (
    screen
      .queryAllByRole("dialog", { hidden: true })
      .find((dialog) =>
        /^(Crear|Editar) contacto$/.test(dialog.querySelector("h2")?.textContent ?? ""),
      ) ?? null
  );
}

function guardDialog() {
  return screen.queryByRole("dialog", { name: "¿Salir sin terminar?" });
}

async function paste(user: UserSession, label: string, text: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(text);
}

async function closeWith(user: UserSession, way: CloseWay) {
  if (way === "Escape") {
    await user.keyboard("{Escape}");
  } else if (way === "Cancelar") {
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));
  } else if (way === "la X") {
    await user.click(within(formDialog()).getByRole("button", { name: "Cerrar modal" }));
  } else {
    const backdrop = formDialog().previousElementSibling;

    if (!(backdrop instanceof HTMLElement)) {
      throw new Error("No se encontró el fondo del modal");
    }

    // El modal ignora el clic en el fondo durante medio segundo tras abrirse.
    const now = performance.now();
    const clock = jest.spyOn(performance, "now").mockReturnValue(now + 1000);

    // Radix decide el «clic fuera» al bajar el puntero.
    fireEvent.pointerDown(backdrop);
    clock.mockRestore();
  }
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
}

describe("ContactFormModal · guardia de cambios sin guardar (CNF-15)", () => {
  it.each(CLOSE_WAYS)("sin cambios, %s cierra directo, sin pregunta", async (way) => {
    const { onOpenChange, user } = await renderForm();

    await closeWith(user, way);

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(CLOSE_WAYS)(
    "con cambios, %s pregunta nombrando el contacto y no cierra",
    async (way) => {
      const { onOpenChange, user } = await renderForm();

      await paste(user, "Nombre", "Distribuidora X");
      await closeWith(user, way);

      const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

      expect(guard).toHaveTextContent("Contacto nuevo «Distribuidora X» sin guardar");
      expect(guard).toHaveTextContent("Si sales ahora, se perderán los cambios.");
      expect(queryFormDialog()).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    },
  );

  it("«Seguir aquí» conserva todo lo tecleado y devuelve el foco al campo", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Distribuidora X");
    await user.selectOptions(screen.getByLabelText("Tipo"), "proveedor");
    await paste(user, "Teléfono", "0412-0000001");
    await paste(user, "Dirección", "Av. Principal");
    await user.keyboard("{Escape}");

    const guard = await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });

    // El foco queda atrapado en la pregunta, en la opción que no pierde nada.
    expect(within(guard).getByRole("button", { name: "Seguir aquí" })).toHaveFocus();

    await user.click(within(guard).getByRole("button", { name: "Seguir aquí" }));

    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    expect(screen.getByLabelText("Nombre")).toHaveValue("Distribuidora X");
    expect(screen.getByLabelText("Tipo")).toHaveValue("proveedor");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("0412-0000001");
    expect(screen.getByLabelText("Dirección")).toHaveValue("Av. Principal");
    expect(screen.getByLabelText("Dirección")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Esc sobre la pregunta equivale a «Seguir aquí»: solo se cierra la pregunta", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Distribuidora X");
    await user.keyboard("{Escape}");
    await screen.findByRole("dialog", { name: "¿Salir sin terminar?" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(guardDialog()).not.toBeInTheDocument());
    expect(formDialog()).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Distribuidora X");
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("«Salir» cierra y descarta: al reabrir el formulario está limpio y cierra sin preguntar", async () => {
    const { onOpenChange, user } = await renderForm();

    await paste(user, "Nombre", "Distribuidora X");
    await user.keyboard("{Escape}");
    await user.click(
      within(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).getByRole(
        "button",
        { name: "Salir" },
      ),
    );

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "abrir formulario" }));

    expect(screen.getByLabelText("Nombre")).toHaveValue("");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
  });

  it("edición: tocar y volver al valor original no cuenta; un cambio real nombra el contacto", async () => {
    const { onOpenChange, user } = await renderForm({ contact: supplier, mode: "edit" });

    await user.type(screen.getByLabelText("Nombre"), "!");
    await user.keyboard("{Backspace}");
    await user.selectOptions(screen.getByLabelText("Tipo"), "ambos");
    await user.selectOptions(screen.getByLabelText("Tipo"), "proveedor");

    expect(dispatchBeforeUnload()).toBe(false);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "abrir formulario" }));
    await user.selectOptions(screen.getByLabelText("Tipo"), "ambos");
    await user.keyboard("{Escape}");

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      "Edición de contacto «Distribuidora X»",
    );
    // No se volvió a pedir el cierre al consumidor.
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("con cambios avisa al recargar o cerrar la pestaña; sin cambios no", async () => {
    const { user } = await renderForm();

    expect(dispatchBeforeUnload()).toBe(false);

    await paste(user, "Nombre", "Distribuidora X");

    expect(dispatchBeforeUnload()).toBe(true);
  });

  it("tras guardar con éxito cierra sin preguntar y el guardia queda inactivo", async () => {
    const onSubmit = jest.fn().mockResolvedValue(supplier);
    const { onOpenChange, user } = await renderForm({ onSubmit });

    await paste(user, "Nombre", "Distribuidora X");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it("si el guardado falla, lo tecleado sigue sin guardar y cerrar vuelve a preguntar", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error("RIF repetido"));
    const { user } = await renderForm({ onSubmit });

    await paste(user, "Nombre", "Distribuidora X");
    await user.click(screen.getByRole("button", { name: "Crear contacto" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByRole("dialog", { name: "¿Salir sin terminar?" })).toHaveTextContent(
      "Contacto nuevo «Distribuidora X» sin guardar",
    );
  });

  it("mientras guarda, Cancelar cierra como antes, sin pregunta", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = jest.fn();
    const { rerender } = render(<Host onOpenChange={onOpenChange} />);

    await paste(user, "Nombre", "Distribuidora X");
    // El consumidor marca el envío en curso.
    rerender(<Host isSubmitting onOpenChange={onOpenChange} />);
    await user.click(within(formDialog()).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("«Guardar y crear otro» deja el formulario limpio: cerrar después no pregunta", async () => {
    const onSubmit = jest.fn().mockResolvedValue(supplier);
    const { user } = await renderForm({ onSubmit });

    await paste(user, "Nombre", "Distribuidora X");
    await user.click(screen.getByRole("button", { name: "Guardar y crear otro" }));

    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveValue(""));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryFormDialog()).not.toBeInTheDocument());
    expect(guardDialog()).not.toBeInTheDocument();
  });
});
