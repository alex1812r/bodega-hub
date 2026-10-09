/**
 * DET-06a · lista de contactos: búsqueda, tipo, estado, página y tamaño viven
 * en la URL (regla 15) y el perfil se abre con la URL exacta de la lista en `returnTo`.
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
    usePathname: () => "/contacts",
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
/** Rol de la sesión simulada: `vendedor` no ve proveedores. */
const mockSession = { role: "admin" };

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({ can: () => true, isLoading: false, role: mockSession.role }),
}));
jest.mock("./components/ContactsExportActions", () => ({
  ContactsExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <span data-testid="export-filters">{JSON.stringify(exportFilters)}</span>
  ),
}));

import { ToastProvider } from "../../../shared/components/Toast";
import { ContactsListPage } from "./page";

function contact(id: string) {
  return {
    address: "",
    email: "",
    id,
    isActive: true,
    name: `Contacto ${id}`,
    phone: "",
    taxId: `J-${id}`,
    type: "cliente",
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

describe("ContactsListPage · estado en la URL (DET-06a)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  /** Total que declara el servidor; por defecto, los contactos de la página. */
  let listTotal: number | undefined;

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/contacts?${query}` : "/contacts");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    const items = [contact("001"), contact("002")];

    listTotal = undefined;
    mockSession.role = "admin";
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

  /** Query de cada `GET /api/contacts`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/contacts")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastListRequest() {
    const requests = listRequests();

    return requests[requests.length - 1];
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  /** `returnTo` de un enlace al perfil, ya como URL de la lista. */
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
        <ToastProvider>
          <ContactsListPage />
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it("sin parámetros pide la lista con los valores por defecto", async () => {
    renderPage();
    await screen.findByText("Contacto 001");

    expect(screen.getByLabelText("Buscar")).toHaveValue("");
    expect(screen.getByLabelText("Tipo")).toHaveValue("all");
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(listRequests()).toEqual([{ limit: "10", skip: "0" }]);
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura búsqueda, tipo, estado, página y tamaño", async () => {
    listTotal = 80;
    openAt("search=acme&type=proveedor&status=inactive&page=3&limit=25");
    renderPage();
    await screen.findByText("Contacto 001");

    expect(screen.getByLabelText("Buscar")).toHaveValue("acme");
    expect(screen.getByLabelText("Tipo")).toHaveValue("proveedor");
    expect(screen.getByLabelText("Estado")).toHaveValue("inactive");
    expect(listRequests()).toEqual([
      { isActive: "false", limit: "25", search: "acme", skip: "50", type: "proveedor" },
    ]);
    expect(screen.getByTestId("export-filters")).toHaveTextContent('"type":"proveedor"');
  });

  it("la búsqueda, el tipo y el estado se escriben en la URL y viajan al servidor", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Contacto 001");

    await user.type(screen.getByLabelText("Buscar"), "acme");
    await user.selectOptions(screen.getByLabelText("Tipo"), "ambos");
    await user.selectOptions(screen.getByLabelText("Estado"), "active");

    await waitFor(() =>
      expect(urlParams()).toEqual({ search: "acme", status: "active", type: "ambos" }),
    );
    await waitFor(() =>
      expect(lastListRequest()).toMatchObject({ isActive: "true", search: "acme", type: "ambos" }),
    );
  });

  it("cambiar un filtro vuelve a la página 1", async () => {
    const user = userEvent.setup();

    listTotal = 40;
    openAt("page=3");
    renderPage();
    await screen.findByText("Contacto 001");
    expect(lastListRequest()).toMatchObject({ skip: "20" });

    await user.selectOptions(screen.getByLabelText("Tipo"), "cliente");

    expect(urlParams()).toEqual({ type: "cliente" });
    await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "0", type: "cliente" }));
  });

  it("cambiar de página escribe `page` en la URL y conserva los filtros", async () => {
    const user = userEvent.setup();

    listTotal = 40;
    openAt("status=active");
    renderPage();
    await screen.findByText("Contacto 001");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(urlParams()).toEqual({ page: "2", status: "active" });
    await waitFor(() => expect(lastListRequest()).toMatchObject({ isActive: "true", skip: "10" }));
  });

  it("el nombre de la fila es un enlace al perfil con la URL exacta de la lista en returnTo", async () => {
    listTotal = 40;
    openAt("search=acme&type=cliente&status=active&page=2&limit=25");
    renderPage();

    const link = await screen.findByRole("link", { name: "Contacto 001" });

    expect(readDetailHref(link.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/contacts/001",
      listParams: { limit: "25", page: "2", search: "acme", status: "active", type: "cliente" },
      listPath: "/contacts",
    });
  });

  it("«Ver perfil» del menú de fila lleva el mismo returnTo", async () => {
    const user = userEvent.setup();

    openAt("status=inactive");
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

    const item = await screen.findByRole("menuitem", { name: "Ver perfil" });

    expect(readDetailHref(item.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/contacts/001",
      listParams: { status: "inactive" },
      listPath: "/contacts",
    });
  });

  it("una página más allá de la última cae en la última que existe", async () => {
    listTotal = 15;
    openAt("page=9999");
    renderPage();

    await waitFor(() => expect(urlParams()).toEqual({ page: "2" }));
    await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "10" }));
    expect(await screen.findByText("Contacto 001")).toBeInTheDocument();
  });

  it("`sort` y valores desconocidos caen al valor por defecto sin romper el resto", async () => {
    openAt("sort=cualquiera&dir=arriba&type=socio&status=borrado&page=-4&limit=abc&search=acme");
    renderPage();
    await screen.findByText("Contacto 001");

    expect(screen.getByLabelText("Tipo")).toHaveValue("all");
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(listRequests()).toEqual([{ limit: "10", search: "acme", skip: "0" }]);
  });

  it("quien no ve proveedores no filtra por tipo aunque la URL lo traiga", async () => {
    mockSession.role = "vendedor";
    openAt("type=proveedor");
    renderPage();
    await screen.findByText("Contacto 001");

    expect(screen.queryByLabelText("Tipo")).not.toBeInTheDocument();
    expect(listRequests()).toEqual([{ limit: "10", skip: "0" }]);
  });
});
