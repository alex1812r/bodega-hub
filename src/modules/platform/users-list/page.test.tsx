/**
 * DET-06b · usuarios de plataforma: búsqueda, tienda y rol viven en la URL
 * (regla 15) y los detalles se abren con la URL exacta de la lista en `returnTo`.
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
    usePathname: () => "/platform/users",
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

import { PlatformUsersListPage } from "./page";

const STORE_A = "11111111-1111-4111-8111-111111111111";
const STORE_B = "22222222-2222-4222-8222-222222222222";

const stores = [
  { createdAt: "2026-01-15T12:00:00.000Z", id: STORE_A, name: "Tienda A", slug: "a", status: "active", usersCount: 1 },
  { createdAt: "2026-01-15T12:00:00.000Z", id: STORE_B, name: "Tienda B", slug: "b", status: "active", usersCount: 1 },
];

function platformUser(id: string) {
  return {
    email: `u${id}@demo.test`,
    id,
    isActive: true,
    name: `Usuario ${id}`,
    role: "admin",
    store: { id: STORE_A, name: "Tienda A", slug: "a" },
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

describe("PlatformUsersListPage · estado en la URL (DET-06b)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/platform/users?${query}` : "/platform/users");
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
    // jsdom no trae matchMedia; la tabla de escritorio es la que tiene el menú de fila.
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
      const items =
        String(url).split("?")[0] === "/api/platform/stores"
          ? stores
          : [platformUser("001"), platformUser("002")];

      return jsonResponse({ data: { items, limit: 10, skip: 0, total: items.length } });
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

  /** Query de cada `GET /api/platform/users`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/platform/users")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastListRequest() {
    const requests = listRequests();

    return requests[requests.length - 1];
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  /** `returnTo` de un enlace a un detalle, ya como URL de la lista. */
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
        <PlatformUsersListPage />
      </QueryClientProvider>,
    );
  }

  it("sin parámetros pide la lista con los valores por defecto", async () => {
    renderPage();
    await screen.findByText("Usuario 001");

    expect(screen.getByLabelText("Buscar usuarios")).toHaveValue("");
    expect(screen.getByLabelText("Filtrar por tienda")).toHaveValue("");
    expect(screen.getByLabelText("Filtrar por rol")).toHaveValue("all");
    expect(listRequests()).toEqual([{}]);
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura búsqueda, tienda y rol, y la petición inicial ya va filtrada", async () => {
    openAt(`search=ana&store=${STORE_B}&role=vendedor`);
    renderPage();
    await screen.findByText("Usuario 001");
    await screen.findByRole("option", { name: "Tienda B" });

    expect(screen.getByLabelText("Buscar usuarios")).toHaveValue("ana");
    expect(screen.getByLabelText("Filtrar por tienda")).toHaveValue(STORE_B);
    expect(screen.getByLabelText("Filtrar por rol")).toHaveValue("vendedor");
    expect(listRequests()).toEqual([{ role: "vendedor", search: "ana", storeId: STORE_B }]);
  });

  it("la búsqueda, la tienda y el rol se escriben en la URL y viajan al servidor", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Usuario 001");
    await screen.findByRole("option", { name: "Tienda B" });

    await user.type(screen.getByLabelText("Buscar usuarios"), "ana");
    await user.selectOptions(screen.getByLabelText("Filtrar por tienda"), STORE_B);
    await user.selectOptions(screen.getByLabelText("Filtrar por rol"), "contador");

    await waitFor(() =>
      expect(urlParams()).toEqual({ role: "contador", search: "ana", store: STORE_B }),
    );
    await waitFor(() =>
      expect(lastListRequest()).toEqual({ role: "contador", search: "ana", storeId: STORE_B }),
    );
  });

  it("volver a «Todas las tiendas» y «Todos los roles» quita los parámetros de la URL", async () => {
    const user = userEvent.setup();

    openAt(`store=${STORE_A}&role=admin`);
    renderPage();
    await screen.findByText("Usuario 001");
    await screen.findByRole("option", { name: "Tienda A" });

    await user.selectOptions(screen.getByLabelText("Filtrar por tienda"), "");
    await user.selectOptions(screen.getByLabelText("Filtrar por rol"), "all");

    expect(urlParams()).toEqual({});
    await waitFor(() => expect(lastListRequest()).toEqual({}));
  });

  it("el nombre de la fila es un enlace al detalle con la URL exacta de la lista en returnTo", async () => {
    openAt(`search=ana&store=${STORE_A}&role=admin`);
    renderPage();

    const link = await screen.findByRole("link", { name: "Usuario 001" });

    expect(readDetailHref(link.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/platform/users/001",
      listParams: { role: "admin", search: "ana", store: STORE_A },
      listPath: "/platform/users",
    });
  });

  it("el enlace a la tienda de la fila también vuelve a la lista de usuarios", async () => {
    openAt("role=admin");
    renderPage();
    await screen.findByText("Usuario 001");

    const [link] = screen.getAllByRole("link", { name: /Tienda A/ });

    expect(readDetailHref(link.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: `/platform/stores/${STORE_A}`,
      listParams: { role: "admin" },
      listPath: "/platform/users",
    });
  });

  it("«Ver detalle» del menú de fila lleva el mismo returnTo", async () => {
    const user = userEvent.setup();

    openAt("role=almacen");
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

    const item = await screen.findByRole("menuitem", { name: "Ver detalle" });

    expect(readDetailHref(item.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/platform/users/001",
      listParams: { role: "almacen" },
      listPath: "/platform/users",
    });
  });

  it("`page=9999`, `sort`, un rol desconocido y una tienda que no es un id no rompen ni viajan al servidor", async () => {
    openAt("page=9999&sort=cualquiera&role=superadmin&store=no-es-un-id&search=ana");
    renderPage();
    await screen.findByText("Usuario 001");

    expect(screen.getByLabelText("Filtrar por rol")).toHaveValue("all");
    expect(screen.getByLabelText("Filtrar por tienda")).toHaveValue("");
    expect(listRequests()).toEqual([{ search: "ana" }]);
  });
});
