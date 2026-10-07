import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, StrictMode } from "react";

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
  sameRouteHref?: string;
};

function Harness({ name = "proceso", onClosed, sameRouteHref, ...options }: HarnessProps) {
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
      {sameRouteHref ? (
        <button onClick={() => guard.guardedNavigate(sameRouteHref)} type="button">
          {`${name}: cambiar de pestaña`}
        </button>
      ) : null}
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

  describe("atrás del navegador con el orden real de listeners (Next antes que el guardia)", () => {
    const PROCESS_PATH = "/purchases/create";
    let routerPopState: jest.Mock;
    let unmountScreen: () => void;
    let lengthBeforeGuard: number;

    /** Entradas que el guardia ha añadido al historial. */
    function sentinelEntries() {
      return window.history.length - lengthBeforeGuard;
    }

    /**
     * Reproduce el router real: su `popstate` se registró antes que el del
     * guardia y, si la URL ya no es la del proceso, React desmonta la pantalla
     * de forma síncrona dentro de ese mismo evento.
     */
    function renderUnderRouter(ui: ReactElement, wrapper?: typeof StrictMode) {
      window.history.pushState({ __NA: true }, "", "/inventory");
      window.history.pushState({ __NA: true }, "", PROCESS_PATH);
      lengthBeforeGuard = window.history.length;
      routerPopState = jest.fn(() => {
        if (window.location.pathname !== PROCESS_PATH) {
          unmountScreen();
        }
      });
      window.addEventListener("popstate", routerPopState);

      const view = render(ui, { wrapper });

      unmountScreen = view.unmount;

      return view;
    }

    async function browserBack() {
      const seen = routerPopState.mock.calls.length;

      act(() => {
        window.history.back();
      });
      await waitFor(() => expect(routerPopState.mock.calls.length).toBeGreaterThan(seen));
      // Con guardia activo el atrás rebota: se espera también la vuelta al centinela.
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    }

    afterEach(() => {
      window.removeEventListener("popstate", routerPopState);
    });

    it("activo: duplica la entrada actual una sola vez, con la misma URL y el estado del router", () => {
      renderUnderRouter(<Harness />);

      expect(sentinelEntries()).toBe(1);
      expect(window.history.state).toMatchObject({ __NA: true });
      expect(window.location.pathname).toBe(PROCESS_PATH);
    });

    it("StrictMode (doble montaje) no empuja dos centinelas", () => {
      renderUnderRouter(<Harness />, StrictMode);

      expect(sentinelEntries()).toBe(1);
    });

    it("varios guardias apilados comparten un solo centinela", () => {
      renderUnderRouter(
        <>
          <Harness name="pagina" />
          <Harness name="modal" onLeave="discard" />
        </>,
      );

      expect(sentinelEntries()).toBe(1);
    });

    it("inactivo: no toca el historial y atrás sale sin preguntar", async () => {
      renderUnderRouter(<Harness active={false} />);

      expect(sentinelEntries()).toBe(0);

      await browserBack();

      expect(window.location.pathname).toBe("/inventory");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("atrás con guardia activo: abre el modal y la pantalla del proceso sigue montada en su URL", async () => {
      const onSaveDraft = jest.fn();

      renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

      await browserBack();

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        "Compra a Distribuidora X · 12 líneas · REF 240,00",
      );
      expect(window.location.pathname).toBe(PROCESS_PATH);
      expect(screen.getByText(/ir a ventas/)).toBeInTheDocument();
      expect(onSaveDraft).not.toHaveBeenCalled();
    });

    it("'Seguir aquí' deja el centinela repuesto: el siguiente atrás vuelve a preguntar", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();

      renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

      await browserBack();
      await user.click(await screen.findByRole("button", { name: "Seguir aquí" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      expect(sentinelEntries()).toBe(1);
      expect(window.location.pathname).toBe(PROCESS_PATH);
      expect(onSaveDraft).not.toHaveBeenCalled();

      await browserBack();

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(window.location.pathname).toBe(PROCESS_PATH);
      expect(sentinelEntries()).toBe(1);
    });

    it("atrás repetido: vuelve al centinela que ya existe, sin crear entradas, y hay un solo modal", async () => {
      renderUnderRouter(<Harness />);

      const pushState = jest.spyOn(window.history, "pushState");

      await browserBack();
      await browserBack();

      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(window.location.pathname).toBe(PROCESS_PATH);
      expect(window.history.state).toMatchObject({ __processGuard: "sentinel" });
      expect(pushState).not.toHaveBeenCalled();
      expect(sentinelEntries()).toBe(1);

      pushState.mockRestore();
    });

    it("la URL escrita después de activar (replace de filtros) sigue vigente tras atrás y 'Seguir aquí'", async () => {
      const user = userEvent.setup();

      renderUnderRouter(<Harness />);
      // Query superficial documentada por Next: `replaceState` con dato `null`.
      window.history.replaceState(null, "", `${PROCESS_PATH}?estado=active`);

      await browserBack();
      await user.click(await screen.findByRole("button", { name: "Seguir aquí" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      expect(`${window.location.pathname}${window.location.search}`).toBe(
        `${PROCESS_PATH}?estado=active`,
      );
      expect(window.history.state).toMatchObject({ __processGuard: "sentinel" });
      expect(sentinelEntries()).toBe(1);
    });

    it("'Salir' guarda el borrador una vez y retrocede de una vez a la ruta anterior", async () => {
      const user = userEvent.setup();
      const onSaveDraft = jest.fn();

      renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

      await browserBack();

      const go = jest.spyOn(window.history, "go");
      const leaveButton = await screen.findByRole("button", { name: "Salir" });

      await user.dblClick(leaveButton);
      await waitFor(() => expect(window.location.pathname).toBe("/inventory"));

      expect(onSaveDraft).toHaveBeenCalledTimes(1);
      expect(go.mock.calls).toEqual([[-2]]);
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      go.mockRestore();
    });

    it("proceso terminado (guardia desactivado): un solo atrás sale de la pantalla, sin modal", async () => {
      const { rerender } = renderUnderRouter(<Harness />);

      rerender(<Harness active={false} />);

      act(() => {
        window.history.back();
      });

      await waitFor(() => expect(window.location.pathname).toBe("/inventory"));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("desactivar y reactivar reutiliza el centinela", () => {
      const { rerender } = renderUnderRouter(<Harness />);

      rerender(<Harness active={false} />);
      rerender(<Harness />);

      expect(sentinelEntries()).toBe(1);
    });

    it("si el router reescribe el estado de la entrada (refresh, query) el centinela se sigue reconociendo", async () => {
      const { rerender } = renderUnderRouter(<Harness />);

      // Next hace `replaceState` solo con su estado, sin claves ajenas.
      window.history.replaceState({ __NA: true }, "", `${PROCESS_PATH}?tab=notas`);
      rerender(<Harness active={false} />);
      rerender(<Harness />);

      expect(sentinelEntries()).toBe(1);

      await browserBack();

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(sentinelEntries()).toBe(1);
    });

    it("tras salir por un enlace, volver atrás recorre el par gemela/centinela sin atrás muerto", async () => {
      const user = userEvent.setup();

      mockPush.mockImplementation((href: string) => {
        unmountScreen();
        window.history.pushState({ __NA: true }, "", href);
      });
      renderUnderRouter(<Harness />);

      await user.click(button(/ir a ventas/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));
      await waitFor(() => expect(window.location.pathname).toBe("/sales"));

      await browserBack();
      expect(window.location.pathname).toBe(PROCESS_PATH);

      act(() => {
        window.history.back();
      });
      await waitFor(() => expect(window.location.pathname).toBe("/inventory"));

      mockPush.mockReset();
    });

    it("adelante hasta la gemela de un proceso cerrado no rebota hacia atrás", async () => {
      const user = userEvent.setup();

      renderUnderRouter(<Harness />);

      await browserBack();
      await user.click(await screen.findByRole("button", { name: "Salir" }));
      await waitFor(() => expect(window.location.pathname).toBe("/inventory"));

      const seen = routerPopState.mock.calls.length;

      act(() => {
        window.history.forward();
      });
      await waitFor(() => expect(routerPopState.mock.calls.length).toBeGreaterThan(seen));
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      expect(window.location.pathname).toBe(PROCESS_PATH);
    });

    describe("parche de history.replaceState", () => {
      function Nested({ modal = true, page = true }: { modal?: boolean; page?: boolean }) {
        return (
          <>
            <Harness active={page} name="pagina" />
            <Harness active={modal} name="modal" onLeave="discard" />
          </>
        );
      }

      it("solo existe mientras hay algún guardia activo, contando los anidados", () => {
        const unpatched = window.history.replaceState;
        const { rerender, unmount } = renderUnderRouter(<Nested />);

        expect(window.history.replaceState).not.toBe(unpatched);

        rerender(<Nested modal={false} />);
        expect(window.history.replaceState).not.toBe(unpatched);

        rerender(<Nested modal={false} page={false} />);
        expect(window.history.replaceState).toBe(unpatched);

        rerender(<Nested />);
        expect(window.history.replaceState).not.toBe(unpatched);

        unmount();
        expect(window.history.replaceState).toBe(unpatched);
      });

      it("conserva la marca del centinela aunque el dato sea null", () => {
        renderUnderRouter(<Harness />);

        window.history.replaceState(null, "", `${PROCESS_PATH}?tab=2`);

        expect(window.history.state).toMatchObject({ __processGuard: "sentinel" });
      });
    });

    describe("salto de varias entradas de golpe (Navigation API)", () => {
      type NavigationHost = { navigation?: EventTarget & { currentEntry: { index: number } } };

      const host = window as unknown as NavigationHost;

      /** Evento `navigate` de un atrás/adelante hacia la entrada `index` del historial. */
      function traverseTo(index: number, cancelable: boolean) {
        const event = Object.assign(new Event("navigate", { cancelable }), {
          destination: { index, sameDocument: true },
          navigationType: "traverse",
        });

        act(() => {
          host.navigation?.dispatchEvent(event);
        });

        return event;
      }

      /** Índice de la entrada gemela: la anterior al centinela, que es la última. */
      function twinIndex() {
        return window.history.length - 2;
      }

      beforeEach(() => {
        // jsdom no tiene Navigation API. Al activarse el guardia se está en la última entrada.
        host.navigation = Object.defineProperty(new EventTarget(), "currentEntry", {
          get: () => ({ index: window.history.length - 1 }),
        }) as NavigationHost["navigation"];
      });

      afterEach(() => {
        delete host.navigation;
      });

      it("un atrás que pasaría por encima de la gemela se cancela y pregunta", async () => {
        const user = userEvent.setup();
        const onSaveDraft = jest.fn();

        renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

        const back = jest.spyOn(window.history, "back");
        const event = traverseTo(twinIndex() - 1, true);

        expect(event.defaultPrevented).toBe(true);
        expect(await screen.findByRole("dialog")).toBeInTheDocument();
        expect(onSaveDraft).not.toHaveBeenCalled();

        // Chromium ignora el `history.go` de "Salir" al destino cancelado si no hay otro movimiento antes.
        await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(routerPopState).toHaveBeenCalledTimes(2));
        expect(window.history.state).toMatchObject({ __processGuard: "sentinel" });
        back.mockRestore();

        await user.click(screen.getByRole("button", { name: "Salir" }));
        await waitFor(() => expect(window.location.pathname).toBe("/inventory"));

        expect(onSaveDraft).toHaveBeenCalledTimes(1);
      });

      it("segundo atrás mientras el primero aún vuelve al centinela: se cancela y sigue en el proceso", async () => {
        renderUnderRouter(<Harness />);

        const beyondTwin = twinIndex() - 1;
        // Chromium descarta el ADELANTE que estaba pendiente cuando se cancela el segundo atrás.
        const forward = jest.spyOn(window.history, "forward").mockImplementationOnce(() => undefined);

        act(() => {
          window.history.back();
        });
        await waitFor(() => expect(routerPopState).toHaveBeenCalledTimes(1));

        expect(traverseTo(beyondTwin, true).defaultPrevented).toBe(true);

        await waitFor(() => expect(routerPopState).toHaveBeenCalledTimes(2));
        forward.mockRestore();

        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        expect(window.location.pathname).toBe(PROCESS_PATH);
        expect(window.history.state).toMatchObject({ __processGuard: "sentinel" });
      });

      it("si el navegador no deja cancelarlo, guarda el borrador antes de salir", () => {
        const onSaveDraft = jest.fn();

        renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

        const event = traverseTo(twinIndex() - 1, false);

        expect(event.defaultPrevented).toBe(false);
        expect(onSaveDraft).toHaveBeenCalledTimes(1);
      });

      it("no toca el atrás hasta la gemela ni las entradas posteriores", () => {
        const onSaveDraft = jest.fn();

        renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

        expect(traverseTo(twinIndex(), true).defaultPrevented).toBe(false);
        expect(traverseTo(twinIndex() + 2, true).defaultPrevented).toBe(false);
        traverseTo(twinIndex() + 2, false);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(onSaveDraft).not.toHaveBeenCalled();
      });

      it("proceso terminado: deja de escuchar y el salto no se cancela", () => {
        const onSaveDraft = jest.fn();
        const { rerender } = renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);
        const beyondTwin = twinIndex() - 1;

        rerender(<Harness active={false} onSaveDraft={onSaveDraft} />);

        expect(traverseTo(beyondTwin, true).defaultPrevented).toBe(false);
        traverseTo(beyondTwin, false);
        expect(onSaveDraft).not.toHaveBeenCalled();
      });
    });

    it("un atrás dentro de la misma ruta (solo cambia la query) no pregunta", async () => {
      renderUnderRouter(<Harness />);
      window.history.pushState({ __NA: true }, "", `${PROCESS_PATH}?tab=notas`);

      await browserBack();

      expect(window.location.pathname).toBe(PROCESS_PATH);
      expect(window.location.search).toBe("");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

    it("destino en la misma ruta (solo query): navega sin preguntar, igual que los enlaces", async () => {
      const user = userEvent.setup();

      render(<Harness sameRouteHref="/purchases/create?tab=notas" />);

      await user.click(button(/cambiar de pestaña/));

      expect(mockPush).toHaveBeenCalledWith("/purchases/create?tab=notas");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
