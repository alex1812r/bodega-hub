import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useEffect } from "react";

import { Modal } from "../Modal";
import {
  TOAST_DEFAULT_DURATION_MS,
  type ToastController,
  type ToastOptions,
  ToastProvider,
  useToast,
} from "./Toast";

let controller: ToastController;

function captureController(next: ToastController) {
  controller = next;
}

function Harness() {
  const current = useToast();

  useEffect(() => captureController(current), [current]);

  return <button type="button">Fuera del aviso</button>;
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

function show(options: ToastOptions) {
  let id = "";

  act(() => {
    id = controller.showToast(options);
  });

  return id;
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe("Toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("muestra el aviso en una región polite que ya existía, sin mover el foco", () => {
    renderWithProvider();

    const status = screen.getByRole("status");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toBeEmptyDOMElement();

    const outside = screen.getByRole("button", { name: "Fuera del aviso" });

    outside.focus();
    show({ description: "Ya está en el catálogo.", title: "Producto creado: Harina", tone: "success" });

    expect(within(status).getByText("Producto creado: Harina")).toBeInTheDocument();
    expect(within(status).getByText("Ya está en el catálogo.")).toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it("los de error van a una región assertive y no se cierran solos", () => {
    renderWithProvider();
    show({ title: "No se pudo guardar", tone: "error" });

    const alert = screen.getByRole("alert");

    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(within(alert).getByText("No se pudo guardar")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    advance(60_000);

    expect(screen.getByText("No se pudo guardar")).toBeInTheDocument();
  });

  it("un error con durationMs sí se cierra al cumplirse", () => {
    renderWithProvider();
    show({ durationMs: 10_000, title: "No se pudo guardar", tone: "error" });

    advance(9_999);
    expect(screen.getByText("No se pudo guardar")).toBeInTheDocument();

    advance(1);
    expect(screen.queryByText("No se pudo guardar")).not.toBeInTheDocument();
  });

  it("se cierra solo a los 6 segundos", () => {
    renderWithProvider();
    show({ title: "Guardado" });

    advance(TOAST_DEFAULT_DURATION_MS - 1);
    expect(screen.getByText("Guardado")).toBeInTheDocument();

    advance(1);
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
  });

  it("durationMs 0 lo deja fijo hasta que se cierra a mano", () => {
    renderWithProvider();
    show({ durationMs: 0, title: "Guardado" });

    advance(60_000);

    expect(screen.getByText("Guardado")).toBeInTheDocument();
  });

  it("el puntero encima pausa el autocierre y al salir corre solo lo que faltaba", () => {
    renderWithProvider();
    show({ title: "Guardado" });

    const toast = screen.getByText("Guardado").closest("[data-toast-tone]") as HTMLElement;

    advance(4_000);
    fireEvent.mouseEnter(toast);
    advance(60_000);
    expect(screen.getByText("Guardado")).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    advance(1_999);
    expect(screen.getByText("Guardado")).toBeInTheDocument();

    advance(1);
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
  });

  it("el foco dentro pausa el autocierre y al salir lo reanuda", () => {
    renderWithProvider();
    show({ action: { href: "/products/prod-1", label: "Ver" }, title: "Guardado" });

    const link = screen.getByRole("link", { name: "Ver" });
    const close = screen.getByRole("button", { name: "Cerrar aviso" });

    act(() => link.focus());
    advance(60_000);
    expect(screen.getByText("Guardado")).toBeInTheDocument();

    // Pasar del enlace al botón del mismo aviso no reanuda nada.
    act(() => close.focus());
    advance(60_000);
    expect(screen.getByText("Guardado")).toBeInTheDocument();

    act(() => screen.getByRole("button", { name: "Fuera del aviso" }).focus());
    advance(TOAST_DEFAULT_DURATION_MS);
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
  });

  it("el botón Cerrar aviso lo quita y dismiss(id) también", () => {
    renderWithProvider();
    show({ title: "Primero" });

    const secondId = show({ title: "Segundo" });
    const first = screen.getByText("Primero").closest("[data-toast-tone]") as HTMLElement;

    fireEvent.click(within(first).getByRole("button", { name: "Cerrar aviso" }));

    expect(screen.queryByText("Primero")).not.toBeInTheDocument();
    expect(screen.getByText("Segundo")).toBeInTheDocument();

    act(() => controller.dismiss(secondId));
    expect(screen.queryByText("Segundo")).not.toBeInTheDocument();

    // Un id que ya no existe no rompe nada.
    act(() => controller.dismiss(secondId));
  });

  it("la acción con href es un enlace interno alcanzable con teclado", () => {
    renderWithProvider();
    show({ action: { href: "/products/prod-1", label: "Ver" }, title: "Producto creado: Harina" });

    const link = screen.getByRole("link", { name: "Ver" });

    expect(link).toHaveAttribute("href", "/products/prod-1");
    expect(link).not.toHaveAttribute("tabindex", "-1");

    act(() => link.focus());
    expect(link).toHaveFocus();
  });

  it("la acción con onClick la ejecuta una vez y cierra el aviso", () => {
    const onClick = jest.fn();

    renderWithProvider();
    show({ action: { label: "Deshacer", onClick }, title: "Línea quitada" });

    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Línea quitada")).not.toBeInTheDocument();
  });

  it("apila hasta 3 y descarta el más antiguo", () => {
    renderWithProvider();
    ["Uno", "Dos", "Tres", "Cuatro"].forEach((title) => show({ durationMs: 0, title }));

    expect(screen.queryByText("Uno")).not.toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll("[data-toast-tone] p")).map((node) => node.textContent),
    ).toEqual(["Dos", "Tres", "Cuatro"]);
  });

  it("cada aviso lleva su propia cuenta: el descartado no cierra a otro", () => {
    renderWithProvider();
    show({ title: "Uno" });
    advance(5_000);
    show({ title: "Dos" });

    advance(1_000);
    expect(screen.queryByText("Uno")).not.toBeInTheDocument();
    expect(screen.getByText("Dos")).toBeInTheDocument();

    advance(5_000);
    expect(screen.queryByText("Dos")).not.toBeInTheDocument();
  });

  it("un texto largo sin espacios hace wrap dentro del aviso", () => {
    renderWithProvider();
    show({ title: "A".repeat(300) });

    expect(screen.getByText("A".repeat(300)).parentElement).toHaveClass(
      "min-w-0",
      "[overflow-wrap:anywhere]",
    );
  });

  it("queda por encima del overlay del Modal y respeta prefers-reduced-motion", () => {
    renderWithProvider();
    show({ title: "Guardado" });

    expect(document.querySelector("[data-toast-viewport]")).toHaveClass("z-[80]", "fixed", "sm:top-4");
    expect(screen.getByText("Guardado").closest("[data-toast-tone]")).toHaveClass(
      "motion-reduce:transition-none",
      "pointer-events-auto",
    );
  });

  describe("pantalla estrecha (< sm) · PRO-F3", () => {
    // jsdom no aplica media queries: se fijan las clases. QA mide a 390 × 844
    // con un `Modal` abierto: un solo aviso visible, de ≤ 88 px de alto, que
    // acaba por encima de la X y del título del modal (y ≈ 101) y no toca el pie.
    function toastOf(title: string) {
      return screen.getByText(title).closest("[data-toast-tone]") as HTMLElement;
    }

    function hiddenOnNarrow(title: string) {
      return toastOf(title).classList.contains("max-sm:hidden");
    }

    it("solo deja visible el aviso más reciente; en escritorio siguen los tres", () => {
      renderWithProvider();
      ["Uno", "Dos", "Tres"].forEach((title) => show({ durationMs: 0, title }));

      expect(["Uno", "Dos", "Tres"].map(hiddenOnNarrow)).toEqual([true, true, false]);
      // Ocultar es solo de pantalla estrecha: ninguna clase los quita en escritorio.
      ["Uno", "Dos", "Tres"].forEach((title) => {
        expect(toastOf(title)).not.toHaveClass("hidden");
        expect(toastOf(title)).toBeInTheDocument();
      });
    });

    it("un error tiene prioridad sobre avisos posteriores; entre errores, el más reciente", () => {
      renderWithProvider();
      show({ title: "Error viejo", tone: "error" });
      show({ title: "Error nuevo", tone: "error" });
      show({ durationMs: 0, title: "Guardado", tone: "success" });

      expect(["Error viejo", "Error nuevo", "Guardado"].map(hiddenOnNarrow)).toEqual([
        true,
        false,
        true,
      ]);
    });

    it("al cerrar el visible aparece el siguiente, y un oculto sigue su cuenta de autocierre", () => {
      renderWithProvider();
      show({ title: "Guardado", tone: "success" });
      show({ title: "No se pudo guardar", tone: "error" });

      expect(hiddenOnNarrow("Guardado")).toBe(true);

      advance(TOAST_DEFAULT_DURATION_MS - 1);
      fireEvent.click(
        within(toastOf("No se pudo guardar")).getByRole("button", { name: "Cerrar aviso" }),
      );
      expect(hiddenOnNarrow("Guardado")).toBe(false);

      // No vuelve a empezar sus 6 s por haber estado oculto.
      advance(1);
      expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
    });

    it("acota la altura: título y descripción a 2 líneas, y la acción al lado, no debajo", () => {
      renderWithProvider();
      show({
        action: { href: "/products/prod-1", label: "Ver" },
        description: "B".repeat(300),
        durationMs: 0,
        title: "A".repeat(300),
      });

      expect(screen.getByText("A".repeat(300))).toHaveClass("line-clamp-2", "sm:line-clamp-none");
      expect(screen.getByText("B".repeat(300))).toHaveClass("line-clamp-2", "sm:line-clamp-none");
      expect(toastOf("A".repeat(300))).toHaveClass("p-2", "sm:p-3");
      // Texto y acción en fila (la acción no suma altura); en escritorio, apilados.
      expect(screen.getByRole("link", { name: "Ver" }).parentElement).toHaveClass(
        "flex",
        "sm:block",
      );
      expect(screen.getByRole("link", { name: "Ver" })).toHaveClass("shrink-0", "sm:mt-1");
    });

    it("va pegado al borde superior, por encima de la hoja del Modal; en escritorio, como antes", () => {
      renderWithProvider();

      expect(document.querySelector("[data-toast-viewport]")).toHaveClass("top-1", "sm:top-4");
    });
  });

  it("al desmontar con avisos vivos no deja temporizadores", () => {
    const { unmount } = renderWithProvider();

    show({ title: "Uno" });
    show({ title: "Dos" });
    expect(jest.getTimerCount()).toBe(2);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
    expect(document.querySelector("[data-toast-viewport]")).not.toBeInTheDocument();
  });

  it("sin ToastProvider, useToast no lanza y no pinta nada", () => {
    render(<Harness />);

    expect(controller.showToast({ title: "Guardado" })).toBe("");
    expect(() => controller.dismiss("toast-1")).not.toThrow();
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("con un Modal abierto, el aviso sigue anunciable y pulsarlo no cierra el modal", async () => {
    const onOpenChange = jest.fn();

    render(
      <ToastProvider>
        <Harness />
        <Modal description="Alta" onOpenChange={onOpenChange} open title="Crear producto">
          <p>Formulario</p>
        </Modal>
      </ToastProvider>,
    );
    // El modal empieza a escuchar los clics de fuera un turno después de abrirse.
    advance(100);
    show({ durationMs: 0, title: "Producto creado: Harina" });

    const status = screen.getByRole("status");

    expect(status.closest("[aria-hidden='true']")).toBeNull();
    expect(status).not.toHaveAttribute("aria-hidden");

    const close = within(status).getByRole("button", { name: "Cerrar aviso" });

    fireEvent.pointerDown(close);
    fireEvent.click(close);
    advance(100);

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText("Producto creado: Harina")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Crear producto" })).toBeInTheDocument();

    // Control: el mismo gesto fuera del aviso sí cierra el modal.
    fireEvent.pointerDown(document.body);
    advance(100);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
