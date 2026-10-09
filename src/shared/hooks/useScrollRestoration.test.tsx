import "@testing-library/jest-dom";
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";

import {
  MAX_SCROLL_ENTRIES,
  SCROLL_POSITIONS_STORAGE_KEY,
  SCROLL_RESTORE_MAX_MS,
  SCROLL_SAVE_THROTTLE_MS,
  useScrollRestoration,
} from "./useScrollRestoration";

const LIST_URL = "/products?search=harina&page=2";

type ScreenProps = {
  ready: boolean;
  url?: string;
  target?: "auto" | "ref" | "window";
  /** `overflow-y` del `<main>`, como lo pondría el `AppShell`. */
  mainOverflow?: "auto" | "hidden";
};

function Screen({ mainOverflow = "auto", ready, target = "auto", url }: ScreenProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useScrollRestoration(url, {
    container: target === "ref" ? ref : target === "window" ? "window" : undefined,
    ready,
  });

  return (
    <main data-testid="main" style={{ overflowY: mainOverflow }}>
      <div data-testid="panel" ref={ref} />
    </main>
  );
}

function stored(): [string, number][] {
  return JSON.parse(window.sessionStorage.getItem(SCROLL_POSITIONS_STORAGE_KEY) ?? "[]");
}

function store(entries: [string, number][]) {
  window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify(entries));
}

function scrollTo(element: HTMLElement, top: number) {
  element.scrollTop = top;
  fireEvent.scroll(element);
}

function setWindowScroll(top: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, value: top });
}

const scrollToSpy = jest.fn((_x: number, top: number) => setWindowScroll(top));

beforeEach(() => {
  jest.useFakeTimers();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  setWindowScroll(0);
  scrollToSpy.mockClear();
  Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollToSpy });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("useScrollRestoration", () => {
  describe("guardar", () => {
    it("guarda la posición por URL con throttle al hacer scroll", () => {
      const view = render(<Screen ready url={LIST_URL} />);
      const main = view.getByTestId("main");

      scrollTo(main, 120);
      scrollTo(main, 480);

      expect(stored()).toEqual([]);

      act(() => {
        jest.advanceTimersByTime(SCROLL_SAVE_THROTTLE_MS);
      });

      expect(stored()).toEqual([[LIST_URL, 480]]);
    });

    it("guarda la última posición al desmontar, sin esperar al throttle", () => {
      const view = render(<Screen ready url={LIST_URL} />);

      scrollTo(view.getByTestId("main"), 300);
      view.unmount();

      expect(stored()).toEqual([[LIST_URL, 300]]);
    });

    it("guarda al salir de la página (pagehide)", () => {
      const view = render(<Screen ready url={LIST_URL} />);

      scrollTo(view.getByTestId("main"), 210);
      fireEvent(window, new Event("pagehide"));

      expect(stored()).toEqual([[LIST_URL, 210]]);
    });

    it("cada URL guarda su propia posición", () => {
      const view = render(<Screen ready url="/products" />);
      const main = view.getByTestId("main");

      scrollTo(main, 100);
      act(() => {
        jest.advanceTimersByTime(SCROLL_SAVE_THROTTLE_MS);
      });

      view.rerender(<Screen ready url="/products?status=active" />);
      scrollTo(main, 640);
      view.unmount();

      expect(stored()).toEqual([
        ["/products", 100],
        ["/products?status=active", 640],
      ]);
    });

    it("no guarda nada antes de que los datos estén listos", () => {
      store([[LIST_URL, 500]]);

      const view = render(<Screen ready={false} url={LIST_URL} />);

      scrollTo(view.getByTestId("main"), 0);
      act(() => {
        jest.advanceTimersByTime(SCROLL_SAVE_THROTTLE_MS * 2);
      });
      view.unmount();

      expect(stored()).toEqual([[LIST_URL, 500]]);
    });

    it("volver arriba del todo libera la entrada", () => {
      store([[LIST_URL, 500]]);

      const view = render(<Screen ready url={LIST_URL} />);

      scrollTo(view.getByTestId("main"), 0);
      view.unmount();

      expect(stored()).toEqual([]);
    });

    it("acota el número de entradas y descarta las más antiguas", () => {
      store(
        Array.from({ length: MAX_SCROLL_ENTRIES }, (_, index): [string, number] => [
          `/lista-${index}`,
          index + 1,
        ]),
      );

      const view = render(<Screen ready url={LIST_URL} />);

      scrollTo(view.getByTestId("main"), 77);
      view.unmount();

      const entries = stored();

      expect(entries).toHaveLength(MAX_SCROLL_ENTRIES);
      expect(entries[0][0]).toBe("/lista-1");
      expect(entries[entries.length - 1]).toEqual([LIST_URL, 77]);
    });

    it("no guarda claves desmesuradas", () => {
      const view = render(<Screen ready url={`/products?search=${"a".repeat(2100)}`} />);

      scrollTo(view.getByTestId("main"), 90);
      view.unmount();

      expect(stored()).toEqual([]);
    });
  });

  describe("restaurar", () => {
    it("restaura la posición de esa URL solo cuando ready pasa a true", () => {
      store([
        ["/products", 50],
        [LIST_URL, 480],
      ]);

      const view = render(<Screen ready={false} url={LIST_URL} />);
      const main = view.getByTestId("main");

      expect(main.scrollTop).toBe(0);

      view.rerender(<Screen ready url={LIST_URL} />);

      expect(main.scrollTop).toBe(480);
    });

    it("restaura una sola vez por visita aunque ready vuelva a cambiar", () => {
      store([[LIST_URL, 480]]);

      const view = render(<Screen ready url={LIST_URL} />);
      const main = view.getByTestId("main");

      scrollTo(main, 30);
      view.rerender(<Screen ready={false} url={LIST_URL} />);
      view.rerender(<Screen ready url={LIST_URL} />);

      expect(main.scrollTop).toBe(30);
    });

    it("no restaura la posición de otra URL", () => {
      store([["/products?page=3", 480]]);

      const view = render(<Screen ready url={LIST_URL} />);

      expect(view.getByTestId("main").scrollTop).toBe(0);
    });

    it("ida y vuelta: al volver a montar la lista recupera el scroll", () => {
      const list = render(<Screen ready url={LIST_URL} />);

      scrollTo(list.getByTestId("main"), 725);
      list.unmount();

      const back = render(<Screen ready={false} url={LIST_URL} />);

      back.rerender(<Screen ready url={LIST_URL} />);

      expect(back.getByTestId("main").scrollTop).toBe(725);
    });

    it("sin clave usa la URL del navegador", () => {
      window.history.replaceState(null, "", "/sales?estado=paid");
      store([["/sales?estado=paid", 333]]);

      const view = render(<Screen ready />);
      const main = view.getByTestId("main");

      expect(main.scrollTop).toBe(333);

      scrollTo(main, 90);
      // Al desmontar, el navegador ya está en la pantalla siguiente.
      window.history.replaceState(null, "", "/sales/s-1");
      view.unmount();

      expect(stored()).toEqual([["/sales?estado=paid", 90]]);
    });
  });

  // DET-F4: por debajo de 768 px la lista monta primero la tabla y luego las
  // tarjetas; el alto cambia después de `ready` y el navegador mueve el scroll.
  describe("el alto cambia después de ready", () => {
    const FRAME_MS = 16;

    /** Da al elemento un alto de contenido y recorta `scrollTop` como el navegador. */
    function fakeLayout(element: HTMLElement, maxScroll: number) {
      const layout = { maxScroll, top: 0 };

      Object.defineProperty(element, "scrollHeight", {
        configurable: true,
        get: () => layout.maxScroll + 844,
      });
      Object.defineProperty(element, "scrollTop", {
        configurable: true,
        get: () => layout.top,
        set: (top: number) => {
          layout.top = Math.min(Math.max(0, top), layout.maxScroll);
        },
      });

      return layout;
    }

    function frames(count: number) {
      act(() => {
        jest.advanceTimersByTime(FRAME_MS * count);
      });
    }

    function mountNotReady() {
      const view = render(<Screen ready={false} url={LIST_URL} />);
      const main = view.getByTestId("main");

      return { main, view };
    }

    it("alcanza la posición guardada cuando el contenido crece y antes no cabía", () => {
      store([[LIST_URL, 700]]);

      const { main, view } = mountNotReady();
      const layout = fakeLayout(main, 306);

      view.rerender(<Screen ready url={LIST_URL} />);
      expect(main.scrollTop).toBe(306);

      // Las tarjetas sustituyen a la tabla: ahora la posición sí cabe.
      layout.maxScroll = 1429;
      frames(2);

      expect(main.scrollTop).toBe(700);

      view.unmount();
      expect(stored()).toEqual([[LIST_URL, 700]]);
    });

    it("vuelve a la posición guardada si el cambio de alto mueve el scroll, sin guardar la mala", () => {
      store([[LIST_URL, 700]]);

      const { main, view } = mountNotReady();
      const layout = fakeLayout(main, 900);

      view.rerender(<Screen ready url={LIST_URL} />);
      expect(main.scrollTop).toBe(700);

      // El navegador ancla el scroll al paginador y lo lleva al fondo.
      layout.maxScroll = 2505;
      layout.top = 2505;
      fireEvent.scroll(main);

      act(() => {
        jest.advanceTimersByTime(SCROLL_SAVE_THROTTLE_MS * 2);
      });

      expect(main.scrollTop).toBe(700);
      expect(stored()).toEqual([[LIST_URL, 700]]);

      view.unmount();
      expect(stored()).toEqual([[LIST_URL, 700]]);
    });

    it("al salir antes de alcanzarla conserva la posición guardada", () => {
      store([[LIST_URL, 700]]);

      const { main, view } = mountNotReady();

      fakeLayout(main, 306);
      view.rerender(<Screen ready url={LIST_URL} />);
      frames(2);
      fireEvent(window, new Event("pagehide"));

      expect(stored()).toEqual([[LIST_URL, 700]]);

      view.unmount();
      expect(stored()).toEqual([[LIST_URL, 700]]);
    });

    it.each([
      ["rueda", () => fireEvent.wheel(window)],
      ["tacto", () => fireEvent.touchStart(window)],
      ["teclado", () => fireEvent.keyDown(window, { key: "PageDown" })],
      ["puntero", () => fireEvent.pointerDown(window)],
    ])("deja de restaurar si el usuario se desplaza con %s", (_label, interact) => {
      store([[LIST_URL, 700]]);

      const { main, view } = mountNotReady();
      const layout = fakeLayout(main, 306);

      view.rerender(<Screen ready url={LIST_URL} />);
      interact();

      layout.maxScroll = 1429;
      frames(4);
      expect(main.scrollTop).toBe(306);

      scrollTo(main, 400);
      view.unmount();

      expect(stored()).toEqual([[LIST_URL, 400]]);
    });

    it("un scroll sin cambio de alto es del usuario: no se pelea y se guarda", () => {
      store([[LIST_URL, 700]]);

      const { main, view } = mountNotReady();
      const layout = fakeLayout(main, 2000);

      view.rerender(<Screen ready url={LIST_URL} />);
      scrollTo(main, 150);

      layout.maxScroll = 2600;
      frames(4);
      expect(main.scrollTop).toBe(150);

      view.unmount();
      expect(stored()).toEqual([[LIST_URL, 150]]);
    });

    it("pasado el tope de tiempo deja de restaurar y guarda la posición real", () => {
      store([[LIST_URL, 700]]);

      const { main, view } = mountNotReady();
      const layout = fakeLayout(main, 306);

      view.rerender(<Screen ready url={LIST_URL} />);

      act(() => {
        jest.advanceTimersByTime(SCROLL_RESTORE_MAX_MS + FRAME_MS);
      });

      layout.maxScroll = 1429;
      frames(4);
      expect(main.scrollTop).toBe(306);

      view.unmount();
      expect(stored()).toEqual([[LIST_URL, 306]]);
    });
  });

  describe("contenedor de scroll", () => {
    it("usa la ventana si el main no hace scroll", () => {
      store([[LIST_URL, 260]]);

      const view = render(<Screen mainOverflow="hidden" ready url={LIST_URL} />);

      expect(scrollToSpy).toHaveBeenCalledWith(0, 260);
      expect(view.getByTestId("main").scrollTop).toBe(0);

      setWindowScroll(910);
      fireEvent.scroll(window);
      view.unmount();

      expect(stored()).toEqual([[LIST_URL, 910]]);
    });

    it("con container window usa la ventana aunque el main haga scroll", () => {
      store([[LIST_URL, 260]]);

      const view = render(<Screen ready target="window" url={LIST_URL} />);

      expect(scrollToSpy).toHaveBeenCalledWith(0, 260);
      expect(view.getByTestId("main").scrollTop).toBe(0);
    });

    it("acepta un ref al elemento que hace scroll", () => {
      store([[LIST_URL, 140]]);

      const view = render(<Screen ready target="ref" url={LIST_URL} />);
      const panel = view.getByTestId("panel");

      expect(panel.scrollTop).toBe(140);
      expect(view.getByTestId("main").scrollTop).toBe(0);

      scrollTo(panel, 60);
      view.unmount();

      expect(stored()).toEqual([[LIST_URL, 60]]);
    });
  });

  describe("storage bloqueado o corrupto", () => {
    it("no falla si sessionStorage lanza al leer y al escribir", () => {
      jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("bloqueado", "SecurityError");
      });
      jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("bloqueado", "SecurityError");
      });

      const view = render(<Screen ready url={LIST_URL} />);
      const main = view.getByTestId("main");

      expect(main.scrollTop).toBe(0);
      expect(() => {
        scrollTo(main, 200);
        act(() => {
          jest.advanceTimersByTime(SCROLL_SAVE_THROTTLE_MS);
        });
        view.unmount();
      }).not.toThrow();
    });

    it.each([
      ["JSON corrupto", "{no-es-json"],
      ["forma inesperada", JSON.stringify({ [LIST_URL]: 480 })],
      ["entradas inválidas", JSON.stringify([[LIST_URL, "480"], "x", [LIST_URL]])],
    ])("ignora lo guardado con %s", (_label, raw) => {
      window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, raw);

      const view = render(<Screen ready url={LIST_URL} />);

      expect(view.getByTestId("main").scrollTop).toBe(0);
    });
  });
});
