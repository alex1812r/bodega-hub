/**
 * DET-06a · lista de categorías: búsqueda, estado, página y tamaño viven en la
 * URL (regla 15) y "Volver a productos" respeta `returnTo`.
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
    usePathname: () => "/products/categories",
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
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: "admin" }),
}));

import { ToastProvider } from "../../../shared/components/Toast";
import { CategoriesListPage } from "./page";

function category(id: string) {
  return {
    defaultMarkupPct: null,
    description: "",
    id,
    isActive: true,
    name: `Categoría ${id}`,
    taxRate: 16,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("CategoriesListPage · estado en la URL (DET-06a)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  /** Total que declara el servidor; por defecto, las categorías de la página. */
  let listTotal: number | undefined;

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/products/categories?${query}` : "/products/categories");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    const items = [category("001"), category("002")];

    listTotal = undefined;
    openAt("");
    // Lo que hace Next con un `replaceState`: reflejar la URL en `useSearchParams`.
    window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      nativeReplaceState(data, unused, url);
      mockNavigation.query = window.location.search.slice(1);
      mockNavigation.listeners.forEach((listener) => listener());
    };
    // jsdom no trae matchMedia.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: false,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      // Como el servidor: más allá del total no hay filas, y devuelve el `skip` pedido.
      const query = new URLSearchParams(String(url).split("?")[1] ?? "");
      const skip = Number(query.get("skip") ?? 0);
      const total = listTotal ?? items.length;

      return jsonResponse({
        data: {
          items: skip < total ? items : [],
          limit: Number(query.get("limit") ?? 10),
          skip,
          total,
        },
      });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    window.history.replaceState = nativeReplaceState;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  /** Query de cada `GET /api/categories`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/categories")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastListRequest() {
    const requests = listRequests();

    return requests[requests.length - 1];
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CategoriesListPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("sin parámetros pide todas las categorías, activas e inactivas", async () => {
    renderPage();
    await screen.findByText("Categoría 001");

    expect(screen.getByLabelText("Búsqueda")).toHaveValue("");
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(listRequests()).toEqual([{ isActive: "all", limit: "10", skip: "0" }]);
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura búsqueda, estado, página y tamaño", async () => {
    listTotal = 80;
    openAt("search=pint&status=inactive&page=3&limit=25");
    renderPage();
    await screen.findByText("Categoría 001");

    expect(screen.getByLabelText("Búsqueda")).toHaveValue("pint");
    expect(screen.getByLabelText("Estado")).toHaveValue("inactive");
    expect(listRequests()).toEqual([
      { isActive: "false", limit: "25", search: "pint", skip: "50" },
    ]);
  });

  it("la búsqueda y el estado se escriben en la URL y viajan al servidor", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Categoría 001");

    await user.type(screen.getByLabelText("Búsqueda"), "pint");
    await user.selectOptions(screen.getByLabelText("Estado"), "active");

    await waitFor(() => expect(urlParams()).toEqual({ search: "pint", status: "active" }));
    await waitFor(() =>
      expect(lastListRequest()).toMatchObject({ isActive: "true", search: "pint" }),
    );
  });

  it("cambiar un filtro vuelve a la página 1", async () => {
    const user = userEvent.setup();

    listTotal = 40;
    openAt("page=3");
    renderPage();
    await screen.findByText("Categoría 001");
    expect(lastListRequest()).toMatchObject({ skip: "20" });

    await user.selectOptions(screen.getByLabelText("Estado"), "inactive");

    expect(urlParams()).toEqual({ status: "inactive" });
    await waitFor(() => expect(lastListRequest()).toMatchObject({ isActive: "false", skip: "0" }));
  });

  it("cambiar de página escribe `page` en la URL y conserva los filtros", async () => {
    const user = userEvent.setup();

    listTotal = 40;
    openAt("status=active");
    renderPage();
    await screen.findByText("Categoría 001");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(urlParams()).toEqual({ page: "2", status: "active" });
    await waitFor(() => expect(lastListRequest()).toMatchObject({ isActive: "true", skip: "10" }));
  });

  it("una página más allá de la última cae en la última que existe", async () => {
    listTotal = 15;
    openAt("page=9999");
    renderPage();

    await waitFor(() => expect(urlParams()).toEqual({ page: "2" }));
    await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "10" }));
    expect(await screen.findByText("Categoría 001")).toBeInTheDocument();
  });

  it("`sort` y valores desconocidos caen al valor por defecto sin romper el resto", async () => {
    openAt("sort=cualquiera&dir=arriba&status=borrada&page=-4&limit=abc&search=pint");
    renderPage();
    await screen.findByText("Categoría 001");

    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(listRequests()).toEqual([
      { isActive: "all", limit: "10", search: "pint", skip: "0" },
    ]);
  });

  describe("«Volver a productos»", () => {
    it("sin returnTo lleva a /products", async () => {
      renderPage();

      expect(await screen.findByRole("link", { name: "Volver a productos" })).toHaveAttribute(
        "href",
        "/products",
      );
    });

    it("con returnTo vuelve a la URL exacta de la lista de productos y no lo pierde al filtrar", async () => {
      const user = userEvent.setup();
      const productsUrl = "/products?status=active&page=2";

      openAt(`returnTo=${encodeURIComponent(productsUrl)}`);
      renderPage();
      await screen.findByText("Categoría 001");

      expect(screen.getByRole("link", { name: "Volver a productos" })).toHaveAttribute(
        "href",
        productsUrl,
      );

      await user.selectOptions(screen.getByLabelText("Estado"), "active");

      expect(urlParams()).toEqual({ returnTo: productsUrl, status: "active" });
      expect(screen.getByRole("link", { name: "Volver a productos" })).toHaveAttribute(
        "href",
        productsUrl,
      );
    });
  });
});
