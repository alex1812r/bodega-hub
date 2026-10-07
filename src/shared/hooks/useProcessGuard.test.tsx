import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProcessGuardModal } from "@/shared/components/ProcessGuard";

import { useProcessGuard, type UseProcessGuardOptions } from "./useProcessGuard";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

type HarnessProps = Partial<UseProcessGuardOptions> & {
  name?: string;
  onClosed?: () => void;
};

function Harness({ name = "proceso", onClosed, ...options }: HarnessProps) {
  const guard = useProcessGuard({
    active: true,
    label: "Compra a Distribuidora X · 12 líneas · REF 240,00",
    onLeave: "draft",
    ...options,
  });

  return (
    <>
      <button onClick={() => guard.guardedNavigate("/sales")} type="button">
        {`${name}: ir a ventas`}
      </button>
      <button
        onClick={() => guard.guardedNavigate("/sales", { replace: true })}
        type="button"
      >
        {`${name}: reemplazar por ventas`}
      </button>
      <button onClick={() => guard.requestLeave(() => onClosed?.())} type="button">
        {`${name}: cerrar formulario`}
      </button>
      <button
        onClick={() => guard.runUnguarded(() => mockPush("/purchases/p-1"))}
        type="button"
      >
        {`${name}: terminar`}
      </button>
      <button onClick={guard.bypass} type="button">
        {`${name}: bypass`}
      </button>
      <ProcessGuardModal guard={guard} />
    </>
  );
}

function fireBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });

  window.dispatchEvent(event);

  return event;
}

function button(name: RegExp) {
  return screen.getByRole("button", { name });
}

let addListenerSpy: jest.SpyInstance;
let removeListenerSpy: jest.SpyInstance;

function beforeUnloadCalls(spy: jest.SpyInstance) {
  return spy.mock.calls.filter(([type]) => type === "beforeunload").length;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, "", "/purchases/create");
  addListenerSpy = jest.spyOn(window, "addEventListener");
  removeListenerSpy = jest.spyOn(window, "removeEventListener");
});

afterEach(() => {
  addListenerSpy.mockRestore();
  removeListenerSpy.mockRestore();
});

describe("useProcessGuard", () => {
  describe("beforeunload", () => {
    it("inactivo: no registra el listener ni cancela el evento", () => {
      const onSaveDraft = jest.fn();

      render(<Harness active={false} onSaveDraft={onSaveDraft} />);

      expect(beforeUnloadCalls(addListenerSpy)).toBe(0);
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
      expect(onSaveDraft).not.toHaveBeenCalled();
    });

    it("activo: registra el listener, cancela el evento y guarda el borrador de forma síncrona", () => {
      const onSaveDraft = jest.fn();

      render(<Harness onSaveDraft={onSaveDraft} />);

      expect(beforeUnloadCalls(addListenerSpy)).toBe(1);

      const event = fireBeforeUnload();

      expect(event.defaultPrevented).toBe(true);
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("con onLeave discard cancela el evento sin llamar a ningún manejador", () => {
      const onSaveDraft = jest.fn();
      const onDiscard = jest.fn();

      render(<Harness onDiscard={onDiscard} onLeave="discard" onSaveDraft={onSaveDraft} />);

      expect(fireBeforeUnload().defaultPrevented).toBe(true);
      expect(onSaveDraft).not.toHaveBeenCalled();
      expect(onDiscard).not.toHaveBeenCalled();
    });

    it("mantiene el aviso aunque el guardado del borrador falle", () => {
      const onSaveDraft = jest.fn(() => {
        throw new Error("sin espacio");
      });

      render(<Harness onSaveDraft={onSaveDraft} />);

      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("retira el listener al pasar a inactivo", () => {
      const { rerender } = render(<Harness />);

      rerender(<Harness active={false} />);

      expect(beforeUnloadCalls(removeListenerSpy)).toBe(1);
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });

    it("retira el listener al desmontar", () => {
      const { unmount } = render(<Harness />);

      unmount();

      expect(beforeUnloadCalls(removeListenerSpy)).toBe(1);
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });
  });

  describe("botón atrás del navegador (popstate)", () => {
    function setUpHistory() {
      window.history.pushState({}, "", "/inventory");
      window.history.pushState({}, "", "/purchases/create");
    }

    it("activo: abre el modal, restaura la URL y el router no ve el popstate", async () => {
      const routerPopState = jest.fn();

      setUpHistory();
      window.addEventListener("popstate", routerPopState);
      render(<Harness />);

      act(() => {
        window.history.back();
      });

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        "Compra a Distribuidora X · 12 líneas · REF 240,00",
      );
      await waitFor(() => expect(window.location.pathname).toBe("/purchases/create"));
      expect(routerPopState).not.toHaveBeenCalled();

      window.removeEventListener("popstate", routerPopState);
    });

    it("'Seguir aquí' deja la URL del proceso y no ejecuta nada", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();

      setUpHistory();
      render(<Harness onSaveDraft={onSaveDraft} />);

      act(() => {
        window.history.back();
      });
      await user.click(await screen.findByRole("button", { name: "Seguir aquí" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(window.location.pathname).toBe("/purchases/create");
      expect(onSaveDraft).not.toHaveBeenCalled();
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("'Salir' guarda el borrador y completa el atrás, que el router sí ve", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();
      const routerPopState = jest.fn();

      setUpHistory();
      window.addEventListener("popstate", routerPopState);
      render(<Harness onSaveDraft={onSaveDraft} />);

      act(() => {
        window.history.back();
      });
      await screen.findByRole("dialog");
      await waitFor(() => expect(window.location.pathname).toBe("/purchases/create"));
      await user.click(screen.getByRole("button", { name: "Salir" }));

      await waitFor(() => expect(window.location.pathname).toBe("/inventory"));
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
      expect(routerPopState).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();

      window.removeEventListener("popstate", routerPopState);
    });

    it("inactivo: el popstate pasa de largo", async () => {
      const routerPopState = jest.fn();

      setUpHistory();
      window.addEventListener("popstate", routerPopState);
      render(<Harness active={false} />);

      act(() => {
        window.history.back();
      });

      await waitFor(() => expect(routerPopState).toHaveBeenCalledTimes(1));
      expect(window.location.pathname).toBe("/inventory");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      window.removeEventListener("popstate", routerPopState);
    });

    it("no intercepta un atrás que se queda en la misma ruta (solo cambia la query)", async () => {
      const routerPopState = jest.fn();

      window.history.pushState({}, "", "/purchases/create?tab=lineas");
      window.history.pushState({}, "", "/purchases/create?tab=notas");
      window.addEventListener("popstate", routerPopState);
      render(<Harness />);

      act(() => {
        window.history.back();
      });

      await waitFor(() => expect(routerPopState).toHaveBeenCalledTimes(1));
      expect(window.location.search).toBe("?tab=lineas");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      window.removeEventListener("popstate", routerPopState);
    });
  });

  describe("guardedNavigate", () => {
    it("activo: pregunta y navega una vez al salir", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();

      render(<Harness onSaveDraft={onSaveDraft} />);

      await user.click(button(/ir a ventas/));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Salir" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/sales"));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });

    it("respeta replace", async () => {
      const user = userEvent.setup();

      render(<Harness />);

      await user.click(button(/reemplazar por ventas/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sales"));
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("inactivo: navega directo", async () => {
      const user = userEvent.setup();

      render(<Harness active={false} />);

      await user.click(button(/ir a ventas/));

      expect(mockPush).toHaveBeenCalledWith("/sales");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("requestLeave", () => {
    it("pide confirmación sin navegación y ejecuta la acción al salir", async () => {
      const user = userEvent.setup();
      const onClosed = jest.fn();
      const onDiscard = jest.fn();

      render(<Harness onClosed={onClosed} onDiscard={onDiscard} onLeave="discard" />);

      await user.click(button(/cerrar formulario/));

      expect(await screen.findByRole("dialog")).toHaveTextContent(/se perderán los cambios/i);
      expect(onClosed).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Salir" }));

      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("'Seguir aquí' no ejecuta la acción", async () => {
      const user = userEvent.setup();
      const onClosed = jest.fn();

      render(<Harness onClosed={onClosed} />);

      await user.click(button(/cerrar formulario/));
      await user.click(await screen.findByRole("button", { name: "Seguir aquí" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onClosed).not.toHaveBeenCalled();
    });

    it("inactivo: ejecuta la acción directamente", async () => {
      const user = userEvent.setup();
      const onClosed = jest.fn();

      render(<Harness active={false} onClosed={onClosed} />);

      await user.click(button(/cerrar formulario/));

      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("runUnguarded y bypass", () => {
    it("runUnguarded navega sin preguntar y apaga el guardia", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();

      render(<Harness onSaveDraft={onSaveDraft} />);

      await user.click(button(/terminar/));

      expect(mockPush).toHaveBeenCalledWith("/purchases/p-1");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
      expect(onSaveDraft).not.toHaveBeenCalled();
    });

    it("bypass dura hasta que active vuelve a pasar por false", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Harness />);

      await user.click(button(/bypass/));
      rerender(<Harness />);

      expect(fireBeforeUnload().defaultPrevented).toBe(false);

      rerender(<Harness active={false} />);
      rerender(<Harness />);

      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });
  });

  describe("varios guardias activos", () => {
    function Stacked({ modalActive = true }: { modalActive?: boolean }) {
      return (
        <>
          <Harness label="Compra a Distribuidora X" name="pagina" onSaveDraft={pageSaveDraft} />
          <Harness
            active={modalActive}
            label="Producto nuevo"
            name="modal"
            onClosed={modalClosed}
            onDiscard={modalDiscard}
            onLeave="discard"
          />
        </>
      );
    }

    const pageSaveDraft = jest.fn();
    const modalDiscard = jest.fn();
    const modalClosed = jest.fn();

    it("pregunta el más reciente y solo hay un modal", async () => {
      const user = userEvent.setup();

      render(<Stacked />);

      await user.click(button(/pagina: ir a ventas/));

      const dialogs = await screen.findAllByRole("dialog");

      expect(dialogs).toHaveLength(1);
      expect(dialogs[0]).toHaveTextContent("Producto nuevo");
      expect(dialogs[0]).not.toHaveTextContent("Compra a Distribuidora X");
    });

    it("al salir de la ruta cierra todos los procesos y navega una vez", async () => {
      const user = userEvent.setup();

      render(<Stacked />);

      await user.click(button(/pagina: ir a ventas/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(modalDiscard).toHaveBeenCalledTimes(1);
      expect(pageSaveDraft).toHaveBeenCalledTimes(1);
      expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });

    it("cerrar el modal de formulario solo descarta ese proceso", async () => {
      const user = userEvent.setup();

      render(<Stacked />);

      await user.click(button(/modal: cerrar formulario/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));

      await waitFor(() => expect(modalClosed).toHaveBeenCalledTimes(1));
      expect(modalDiscard).toHaveBeenCalledTimes(1);
      expect(pageSaveDraft).not.toHaveBeenCalled();
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("un formulario sin cambios se cierra directo aunque la página siga protegida", async () => {
      const user = userEvent.setup();

      render(<Stacked modalActive={false} />);

      await user.click(button(/modal: cerrar formulario/));

      expect(modalClosed).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("al desactivarse el más reciente vuelve a mandar el anterior", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Stacked />);

      rerender(<Stacked modalActive={false} />);
      await user.click(button(/pagina: ir a ventas/));

      expect(await screen.findByRole("dialog")).toHaveTextContent("Compra a Distribuidora X");
    });
  });
});
