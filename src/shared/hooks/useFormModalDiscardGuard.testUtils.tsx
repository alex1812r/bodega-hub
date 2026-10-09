import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";

/**
 * Utilidades de los tests `*.discard-guard.test.tsx`: modales cuyo cierre pasa
 * por `useFormModalDiscardGuard`. Cada test simula `next/navigation` por su
 * cuenta (`jest.mock` se eleva por archivo).
 */

type UserSession = ReturnType<typeof userEvent.setup>;

export const GUARD_TITLE = "¿Salir sin terminar?";

/** Formas de pedir el cierre de un modal. */
export const CLOSE_WAYS = ["Escape", "clic fuera", "Cancelar", "la X"] as const;

export type CloseWay = (typeof CLOSE_WAYS)[number];

type ControlledHostProps = {
  children: (props: { onOpenChange: (open: boolean) => void; open: boolean }) => ReactNode;
  onOpenChange?: (open: boolean) => void;
};

/** Consumidor con el modal controlado: lo cierra cuando el modal lo pide y permite reabrirlo. */
export function ControlledHost({ children, onOpenChange }: ControlledHostProps) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        reabrir modal
      </button>
      {children({
        onOpenChange: (nextOpen) => {
          setOpen(nextOpen);
          onOpenChange?.(nextOpen);
        },
        open,
      })}
    </>
  );
}

/** Radix registra su escucha de «clic fuera» en un setTimeout(0) tras montar el diálogo. */
export async function settleDialog() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function queryGuardDialog() {
  return screen.queryByRole("dialog", { name: GUARD_TITLE });
}

export function findGuardDialog() {
  return screen.findByRole("dialog", { name: GUARD_TITLE });
}

/** Por su título: con otro diálogo encima, el modal queda fuera del árbol accesible. */
export function queryDialogByTitle(title: string) {
  return (
    screen
      .queryAllByRole("dialog", { hidden: true })
      .find((dialog) => dialog.querySelector("h2")?.textContent === title) ?? null
  );
}

function getDialogByTitle(title: string) {
  const dialog = queryDialogByTitle(title);

  if (!dialog) {
    throw new Error(`No se encontró el modal «${title}»`);
  }

  return dialog;
}

/** Pide el cierre del modal `title` por una de las cuatro vías. */
export async function closeModalWith(
  user: UserSession,
  title: string,
  way: CloseWay,
  cancelLabel = "Cancelar",
) {
  if (way === "Escape") {
    await user.keyboard("{Escape}");
  } else if (way === "Cancelar") {
    await user.click(within(getDialogByTitle(title)).getByRole("button", { name: cancelLabel }));
  } else if (way === "la X") {
    await user.click(
      within(getDialogByTitle(title)).getByRole("button", { name: "Cerrar modal" }),
    );
  } else {
    const backdrop = getDialogByTitle(title).previousElementSibling;

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

/** Responde a la pregunta del guardia y espera a que desaparezca. */
export async function answerGuard(user: UserSession, answer: "Salir" | "Seguir aquí") {
  await user.click(within(await findGuardDialog()).getByRole("button", { name: answer }));
  await waitFor(() => expect(queryGuardDialog()).not.toBeInTheDocument());
}

/** `true` si la página pediría el aviso nativo al recargar o cerrar la pestaña. */
export function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
}

/**
 * Clic en un enlace interno a otra ruta (lo que haría el menú): con un guardia
 * activo lo intercepta y pregunta; jsdom no navega.
 */
export function clickLinkToAnotherRoute() {
  const link = window.document.createElement("a");

  link.href = "/otra-pantalla";
  link.textContent = "Otra pantalla";
  link.addEventListener("click", (event) => event.preventDefault());
  window.document.body.append(link);
  fireEvent.click(link);
  link.remove();
}
