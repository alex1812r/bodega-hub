/**
 * DET-06b · tiendas de plataforma: búsqueda y estado viven en la URL (regla 15)
 * y el detalle se abre con la URL exacta de la lista en `returnTo`.
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

function jsonResponse(payload: unknown) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: true,
    status: 200,
  } as unknown as Response;
}

describe("StoresListPage · estado en la URL (DET-06b)", () => {
  const fetchMock = jest.fn();
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
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      jsonResponse({ data: { items: [store("001"), store("002")], limit: 10, skip: 0, total: 2 } }),
    );
    global.fetch = fetchMock;
  });

  afterEach(() => {
    window.history.replaceState = nativeReplaceState;
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
    expect(listRequests()).toEqual([{}]);
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura búsqueda y estado, y la petición inicial ya va filtrada", async () => {
    openAt("search=luz&status=paused");
    renderPage();
    await screen.findByText("Tienda 001");

    expect(screen.getByLabelText("Buscar tiendas")).toHaveValue("luz");
    expect(screen.getByLabelText("Filtrar por estado")).toHaveValue("paused");
    expect(listRequests()).toEqual([{ search: "luz", status: "paused" }]);
  });

  it("la búsqueda y el estado se escriben en la URL y viajan al servidor", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Tienda 001");

    await user.type(screen.getByLabelText("Buscar tiendas"), "luz");
    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "active");

    await waitFor(() => expect(urlParams()).toEqual({ search: "luz", status: "active" }));
    await waitFor(() => expect(lastListRequest()).toEqual({ search: "luz", status: "active" }));
  });

  it("volver a «Todos los estados» quita el parámetro de la URL", async () => {
    const user = userEvent.setup();

    openAt("status=paused");
    renderPage();
    await screen.findByText("Tienda 001");

    await user.selectOptions(screen.getByLabelText("Filtrar por estado"), "all");

    expect(urlParams()).toEqual({});
    await waitFor(() => expect(lastListRequest()).toEqual({}));
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

  it("`page=9999`, `sort` y un estado desconocido no rompen: caen al valor por defecto", async () => {
    openAt("page=9999&sort=cualquiera&status=borrada&search=luz");
    renderPage();
    await screen.findByText("Tienda 001");

    expect(screen.getByLabelText("Filtrar por estado")).toHaveValue("all");
    expect(listRequests()).toEqual([{ search: "luz" }]);
  });
});
