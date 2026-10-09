/**
 * DET-06b / DET-06c · tiendas de plataforma: búsqueda, estado, página y tamaño
 * viven en la URL (regla 15), la lista se pagina en servidor y el detalle se
 * abre con la URL exacta de la lista en `returnTo`.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** URL simulada: `useSearchParams` la sigue como hace Next tras un `history.replaceState`. */
const mockNavigation = {
  listeners: new Set<() => void>(),
  query: "",
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => "/platform/stores",
    useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
    useSearchParams: () =>
      new URLSearchParams(
        react.useSyncExternalStore(
          (listener: () => void) => {
            mockNavigation.listeners.add(listener);

            return () => {
              mockNavigation.listeners.delete(listener);
            };
          },
          () => mockNavigation.query,
        ),
      ),
  };
});

import { StoresListPage } from "./page";

function store(id: string) {
  return {
    createdAt: "2026-01-15T12:00:00.000Z",
    id,
    name: `Tienda ${id}`,
    slug: `tienda-${id}`,
    status: "active",
    usersCount: 2,
  };
}

/** Como el BFF: entrega solo la página pedida (`skip`/`limit`) y el total. */
function pageOf<T>(total: number, url: string, build: (index: number) => T) {
  const params = new URLSearchParams(url.split("?")[1] ?? "");
  const limit = Number(params.get("limit") ?? 10);
  const skip = Number(params.get("skip") ?? 0);
  const count = Math.max(0, Math.min(limit, total - skip));

  return {
    items: Array.from({ length: count }, (_, offset) => build(skip + offset)),
    limit,
    skip,
    total,
  };
}

function numbered(index: number) {
  return String(index + 1).padStart(3, "0");
}

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

describe("StoresListPage · estado en la URL (DET-06b, DET-06c)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  /** Tiendas que tiene la plataforma en el servidor de prueba. */
  let totalStores: number;
  const nativeReplaceState = window.history.replaceState.bind(window.history);

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/platform/stores?${query}` : "/platform/stores");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    window.sessionStorage.clear();
    openAt("");
    // Lo que hace Next con un `replaceState`: reflejar la URL en `useSearchParams`.
    window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      nativeReplaceState(data, unused, url);
      mockNavigation.query = window.location.search.slice(1);
      mockNavigation.listeners.forEach((listener) => listener());
    };
    // jsdom no trae matchMedia y la paginación lo consulta.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    totalStores = 2;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      jsonResponse({ data: pageOf(totalStores, String(url), (index) => store(numbered(index))) }),
    );
    global.fetch = fetchMock;
  });

  afterEach(() => {
    window.history.replaceState = nativeReplaceState;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  /** Query de cada `GET /api/platform/stores`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/platform/stores")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastListRequest() {
    const requests = listRequests();

    return requests[requests.length - 1];
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  /** `returnTo` de un enlace al detalle, ya como URL de la lista. */
  function readDetailHref(href: string | null) {
    const detailUrl = new URL(href ?? "", "http://localhost");
    const returnTo = new URL(detailUrl.searchParams.get("returnTo") ?? "", "http://localhost");

    return {
      detailParams: [...detailUrl.searchParams.keys()],
      detailPath: detailUrl.pathname,
      listParams: Object.fromEntries(returnTo.searchParams),
      listPath: returnTo.pathname,
    };
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <StoresListPage />
      </QueryClientProvider>,
    );
  }

  it("sin parámetros pide la lista con los valores por defecto", async () => {
    renderPage();
    await screen.findByText("Tienda 001");

    expect(screen.getByLabelText("Buscar tiendas")).toHaveValue("");
    expect(screen.getByLabelText("Filtrar por estado")).toHaveValue("all");
    expect(listRequests()).toEqual([{ limit: "10", skip: "0" }]);
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura búsqueda y estado, y la petición inicial ya va filtrada", async () => {
    openAt("search=luz&status=paused");
    renderPage();
    await screen.findByText("Tienda 001");

    expect(screen.getByLabelText("Buscar tiendas")).toHaveValue("luz");
    expect(screen.getByLabelText("Filtrar por estado")).toHaveValue("paused");
    expect(listRequests()).toEqual([{ limit: "10", search: "luz", skip: "0", status: "paused" }]);
  });

  it("la búsqueda y el estado se escriben en la URL y viajan al servidor", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Tienda 001");

    await user.type(screen.getByLabelText("Buscar tiendas"), "luz");
    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "active");

    await waitFor(() => expect(urlParams()).toEqual({ search: "luz", status: "active" }));
    await waitFor(() =>
      expect(lastListRequest()).toEqual({ limit: "10", search: "luz", skip: "0", status: "active" }),
    );
  });

  it("volver a «Todos los estados» quita el parámetro de la URL", async () => {
    const user = userEvent.setup();

    openAt("status=paused");
    renderPage();
    await screen.findByText("Tienda 001");

    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "all");

    expect(urlParams()).toEqual({});
    await waitFor(() => expect(lastListRequest()).toEqual({ limit: "10", skip: "0" }));
  });

  it("el nombre de la tarjeta es un enlace al detalle con la URL exacta de la lista en returnTo", async () => {
    openAt("search=luz&status=active");
    renderPage();

    const link = await screen.findByRole("link", { name: "Tienda 001" });

    expect(readDetailHref(link.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/platform/stores/001",
      listParams: { search: "luz", status: "active" },
      listPath: "/platform/stores",
    });
  });

  it("«Ver detalle» del menú de la tarjeta lleva el mismo returnTo", async () => {
    const user = userEvent.setup();

    openAt("status=paused");
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Acciones de Tienda 001" }));

    const item = await screen.findByRole("menuitem", { name: "Ver detalle" });

    expect(readDetailHref(item.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/platform/stores/001",
      listParams: { status: "paused" },
      listPath: "/platform/stores",
    });
  });

  it("una plataforma con 11 tiendas muestra la undécima: la página 2 se pide al servidor", async () => {
    const user = userEvent.setup();

    totalStores = 11;
    renderPage();
    await screen.findByText("Tienda 010");
    expect(screen.queryByText("Tienda 011")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pagina siguiente" }));

    expect(await screen.findByText("Tienda 011")).toBeInTheDocument();
    expect(lastListRequest()).toEqual({ limit: "10", skip: "10" });
    expect(urlParams()).toEqual({ page: "2" });
  });

  it("al montar con `page` y `limit` la petición inicial ya pide esa página", async () => {
    totalStores = 60;
    openAt("page=2&limit=25");
    renderPage();
    await screen.findByText("Tienda 026");

    expect(listRequests()).toEqual([{ limit: "25", skip: "25" }]);
  });

  it("filtrar vuelve a la página 1", async () => {
    const user = userEvent.setup();

    totalStores = 30;
    openAt("page=3");
    renderPage();
    await screen.findByText("Tienda 021");

    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "active");

    expect(urlParams()).toEqual({ status: "active" });
    await waitFor(() =>
      expect(lastListRequest()).toEqual({ limit: "10", skip: "0", status: "active" }),
    );
  });

  it("el returnTo del enlace al detalle incluye la página", async () => {
    totalStores = 30;
    openAt("status=active&page=2");
    renderPage();

    const link = await screen.findByRole("link", { name: "Tienda 011" });

    expect(readDetailHref(link.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/platform/stores/011",
      listParams: { page: "2", status: "active" },
      listPath: "/platform/stores",
    });
  });

  it("`page=9999` cae a la última página que existe y la URL lo refleja", async () => {
    totalStores = 11;
    openAt("page=9999");
    renderPage();

    expect(await screen.findByText("Tienda 011")).toBeInTheDocument();
    expect(urlParams()).toEqual({ page: "2" });
    expect(lastListRequest()).toEqual({ limit: "10", skip: "10" });
  });

  it("`sort`, un estado desconocido y un `limit` o `page` inválidos no rompen: caen al valor por defecto", async () => {
    openAt("sort=cualquiera&status=borrada&search=luz&limit=abc&page=-4");
    renderPage();
    await screen.findByText("Tienda 001");

    expect(screen.getByLabelText("Filtrar por estado")).toHaveValue("all");
    expect(listRequests()).toEqual([{ limit: "10", search: "luz", skip: "0" }]);
  });
});
