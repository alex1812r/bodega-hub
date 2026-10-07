import "@testing-library/jest-dom";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Suspense,
  createContext,
  startTransition,
  use,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";

import {
  URL_LIST_ECHO_TTL_MS,
  UrlListBoundary,
  listParams,
  useUrlListState,
  withUrlListBoundary,
} from "./useUrlListState";

/** Cada escritura de la lista en la URL, tal como la recibe Next: un `history.replaceState` que sincroniza. */
const mockReplace = jest.fn<void, [string]>();
/**
 * `router.replace` / `router.push`. En Next son navegaciones con ida al servidor
 * que quedan pendientes; aquí ninguna llega a terminar. El hook no debe usarlas.
 */
const mockRouterNavigate = jest.fn();
/** URL simulada. Con `auto`, cada escritura la actualiza como haría Next. */
const mockUrl = { auto: true, pathname: "/productos", query: "" };
/**
 * Router con latencia: dentro de `LaggedRouter` la URL es estado de React, las
 * escrituras quedan en `flights` y cada test decide cuándo y en qué orden llegan.
 */
const mockLagged = {
  context: createContext<string | null>(null),
  flights: [] as string[],
  held: new Set<string>(),
  landings: new Map<string, { promise: Promise<void>; release: () => void }>(),
  navigate: (query: string) => {
    mockUrl.query = query;
  },
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => mockUrl.pathname,
    useRouter: () => ({ push: mockRouterNavigate, replace: mockRouterNavigate }),
    useSearchParams: () =>
      new URLSearchParams(react.useContext(mockLagged.context) ?? mockUrl.query),
  };
});

const schema = z.object({
  search: listParams.text(),
  status: listParams.oneOf(["all", "active", "inactive"], "all"),
  onlyLow: listParams.boolean(),
  minStock: listParams.number({ defaultValue: 0, max: 1000, min: 0 }),
  desde: listParams.date(),
  tags: listParams.manyOf(["a", "b", "c"]),
  sort: listParams.sort(["name", "price"], "name"),
  dir: listParams.dir(),
  page: listParams.page(),
  limit: listParams.limit(),
});

const DEFAULTS = {
  desde: "",
  dir: "asc",
  limit: 10,
  minStock: 0,
  onlyLow: false,
  page: 1,
  search: "",
  sort: "name",
  status: "all",
  tags: [],
};

const nativeHistory = {
  push: window.history.pushState.bind(window.history),
  replace: window.history.replaceState.bind(window.history),
};
/** Claves con las que Next guarda su estado en cada entrada del historial. */
const NEXT_HISTORY_KEYS = ["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Modelo del `history.replaceState` que parchea Next (`client/components/app-router.js`):
 * copia su estado interno a la entrada y refleja la URL en `useSearchParams`.
 * Si `data` ya trae `__NA` lo toma por una llamada suya y NO sincroniza nada.
 */
function nextReplaceState(data: unknown, unused: string, url?: string | URL | null) {
  if (isRecord(data) && data.__NA) {
    nativeHistory.replace(data, unused, url);

    return;
  }

  const current: unknown = window.history.state;
  const next: Record<string, unknown> = isRecord(data) ? { ...data } : {};

  if (isRecord(current)) {
    for (const key of NEXT_HISTORY_KEYS) {
      if (current[key]) {
        next[key] = current[key];
      }
    }
  }

  nativeHistory.replace(next, unused, url);

  if (url) {
    mockReplace(String(url));
  }
}

function renderList(query = "") {
  mockUrl.query = query;

  return renderHook(() => useUrlListState(schema));
}

function lastReplacedUrl(): string {
  return mockReplace.mock.calls[mockReplace.mock.calls.length - 1][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.auto = true;
  mockUrl.pathname = "/productos";
  mockUrl.query = "";
  mockReplace.mockImplementation((url: string) => {
    if (mockUrl.auto) {
      mockUrl.query = url.split("?")[1] ?? "";
    }
  });
  nativeHistory.replace(null, "", "/productos");
  window.history.replaceState = nextReplaceState;
});

afterEach(() => {
  jest.useRealTimers();
  window.history.replaceState = nativeHistory.replace;
  // Ninguna escritura de la lista puede ser una navegación del router (SHR-27).
  expect(mockRouterNavigate).not.toHaveBeenCalled();
});

describe("useUrlListState", () => {
  describe("defaults y escritura", () => {
    it("sin parámetros devuelve los defaults del schema y no escribe la URL", () => {
      const { result } = renderList();

      expect(result.current.state).toEqual(DEFAULTS);
      expect(result.current.defaults).toEqual(DEFAULTS);
      expect(result.current.isDefault).toBe(true);
      expect(result.current.searchString).toBe("");
      expect(result.current.href).toBe("/productos");
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("omite de la URL los valores por defecto y escribe con history.replaceState, sin navegar", () => {
      const { result } = renderList();

      act(() => result.current.setState({ onlyLow: true, status: "active" }));

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/productos?status=active&onlyLow=true");
      expect(window.location.search).toBe("?status=active&onlyLow=true");
      expect(result.current.isDefault).toBe(false);

      act(() => result.current.setState({ onlyLow: false, status: "all" }));

      expect(mockReplace).toHaveBeenLastCalledWith("/productos");
      expect(window.location.search).toBe("");
      expect(result.current.isDefault).toBe(true);
    });

    it("no escribe si el patch no cambia nada", () => {
      const { result } = renderList("status=active");

      act(() => result.current.setField("status", "active"));

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("ignora entero un patch con un valor que el schema rechaza", () => {
      const { result } = renderList();

      act(() => result.current.setState({ minStock: 5000, onlyLow: true }));

      expect(result.current.state).toEqual(DEFAULTS);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("undefined en un patch devuelve el campo a su default", () => {
      const { result } = renderList("status=active");

      act(() => result.current.setState({ status: undefined }));

      expect(result.current.state.status).toBe("all");
      expect(lastReplacedUrl()).toBe("/productos");
    });

    it("exige que cada campo del schema tenga default", () => {
      const withoutDefault = z.object({ status: z.string() });
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

      expect(() => renderHook(() => useUrlListState(withoutDefault))).toThrow(/"status"/);

      consoleError.mockRestore();
    });
  });

  describe("ida y vuelta", () => {
    it("estado → URL → estado conserva todos los tipos", () => {
      const first = renderList();

      act(() =>
        first.result.current.setState({
          desde: "2026-03-01",
          dir: "desc",
          limit: 50,
          minStock: 12.5,
          onlyLow: true,
          page: 4,
          search: "harina pan",
          sort: "price",
          status: "inactive",
          tags: ["a", "c"],
        }),
      );

      const written = lastReplacedUrl();

      expect(written).toBe(
        "/productos?search=harina+pan&status=inactive&onlyLow=true&minStock=12.5&desde=2026-03-01&tags=a&tags=c&sort=price&dir=desc&page=4&limit=50",
      );
      expect(first.result.current.href).toBe(written);
      first.unmount();

      // Recarga: se monta de nuevo con la URL que quedó escrita.
      const second = renderList(written.split("?")[1]);

      expect(second.result.current.state).toEqual({
        desde: "2026-03-01",
        dir: "desc",
        limit: 50,
        minStock: 12.5,
        onlyLow: true,
        page: 4,
        search: "harina pan",
        sort: "price",
        status: "inactive",
        tags: ["a", "c"],
      });
      expect(second.result.current.isDefault).toBe(false);
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it("al montar con parámetros los respeta sin reescribir la URL", () => {
      const { result } = renderList("status=active&page=3&limit=20&tags=b");

      expect(result.current.state).toEqual({
        ...DEFAULTS,
        limit: 20,
        page: 3,
        status: "active",
        tags: ["b"],
      });
      expect(result.current.searchString).toBe("?status=active&tags=b&page=3&limit=20");
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("parámetros corruptos", () => {
    it.each([
      ["page=abc", "page"],
      ["page=-3", "page"],
      ["page=0", "page"],
      ["page=1e9", "page"],
      ["page=2.5", "page"],
      ["page=999999999", "page"],
      ["page=", "page"],
      ["limit=0", "limit"],
      ["limit=-10", "limit"],
      ["limit=abc", "limit"],
      ["limit=999999999999999999999", "limit"],
      ["status=borrado", "status"],
      ["status=active&status=inactive", "status"],
      ["desde=2026-02-30", "desde"],
      ["desde=ayer", "desde"],
      ["desde=2026-13-01", "desde"],
      ["sort=password", "sort"],
      ["dir=sideways", "dir"],
      ["onlyLow=quizas", "onlyLow"],
      ["minStock=99999", "minStock"],
      ["minStock=NaN", "minStock"],
      ["tags=a&tags=zzz", "tags"],
      [`search=${"x".repeat(5000)}`, "search"],
      ["search=%E0%A4%A", "search"],
      ["status=%E0%A4%A", "status"],
    ] as const)("%s → default de %s sin lanzar", (query, field) => {
      const { result } = renderList(`${query}&onlyLow=true`);

      expect(result.current.state[field]).toEqual(field === "onlyLow" ? false : DEFAULTS[field]);
      // El resto de campos no se pierde por culpa del corrupto.
      if (field !== "onlyLow") {
        expect(result.current.state.onlyLow).toBe(true);
      }
    });

    it("acota un limit desmesurado al máximo permitido", () => {
      const { result } = renderList("limit=99999");

      expect(result.current.state.limit).toBe(MAX_PAGE_LIMIT);
    });

    it("no lanza con un % suelto ni con una query ilegible entera", () => {
      expect(renderList("search=100%").result.current.state.search).toBe("100%");
      expect(renderList("%&&=&%%%=%&page").result.current.state).toEqual(DEFAULTS);
    });

    it("la siguiente escritura limpia los parámetros corruptos", () => {
      const { result } = renderList("page=abc&status=borrado&tab=ventas");

      act(() => result.current.setField("onlyLow", true));

      expect(lastReplacedUrl()).toBe("/productos?tab=ventas&onlyLow=true");
    });
  });

  describe("parámetros ajenos", () => {
    it("conserva tab y returnTo intactos al escribir y al limpiar", () => {
      const returnTo = encodeURIComponent("/ventas?estado=pagada&page=2");
      const { result } = renderList(`tab=compras&returnTo=${returnTo}&status=active`);

      act(() => result.current.setField("status", "inactive"));

      const params = new URLSearchParams(lastReplacedUrl().split("?")[1]);

      expect(params.get("tab")).toBe("compras");
      expect(params.get("returnTo")).toBe("/ventas?estado=pagada&page=2");
      expect(params.get("status")).toBe("inactive");

      act(() => result.current.reset());

      const cleaned = new URLSearchParams(lastReplacedUrl().split("?")[1]);

      expect([...cleaned.keys()]).toEqual(["tab", "returnTo"]);
      expect(cleaned.get("returnTo")).toBe("/ventas?estado=pagada&page=2");
    });

    it("un cambio de un parámetro ajeno no pisa el texto pendiente", () => {
      jest.useFakeTimers();
      mockUrl.auto = false;

      const { result, rerender } = renderList("tab=resumen");

      act(() => result.current.setField("search", "arr"));

      // Otro componente (Tabs) cambia su parámetro mientras el debounce corre.
      mockUrl.query = "tab=ventas";
      rerender();

      expect(result.current.state.search).toBe("arr");

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(lastReplacedUrl()).toBe("/productos?tab=ventas&search=arr");
    });
  });

  describe("debounce de texto", () => {
    function SearchBox() {
      const list = useUrlListState(schema);

      return (
        <input
          aria-label="Buscar"
          onChange={(event) => list.setField("search", event.target.value)}
          value={list.state.search}
        />
      );
    }

    it("el input refleja cada tecla al instante y la URL se escribe una vez tras 300 ms", async () => {
      jest.useFakeTimers();

      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime, delay: 50 });

      render(<SearchBox />);
      await user.type(screen.getByLabelText("Buscar"), "arroz");

      expect(screen.getByLabelText("Buscar")).toHaveValue("arroz");
      expect(mockReplace).not.toHaveBeenCalled();

      // userEvent ya avanzó 50 ms tras la última tecla.

      act(() => {
        jest.advanceTimersByTime(249);
      });
      expect(mockReplace).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/productos?search=arroz");
      expect(screen.getByLabelText("Buscar")).toHaveValue("arroz");
    });

    it("la URL atrasada no reescribe lo tecleado después", () => {
      jest.useFakeTimers();
      mockUrl.auto = false;

      const { result, rerender } = renderList();

      act(() => result.current.setField("search", "a"));
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(lastReplacedUrl()).toBe("/productos?search=a");

      // El usuario sigue tecleando antes de que Next aplique la URL anterior.
      act(() => result.current.setField("search", "ab"));
      mockUrl.query = "search=a";
      rerender();

      expect(result.current.state.search).toBe("ab");

      act(() => result.current.setField("search", "abc"));
      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(lastReplacedUrl()).toBe("/productos?search=abc");

      mockUrl.query = "search=abc";
      rerender();

      expect(result.current.state.search).toBe("abc");
      expect(mockReplace).toHaveBeenCalledTimes(2);
    });

    it("solo los campos de texto declarados llevan debounce", () => {
      jest.useFakeTimers();

      const { result } = renderList();

      act(() => result.current.setField("desde", "2026-01-15"));

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(lastReplacedUrl()).toBe("/productos?desde=2026-01-15");
    });

    it("un cambio de filtro escribe ya, llevándose el texto pendiente", () => {
      jest.useFakeTimers();

      const { result } = renderList();

      act(() => result.current.setField("search", "pan"));
      act(() => result.current.setField("status", "active"));

      expect(lastReplacedUrl()).toBe("/productos?search=pan&status=active");

      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it("textFields permite declarar otros campos de texto", () => {
      jest.useFakeTimers();

      const notesSchema = z.object({ nota: listParams.text(), search: listParams.text() });
      const { result } = renderHook(() => useUrlListState(notesSchema, { textFields: ["nota"] }));

      act(() => result.current.setField("search", "x"));
      expect(mockReplace).toHaveBeenCalledTimes(1);

      act(() => result.current.setField("nota", "y"));
      expect(mockReplace).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(lastReplacedUrl()).toBe("/productos?nota=y&search=x");
    });

    it("al desmontar no escribe el texto pendiente", () => {
      jest.useFakeTimers();

      const { result, unmount } = renderList();

      act(() => result.current.setField("search", "pan"));
      unmount();
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(mockReplace).not.toHaveBeenCalled();
    });

    describe("clic en un enlace con texto pendiente (SHR-17)", () => {
      /** Lo que el enlace encuentra en la barra de direcciones al recibir el clic. */
      const seenByLink: string[] = [];

      function ListWithLink() {
        const list = useUrlListState(schema);

        return (
          <>
            <input
              aria-label="Buscar"
              onChange={(event) => list.setField("search", event.target.value)}
              value={list.state.search}
            />
            <a
              href="/productos/7"
              onClick={(event) => {
                // Como `<Link>`: la navegación arranca aquí y jsdom no navega.
                event.preventDefault();
                seenByLink.push(window.location.pathname + window.location.search);
              }}
            >
              <span>Detalle</span>
            </a>
            <button type="button">Otro</button>
          </>
        );
      }

      function spyOnHistory() {
        return {
          push: jest.spyOn(window.history, "pushState"),
          replace: jest.spyOn(window.history, "replaceState"),
        };
      }

      beforeEach(() => {
        seenByLink.length = 0;
        nativeHistory.replace(null, "", "/productos?tab=stock");
        mockUrl.query = "tab=stock";
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      it("escribe la URL antes de que arranque la navegación y no la cancela con un replace tardío", () => {
        jest.useFakeTimers();
        render(<ListWithLink />);

        const history = spyOnHistory();

        fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bet" } });
        act(() => {
          jest.advanceTimersByTime(100);
        });
        fireEvent.click(screen.getByText("Detalle"));

        // El filtro tecleado queda en la entrada de historial de la lista ("atrás" lo restaura).
        expect(seenByLink).toEqual(["/productos?tab=stock&search=bet"]);
        expect(history.replace).toHaveBeenCalledTimes(1);
        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(history.push).not.toHaveBeenCalled();

        // La navegación sigue en vuelo cuando habría vencido el debounce.
        act(() => {
          jest.advanceTimersByTime(1000);
        });

        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(history.replace).toHaveBeenCalledTimes(1);
        expect(history.push).not.toHaveBeenCalled();
      });

      it("conserva el estado interno de Next de la entrada de historial", () => {
        jest.useFakeTimers();
        nativeHistory.replace(
          { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: "lista" },
          "",
          "/productos?tab=stock",
        );
        render(<ListWithLink />);

        fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bet" } });
        fireEvent.click(screen.getByText("Detalle"));

        expect(window.location.search).toBe("?tab=stock&search=bet");
        expect(window.history.state).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: "lista" });
      });

      it("si la navegación no llega a ocurrir, la lista sigue funcionando con la URL ya escrita", () => {
        jest.useFakeTimers();

        const { rerender } = render(<ListWithLink />);

        fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bet" } });
        fireEvent.click(screen.getByText("Detalle"));

        // Next refleja el `replaceState` nativo en `useSearchParams`.
        expect(mockUrl.query).toBe("tab=stock&search=bet");
        rerender(<ListWithLink />);
        expect(screen.getByLabelText("Buscar")).toHaveValue("bet");

        fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "beta" } });
        act(() => {
          jest.advanceTimersByTime(300);
        });

        expect(mockReplace).toHaveBeenCalledTimes(2);
        expect(lastReplacedUrl()).toBe("/productos?tab=stock&search=beta");
      });

      it("sin texto pendiente, un clic en un enlace no escribe nada", () => {
        jest.useFakeTimers();
        render(<ListWithLink />);

        const history = spyOnHistory();

        fireEvent.click(screen.getByText("Detalle"));

        expect(history.replace).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
      });

      it("un clic fuera de un enlace mantiene el debounce", () => {
        jest.useFakeTimers();
        render(<ListWithLink />);

        const history = spyOnHistory();

        fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bet" } });
        fireEvent.click(screen.getByRole("button", { name: "Otro" }));

        expect(history.replace).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();

        act(() => {
          jest.advanceTimersByTime(300);
        });

        expect(mockReplace).toHaveBeenCalledTimes(1);
        expect(lastReplacedUrl()).toBe("/productos?tab=stock&search=bet");
        expect(history.replace).toHaveBeenCalledTimes(1);
      });

      it("al desmontar deja de escuchar los clics", () => {
        jest.useFakeTimers();

        const { unmount } = render(<ListWithLink />);
        const history = spyOnHistory();

        fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bet" } });
        unmount();
        const stray = document.body.appendChild(document.createElement("a"));

        stray.href = "#fuera";
        fireEvent.click(stray);
        stray.remove();

        expect(history.replace).not.toHaveBeenCalled();
      });
    });
  });

  describe("enlace pulsado con una escritura recién hecha (SHR-27)", () => {
    /** Lo que el enlace encuentra en la barra de direcciones al recibir el clic. */
    const seenByLink: string[] = [];

    function ListWithNextLink() {
      const list = useUrlListState(schema);

      return (
        <>
          <input
            aria-label="Buscar"
            onChange={(event) => list.setField("search", event.target.value)}
            value={list.state.search}
          />
          <button onClick={() => list.setField("status", "active")} type="button">
            Solo activos
          </button>
          <a
            href="/productos/7"
            onClick={(event) => {
              event.preventDefault();
              seenByLink.push(window.location.pathname + window.location.search);

              // Como el router de Next: el `push` de un enlace que llega con otra
              // navegación aún pendiente se confirma como `replaceState`.
              if (mockRouterNavigate.mock.calls.length > 0) {
                nativeHistory.replace(null, "", "/productos/7");
              } else {
                nativeHistory.push(null, "", "/productos/7");
              }
            }}
          >
            Detalle
          </a>
        </>
      );
    }

    beforeEach(() => {
      jest.useFakeTimers();
      seenByLink.length = 0;
      nativeHistory.replace(null, "", "/productos?tab=stock");
      mockUrl.query = "tab=stock";
    });

    it("tras cambiar un filtro, el enlace añade su entrada y la lista queda detrás con el filtro", () => {
      render(<ListWithNextLink />);

      const entries = window.history.length;

      fireEvent.click(screen.getByRole("button", { name: "Solo activos" }));
      fireEvent.click(screen.getByText("Detalle"));

      expect(window.location.pathname).toBe("/productos/7");
      // La entrada de la lista sigue en el historial: ATRÁS vuelve a ella.
      expect(window.history.length).toBe(entries + 1);
      expect(seenByLink).toEqual(["/productos?tab=stock&status=active"]);
      expect(mockRouterNavigate).not.toHaveBeenCalled();
    });

    it("con el debounce de texto ya vencido, el enlace añade su entrada y la lista conserva la búsqueda", () => {
      render(<ListWithNextLink />);

      const entries = window.history.length;

      fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bet" } });
      act(() => {
        jest.advanceTimersByTime(350);
      });
      fireEvent.click(screen.getByText("Detalle"));

      expect(window.location.pathname).toBe("/productos/7");
      expect(window.history.length).toBe(entries + 1);
      expect(seenByLink).toEqual(["/productos?tab=stock&search=bet"]);
      expect(mockRouterNavigate).not.toHaveBeenCalled();
    });

    it("la escritura conserva el estado interno de Next y se refleja en useSearchParams", () => {
      nativeHistory.replace(
        { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: "lista" },
        "",
        "/productos?tab=stock",
      );

      const { result, rerender } = renderHook(() => useUrlListState(schema));

      act(() => result.current.setField("status", "active"));

      // Sin la marca `__NA` en lo que se pasa, Next sincroniza la URL nueva...
      expect(mockUrl.query).toBe("tab=stock&status=active");
      // ...y copia su estado a la entrada.
      expect(window.history.state).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: "lista" });

      rerender();

      expect(result.current.state.status).toBe("active");
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });

  describe("página", () => {
    it.each([
      ["filtro", { status: "active" }, "/productos?status=active"],
      ["orden", { sort: "price" }, "/productos?sort=price"],
      ["dirección", { dir: "desc" }, "/productos?dir=desc"],
      ["tamaño de página", { limit: 50 }, "/productos?limit=50"],
    ] as const)("cambiar %s devuelve la página a 1", (_label, patch, expectedUrl) => {
      const { result } = renderList("page=5");

      act(() => result.current.setState(patch));

      expect(result.current.state.page).toBe(1);
      expect(lastReplacedUrl()).toBe(expectedUrl);
    });

    it("la búsqueda devuelve la página a 1 al instante y en la URL tras el debounce", () => {
      jest.useFakeTimers();

      const { result } = renderList("page=5");

      act(() => result.current.setField("search", "pan"));

      expect(result.current.state.page).toBe(1);
      expect(mockReplace).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(lastReplacedUrl()).toBe("/productos?search=pan");
    });

    it("cambiar solo la página no toca los filtros", () => {
      const { result } = renderList("status=active");

      act(() => result.current.setField("page", 3));

      expect(result.current.state).toEqual({ ...DEFAULTS, page: 3, status: "active" });
      expect(lastReplacedUrl()).toBe("/productos?status=active&page=3");
    });

    it("si el patch trae page junto a un filtro, se respeta esa página", () => {
      const { result } = renderList();

      act(() => result.current.setState({ page: 2, status: "active" }));

      expect(result.current.state.page).toBe(2);
    });
  });

  describe("reset", () => {
    it("vuelve a los defaults y limpia solo sus parámetros", () => {
      const { result } = renderList("search=pan&status=active&page=3&limit=50&tab=ventas");

      act(() => result.current.reset());

      expect(result.current.state).toEqual(DEFAULTS);
      expect(result.current.isDefault).toBe(true);
      expect(mockReplace).toHaveBeenCalledWith("/productos?tab=ventas");
    });

    it("cancela el texto pendiente", () => {
      jest.useFakeTimers();

      const { result } = renderList();

      act(() => result.current.setField("search", "pan"));
      act(() => result.current.reset());
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.state.search).toBe("");
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("limpia de la URL los parámetros corruptos aunque el estado ya sea el default", () => {
      const { result } = renderList("page=abc&tab=ventas");

      act(() => result.current.reset());

      expect(lastReplacedUrl()).toBe("/productos?tab=ventas");
    });
  });

  describe("cambio externo de la URL", () => {
    it("el estado sigue a la URL (atrás/adelante)", () => {
      const { result, rerender } = renderList("status=active&page=3");

      mockUrl.query = "search=pan&sort=price";
      rerender();

      expect(result.current.state).toEqual({ ...DEFAULTS, search: "pan", sort: "price" });

      mockUrl.query = "";
      rerender();

      expect(result.current.state).toEqual(DEFAULTS);
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("descarta el texto pendiente si la URL cambia por fuera", () => {
      jest.useFakeTimers();

      const { result, rerender } = renderList("status=active");

      act(() => result.current.setField("search", "pan"));

      mockUrl.query = "status=inactive";
      rerender();

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.state).toEqual({ ...DEFAULTS, status: "inactive" });
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("tras un cambio externo sigue escribiendo sobre la URL nueva", () => {
      const { result, rerender } = renderList("status=active");

      act(() => result.current.setField("onlyLow", true));
      mockUrl.query = "status=inactive&tab=ventas";
      rerender();
      act(() => result.current.setField("page", 2));

      expect(lastReplacedUrl()).toBe("/productos?tab=ventas&status=inactive&page=2");
    });
  });

  describe("router con latencia (ecos tardíos, intermedios y desordenados)", () => {
    function landingOf(query: string) {
      const landing = mockLagged.landings.get(query);

      if (landing) {
        return landing;
      }

      let release = () => undefined as void;
      const created = {
        promise: new Promise<void>((resolve) => {
          release = resolve;
        }),
        release: () => release(),
      };

      mockLagged.landings.set(query, created);

      return created;
    }

    /** Parte lenta de la pantalla: su render no termina hasta que "llegan" los datos de esa URL. */
    function HeavyRows() {
      const query = useContext(mockLagged.context) ?? "";

      if (mockLagged.held.has(query)) {
        use(landingOf(query).promise);
      }

      return <p data-testid="rows">{query}</p>;
    }

    function Screen() {
      const list = useUrlListState(schema);

      return (
        <>
          <input
            aria-label="Buscar"
            onChange={(event) => list.setField("search", event.target.value)}
            value={list.state.search}
          />
          <select
            aria-label="Estado"
            onChange={(event) =>
              list.setField("status", event.target.value as "all" | "active" | "inactive")
            }
            value={list.state.status}
          >
            <option value="all">all</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
          <output data-testid="href">{list.href}</output>
          <HeavyRows />
        </>
      );
    }

    /** Como el router de Next: la URL es estado de React y cada navegación llega en una transición. */
    function LaggedRouter({ children }: { children: ReactNode }) {
      const [query, setQuery] = useState(mockUrl.query);

      useEffect(() => {
        mockLagged.navigate = (next) => startTransition(() => setQuery(next));
      }, []);

      return (
        <mockLagged.context.Provider value={query}>
          <Suspense fallback={null}>{children}</Suspense>
        </mockLagged.context.Provider>
      );
    }

    function renderScreen(query = "") {
      mockUrl.query = query;
      // `replace` no aplica nada: cada escritura queda en vuelo hasta que el test la aterriza.
      mockReplace.mockImplementation((url: string) => {
        mockLagged.flights.push(url.split("?")[1] ?? "");
      });

      return render(
        <LaggedRouter>
          <Screen />
        </LaggedRouter>,
      );
    }

    function land(query: string) {
      act(() => mockLagged.navigate(query));
    }

    function type(text: string) {
      for (let length = 1; length <= text.length; length += 1) {
        fireEvent.change(screen.getByLabelText("Buscar"), {
          target: { value: `${(screen.getByLabelText("Buscar") as HTMLInputElement).value}${text[length - 1]}` },
        });
      }
    }

    function expectScreen(expected: { search: string; status: string }) {
      expect(screen.getByLabelText("Buscar")).toHaveValue(expected.search);
      expect(screen.getByLabelText("Estado")).toHaveValue(expected.status);
    }

    beforeEach(() => {
      jest.useFakeTimers();
      mockLagged.flights.length = 0;
      mockLagged.held.clear();
      mockLagged.landings.clear();
    });

    it("teclear mientras el eco del filtro sigue en render no pierde teclas ni revierte el filtro", async () => {
      renderScreen();

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "active" } });
      expect(mockLagged.flights).toEqual(["status=active"]);

      // El eco llega, pero el render de la lista (pesado) aún no ha terminado:
      // React tiene la transición a medias y la pantalla sigue con la URL vieja.
      mockLagged.held.add("status=active");
      await act(async () => mockLagged.navigate("status=active"));
      expect(screen.getByTestId("rows")).toHaveTextContent("");

      // Con la transición suspendida, cada `act` se espera (lo exige React).
      await act(async () => type("harina pan"));
      expectScreen({ search: "harina pan", status: "active" });

      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(mockLagged.flights).toEqual(["status=active", "search=harina+pan&status=active"]);

      await act(async () => {
        landingOf("status=active").release();
        await Promise.resolve();
      });
      expect(screen.getByTestId("rows")).toHaveTextContent("status=active");
      expectScreen({ search: "harina pan", status: "active" });

      land("search=harina+pan&status=active");

      expectScreen({ search: "harina pan", status: "active" });
      expect(screen.getByTestId("href")).toHaveTextContent(
        "/productos?search=harina+pan&status=active",
      );
      expect(mockReplace).toHaveBeenCalledTimes(2);
    });

    it("teclear antes de que llegue el eco del filtro conserva filtro y texto en estado y URL", () => {
      renderScreen();

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "active" } });
      type("harina pan");
      land("status=active");
      expectScreen({ search: "harina pan", status: "active" });

      act(() => {
        jest.advanceTimersByTime(300);
      });
      land("search=harina+pan&status=active");

      expectScreen({ search: "harina pan", status: "active" });
      expect(lastReplacedUrl()).toBe("/productos?search=harina+pan&status=active");
      expect(mockReplace).toHaveBeenCalledTimes(2);
    });

    it("ecos fuera de orden no revierten el estado", () => {
      renderScreen();

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "active" } });
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
      expect(mockLagged.flights).toEqual(["status=active", "status=inactive"]);

      land("status=inactive");
      expectScreen({ search: "", status: "inactive" });

      // El eco de la primera escritura llega después que el de la segunda.
      land("status=active");

      expectScreen({ search: "", status: "inactive" });
      expect(mockReplace).toHaveBeenCalledTimes(2);
    });

    it("un eco intermedio con el debounce pendiente no reescribe el texto ni los filtros", () => {
      renderScreen();

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "active" } });
      type("pa");
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
      type("n");
      expect(mockLagged.flights).toEqual(["status=active", "search=pa&status=inactive"]);

      land("status=active");
      expectScreen({ search: "pan", status: "inactive" });

      land("search=pa&status=inactive");
      expectScreen({ search: "pan", status: "inactive" });

      act(() => {
        jest.advanceTimersByTime(300);
      });
      expect(lastReplacedUrl()).toBe("/productos?search=pan&status=inactive");
    });

    it("una navegación externa sin escrituras pendientes se adopta", () => {
      renderScreen("status=active");

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
      land("status=inactive");

      land("search=pan");

      expectScreen({ search: "pan", status: "all" });
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it("una navegación externa con una escritura en vuelo manda al instante; el eco que llegue después también", () => {
      renderScreen();

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "active" } });
      // Atrás/adelante o un enlace mientras el `replace` propio sigue en vuelo.
      land("search=pan");
      expectScreen({ search: "pan", status: "all" });

      // Si el router aun así completa el `replace`, la URL final es esa y el estado la sigue.
      land("status=active");
      expectScreen({ search: "", status: "active" });
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it("el eco de una escritura adelantada deja de reconocerse pasado el plazo", () => {
      renderScreen();

      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "active" } });
      fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "inactive" } });
      land("status=inactive");

      act(() => {
        jest.advanceTimersByTime(URL_LIST_ECHO_TTL_MS);
      });
      // Ya no puede ser un eco: es alguien navegando a esa URL.
      land("status=active");

      expectScreen({ search: "", status: "active" });
    });
  });

  describe("límite de Suspense", () => {
    function StatusLabel({ prefix }: { prefix: string }) {
      const list = useUrlListState(schema);

      return (
        <p>
          {prefix}: {list.state.status}
        </p>
      );
    }

    it("withUrlListBoundary envuelve la pantalla y pasa sus props", () => {
      mockUrl.query = "status=active";

      const Screen = withUrlListBoundary(StatusLabel);

      render(<Screen prefix="Estado" />);

      expect(screen.getByText("Estado: active")).toBeInTheDocument();
      expect(Screen.displayName).toBe("withUrlListBoundary(StatusLabel)");
    });

    it("UrlListBoundary pinta a sus hijos", () => {
      render(
        <UrlListBoundary fallback={<p>Cargando</p>}>
          <StatusLabel prefix="Estado" />
        </UrlListBoundary>,
      );

      expect(screen.getByText("Estado: all")).toBeInTheDocument();
    });
  });
});
