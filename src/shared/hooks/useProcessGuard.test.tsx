import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, StrictMode } from "react";

import { ProcessGuardModal } from "@/shared/components/ProcessGuard";

import {
  PROCESS_GUARD_LEAVE_TIMEOUT_MS,
  useProcessGuard,
  type UseProcessGuardOptions,
} from "./useProcessGuard";

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

    describe("salida en curso (onSaveDraft lento)", () => {
      function slowSave() {
        let finish: () => void = () => undefined;
        const onSaveDraft = jest.fn(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
        );

        return { finish: () => act(async () => finish()), onSaveDraft };
      }

      async function expectStillPending(user: ReturnType<typeof userEvent.setup>) {
        const leaveButton = screen.getByRole("button", { name: "Salir" });
        const stayButton = screen.getByRole("button", { name: "Seguir aquí" });

        expect(leaveButton).toBeDisabled();
        expect(stayButton).toBeDisabled();

        // Aunque algo los rehabilitara, ni un segundo "Salir" ni "Seguir aquí" ni Esc cambian nada.
        fireEvent.click(leaveButton);
        fireEvent.click(stayButton);
        await user.keyboard("{Escape}");
        await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

        expect(screen.getAllByRole("dialog")).toHaveLength(1);
      }

      it("ATRÁS a mitad del guardado: el modal sigue bloqueado, se guarda una vez y se sale una vez al destino pedido", async () => {
        const user = userEvent.setup();
        const { finish, onSaveDraft } = slowSave();

        renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

        await user.click(button(/ir a ventas/));
        await user.click(await screen.findByRole("button", { name: "Salir" }));
        await browserBack();

        await expectStillPending(user);
        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        expect(mockPush).not.toHaveBeenCalled();
        expect(window.location.pathname).toBe(PROCESS_PATH);
        expect(window.history.state).toMatchObject({ __processGuard: "sentinel" });

        await finish();

        await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
        expect(mockPush).toHaveBeenCalledWith("/sales");
        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      });

      it("salida por ATRÁS + otro ATRÁS a mitad del guardado: retrocede una sola vez a la ruta anterior", async () => {
        const user = userEvent.setup();
        const { finish, onSaveDraft } = slowSave();

        renderUnderRouter(<Harness onSaveDraft={onSaveDraft} />);

        await browserBack();
        await user.click(await screen.findByRole("button", { name: "Salir" }));
        await browserBack();

        await expectStillPending(user);
        expect(window.location.pathname).toBe(PROCESS_PATH);

        const go = jest.spyOn(window.history, "go");

        await finish();
        await waitFor(() => expect(window.location.pathname).toBe("/inventory"));

        expect(go.mock.calls).toEqual([[-2]]);
        expect(onSaveDraft).toHaveBeenCalledTimes(1);
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        go.mockRestore();
      });

      it("otra petición de salida a mitad del guardado no sustituye el destino ni rehabilita el modal", async () => {
        const user = userEvent.setup();
        const { finish, onSaveDraft } = slowSave();
        const onClosed = jest.fn();

        renderUnderRouter(<Harness onClosed={onClosed} onSaveDraft={onSaveDraft} />);

        await user.click(button(/ir a ventas/));
        await user.click(await screen.findByRole("button", { name: "Salir" }));
        // El modal de Radix deja el fondo inerte: se dispara el clic sin puntero.
        fireEvent.click(screen.getByText(/cerrar formulario/));

        await expectStillPending(user);

        await finish();

        await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
        expect(mockPush).toHaveBeenCalledWith("/sales");
        expect(onClosed).not.toHaveBeenCalled();
        expect(onSaveDraft).toHaveBeenCalledTimes(1);
      });
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

    it("si el proceso sigue activo tras salir de la acción, la siguiente petición vuelve a preguntar", async () => {
      const user = userEvent.setup();
      const onClosed = jest.fn();
      const onDiscard = jest.fn();

      render(<Harness onClosed={onClosed} onDiscard={onDiscard} onLeave="discard" />);

      await user.click(button(/cerrar formulario/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));
      await waitFor(() => expect(onClosed).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(button(/cerrar formulario/));

      expect(await screen.findByRole("button", { name: "Salir" })).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "Seguir aquí" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(onDiscard).toHaveBeenCalledTimes(1);
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

    it("'Reintentar' no repite el manejador del guardia que ya había terminado bien", async () => {
      const user = userEvent.setup();
      const outerSaveDraft = jest
        .fn()
        .mockRejectedValueOnce(new Error("Sin conexión con el servidor"))
        .mockResolvedValue(undefined);
      const innerDiscard = jest.fn();

      render(
        <>
          <Harness name="pagina" onSaveDraft={outerSaveDraft} />
          <Harness name="modal" onDiscard={innerDiscard} onLeave="discard" />
        </>,
      );

      await user.click(button(/pagina: ir a ventas/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión con el servidor");
      expect(innerDiscard).toHaveBeenCalledTimes(1);
      expect(outerSaveDraft).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(mockPush).toHaveBeenCalledWith("/sales");
      expect(outerSaveDraft).toHaveBeenCalledTimes(2);
      expect(innerDiscard).toHaveBeenCalledTimes(1);
    });

    it("tras 'Seguir aquí' la siguiente salida vuelve a ejecutar todos los manejadores", async () => {
      const user = userEvent.setup();
      const outerSaveDraft = jest
        .fn()
        .mockRejectedValueOnce(new Error("Sin conexión con el servidor"))
        .mockResolvedValue(undefined);
      const innerDiscard = jest.fn();

      render(
        <>
          <Harness name="pagina" onSaveDraft={outerSaveDraft} />
          <Harness name="modal" onDiscard={innerDiscard} onLeave="discard" />
        </>,
      );

      await user.click(button(/pagina: ir a ventas/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));
      await screen.findByRole("alert");
      await user.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(button(/pagina: ir a ventas/));
      await user.click(await screen.findByRole("button", { name: "Salir" }));

      await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
      expect(innerDiscard).toHaveBeenCalledTimes(2);
      expect(outerSaveDraft).toHaveBeenCalledTimes(2);
    });
  });

  describe("salida que no termina (onSaveDraft / onDiscard colgado)", () => {
    const TIMEOUT_MS = 5_000;

    /** Manejador que solo termina cuando el test lo decide. */
    function hangingHandler() {
      let resolveRun: () => void = () => undefined;
      let rejectRun: (reason: Error) => void = () => undefined;
      const handler = jest.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            resolveRun = resolve;
            rejectRun = reject;
          }),
      );

      return {
        fail: (message: string) => act(async () => rejectRun(new Error(message))),
        finish: () => act(async () => resolveRun()),
        handler,
      };
    }

    // Con timers falsos `findBy`/`waitFor` adelantarían el reloj por su cuenta: se avanza a mano.
    function advance(ms: number) {
      return act(async () => {
        jest.advanceTimersByTime(ms);
      });
    }

    function askAndLeave(trigger = /ir a ventas/) {
      fireEvent.click(button(trigger));
      fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    }

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it("hasta el tiempo de espera el modal sigue bloqueado; después ofrece seguir aquí o salir sin guardar, sin un segundo guardado", async () => {
      const { handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();

      await advance(TIMEOUT_MS - 1);

      expect(screen.getByRole("button", { name: "Salir" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Seguir aquí" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Salir sin guardar" })).not.toBeInTheDocument();

      await advance(1);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Guardar el borrador está tardando más de lo normal.",
      );
      expect(screen.getByRole("button", { name: "Seguir aquí" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Seguir aquí" })).toHaveFocus();
      expect(screen.getByRole("button", { name: "Salir sin guardar" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Salir" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("sin opción usa el tiempo de espera por defecto", async () => {
      const { handler } = hangingHandler();

      render(<Harness onSaveDraft={handler} />);
      askAndLeave();

      await advance(PROCESS_GUARD_LEAVE_TIMEOUT_MS - 1);
      expect(screen.getByRole("button", { name: "Seguir aquí" })).toBeDisabled();

      await advance(1);
      expect(screen.getByRole("button", { name: "Seguir aquí" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Salir sin guardar" })).toBeEnabled();
    });

    it("con discard el aviso y la salida usan los textos del descarte", async () => {
      const { handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onDiscard={handler} onLeave="discard" />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Descartar los cambios está tardando más de lo normal.",
      );
      expect(screen.getByRole("button", { name: "Salir de todos modos" })).toBeEnabled();
    });

    it("'Seguir aquí' cierra el modal y, si el guardado termina después, no saca de la pantalla", async () => {
      const { finish, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await advance(0);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await finish();
      await advance(TIMEOUT_MS);

      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(handler).toHaveBeenCalledTimes(1);
      // El proceso sigue protegido.
      expect(fireBeforeUnload().defaultPrevented).toBe(true);
    });

    it("Esc con la salida atascada equivale a 'Seguir aquí'", async () => {
      const { finish, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await advance(1);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await finish();

      expect(mockPush).not.toHaveBeenCalled();
    });

    it("tras 'Seguir aquí', otro 'Salir' con el guardado aún colgado espera al mismo: no lanza un segundo en paralelo", async () => {
      const { finish, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);
      fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await advance(0);

      askAndLeave(/reemplazar por ventas/);
      await advance(0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Salir" })).toBeDisabled();

      await finish();

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/sales");
      expect(mockPush).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("'Salir sin guardar' sale una vez y el guardado que termina después no navega otra vez", async () => {
      const { finish, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      const leaveWithoutSaving = screen.getByRole("button", { name: "Salir sin guardar" });

      fireEvent.click(leaveWithoutSaving);
      fireEvent.click(leaveWithoutSaving);
      await advance(0);

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith("/sales");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(fireBeforeUnload().defaultPrevented).toBe(false);

      await finish();
      await advance(TIMEOUT_MS);

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("'Salir sin guardar' y el guardado falla después: no reabre el modal ni muestra el error", async () => {
      const { fail, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);
      fireEvent.click(screen.getByRole("button", { name: "Salir sin guardar" }));
      await advance(0);

      await fail("Sin conexión con el servidor");

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("si el guardado termina con la salida atascada y sin elegir nada, sale una vez al destino pedido", async () => {
      const { finish, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      await finish();

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith("/sales");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("si el guardado falla con la salida atascada, pasa al estado de fallo con 'Reintentar'", async () => {
      const { fail, handler } = hangingHandler();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      await fail("Sin conexión con el servidor");

      expect(screen.getByRole("alert")).toHaveTextContent(/^Sin conexión con el servidor$/);
      expect(screen.getByRole("dialog")).not.toHaveTextContent(/está tardando/);
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Salir sin guardar" })).toBeEnabled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("una salida que termina a tiempo no deja el aviso programado para la siguiente", async () => {
      const { finish, handler } = hangingHandler();
      const onClosed = jest.fn();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onClosed={onClosed} onSaveDraft={handler} />);
      askAndLeave(/cerrar formulario/);
      await advance(TIMEOUT_MS - 1_000);
      await finish();

      expect(onClosed).toHaveBeenCalledTimes(1);

      askAndLeave(/cerrar formulario/);
      await advance(1_000);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Salir" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Seguir aquí" })).toBeDisabled();
    });

    it("otra petición de salida con la salida atascada no sustituye el destino ni quita el aviso", async () => {
      const { finish, handler } = hangingHandler();
      const onClosed = jest.fn();

      render(<Harness leaveTimeoutMs={TIMEOUT_MS} onClosed={onClosed} onSaveDraft={handler} />);
      askAndLeave();
      await advance(TIMEOUT_MS);

      fireEvent.click(screen.getByText(/cerrar formulario/));
      await advance(0);

      expect(screen.getByRole("button", { name: "Salir sin guardar" })).toBeEnabled();

      await finish();

      expect(mockPush).toHaveBeenCalledWith("/sales");
      expect(onClosed).not.toHaveBeenCalled();
    });

    it("guardias apilados: tras 'Seguir aquí', el manejador colgado que termina después no arrastra al del otro guardia", async () => {
      const { finish, handler } = hangingHandler();
      const outerSaveDraft = jest.fn();

      render(
        <>
          <Harness name="pagina" onSaveDraft={outerSaveDraft} />
          <Harness
            leaveTimeoutMs={TIMEOUT_MS}
            name="modal"
            onDiscard={handler}
            onLeave="discard"
          />
        </>,
      );
      askAndLeave(/pagina: ir a ventas/);
      await advance(TIMEOUT_MS);
      fireEvent.click(screen.getByRole("button", { name: "Seguir aquí" }));
      await advance(0);

      await finish();

      expect(outerSaveDraft).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
