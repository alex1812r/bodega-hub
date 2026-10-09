/**
 * DET-06a · lista de ventas: búsqueda, estado, rango de fechas, página y tamaño
 * viven en la URL (regla 15) y el detalle se abre con la URL exacta de la lista
 * en `returnTo`.
 *
 * CNF-02/03 · «Anular» y «Devolver» del menú de fila abren la confirmación con
 * su efecto y no ejecutan hasta confirmar.
 */
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** URL simulada: `useSearchParams` la sigue como hace Next tras un `history.replaceState`. */
const mockNavigation = {
  listeners: new Set<() => void>(),
  query: "",
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => "/sales",
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
/** Permisos que el usuario NO tiene; vacío = los tiene todos. */
const mockDeniedPermissions = new Set<string>();

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => !mockDeniedPermissions.has(permission),
    isLoading: false,
    role: "admin",
  }),
}));
jest.mock("./components/SalesExportActions", () => ({
  SalesExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <span data-testid="export-filters">{JSON.stringify(exportFilters)}</span>
  ),
}));

import { allowedSaleImpact } from "../components/saleImpact.testFixtures";
import { SalesListPage } from "./page";

function sale(id: string, status = "pendiente_pago") {
  return {
    createdAt: "2026-10-06T13:32:00.000Z",
    customer: { id: "cont-customer", name: `Cliente ${id}`, type: "cliente" },
    customerId: "cont-customer",
    discountRef: 0,
    id,
    invoiceNumber: `F-${id}`,
    paidVes: 0,
    refRateVes: 510,
    status,
    subtotalRef: 20,
    taxRef: 0,
    totalRef: 20,
    totalVes: 10200,
    userId: "user-1",
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

describe("SalesListPage · estado en la URL (DET-06a)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  /** Total que declara el servidor; por defecto, las ventas de la página. */
  let listTotal: number | undefined;

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/sales?${query}` : "/sales");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    const items = [sale("001"), sale("002")];

    listTotal = undefined;
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
    mockDeniedPermissions.clear();
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

  /** Query de cada `GET /api/sales`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/sales")
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
        <SalesListPage />
      </QueryClientProvider>,
    );
  }

  it("sin parámetros pide la lista con los valores por defecto", async () => {
    renderPage();
    await screen.findByText("Cliente 001");

    expect(screen.getByLabelText("Búsqueda")).toHaveValue("");
    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
    expect(listRequests()).toEqual([{ limit: "10", skip: "0" }]);
    expect(urlParams()).toEqual({});
  });

  it("al montar con parámetros restaura búsqueda, estado, rango, página y tamaño", async () => {
    listTotal = 80;
    openAt("search=acme&status=pagada&from=2026-10-01&to=2026-10-06&page=3&limit=25");
    renderPage();
    await screen.findByText("Cliente 001");

    expect(screen.getByLabelText("Búsqueda")).toHaveValue("acme");
    expect(screen.getByLabelText("Estado")).toHaveValue("pagada");
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-06");
    expect(listRequests()).toEqual([
      {
        from: "2026-10-01",
        limit: "25",
        search: "acme",
        skip: "50",
        status: "pagada",
        to: "2026-10-06",
      },
    ]);
    expect(screen.getByTestId("export-filters")).toHaveTextContent(
      '{"from":"2026-10-01","search":"acme","status":"pagada","to":"2026-10-06"}',
    );
  });

  it("la búsqueda y el estado se escriben en la URL y viajan al servidor", async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText("Cliente 001");

    await user.type(screen.getByLabelText("Búsqueda"), "acme");
    await user.selectOptions(screen.getByLabelText("Estado"), "cancelada");

    await waitFor(() => expect(urlParams()).toEqual({ search: "acme", status: "cancelada" }));
    await waitFor(() =>
      expect(lastListRequest()).toMatchObject({ search: "acme", status: "cancelada" }),
    );
  });

  it("Desde y Hasta escriben `from` / `to` en la URL y filtran en servidor", async () => {
    renderPage();
    await screen.findByText("Cliente 001");

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-06" } });

    expect(urlParams()).toEqual({ from: "2026-10-01", to: "2026-10-06" });
    await waitFor(() =>
      expect(lastListRequest()).toMatchObject({ from: "2026-10-01", to: "2026-10-06" }),
    );
  });

  it("cambiar un filtro vuelve a la página 1", async () => {
    const user = userEvent.setup();

    listTotal = 40;
    openAt("page=3");
    renderPage();
    await screen.findByText("Cliente 001");
    expect(lastListRequest()).toMatchObject({ skip: "20" });

    await user.selectOptions(screen.getByLabelText("Estado"), "pagada");

    expect(urlParams()).toEqual({ status: "pagada" });
    await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "0", status: "pagada" }));
  });

  it("cambiar de página escribe `page` en la URL y conserva los filtros", async () => {
    const user = userEvent.setup();

    listTotal = 40;
    openAt("status=pagada&from=2026-10-01");
    renderPage();
    await screen.findByText("Cliente 001");

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(urlParams()).toEqual({ from: "2026-10-01", page: "2", status: "pagada" });
    await waitFor(() =>
      expect(lastListRequest()).toMatchObject({ from: "2026-10-01", skip: "10", status: "pagada" }),
    );
  });

  it("el número de factura es un enlace al detalle con la URL exacta de la lista en returnTo", async () => {
    listTotal = 40;
    openAt("search=acme&status=pagada&from=2026-10-01&to=2026-10-06&page=2&limit=25");
    renderPage();

    const link = await screen.findByRole("link", { name: "#F-001" });

    // El rango de fechas de la lista (`from`/`to`) viaja dentro de `returnTo`, no suelto.
    expect(readDetailHref(link.getAttribute("href"))).toEqual({
      detailParams: ["returnTo"],
      detailPath: "/sales/001",
      listParams: {
        from: "2026-10-01",
        limit: "25",
        page: "2",
        search: "acme",
        status: "pagada",
        to: "2026-10-06",
      },
      listPath: "/sales",
    });
  });

  it("«Ver detalle» y «Ver recibo» del menú de fila llevan el mismo returnTo", async () => {
    const user = userEvent.setup();

    openAt("status=devuelta");
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

    for (const label of ["Ver detalle", "Ver recibo"]) {
      const item = await screen.findByRole("menuitem", { name: label });

      expect(readDetailHref(item.getAttribute("href"))).toEqual({
        detailParams: ["returnTo"],
        detailPath: "/sales/001",
        listParams: { status: "devuelta" },
        listPath: "/sales",
      });
    }
  });

  it("una página más allá de la última cae en la última que existe", async () => {
    listTotal = 15;
    openAt("page=9999");
    renderPage();

    await waitFor(() => expect(urlParams()).toEqual({ page: "2" }));
    await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "10" }));
    expect(await screen.findByText("Cliente 001")).toBeInTheDocument();
  });

  it("`sort` y valores desconocidos caen al valor por defecto sin romper el resto", async () => {
    openAt("sort=cualquiera&dir=arriba&status=recibido&from=2026-02-31&page=-4&limit=abc&to=2026-10-06");
    renderPage();
    await screen.findByText("Cliente 001");

    expect(screen.getByLabelText("Estado")).toHaveValue("all");
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(listRequests()).toEqual([{ limit: "10", skip: "0", to: "2026-10-06" }]);
  });

  describe("anular y devolver desde la fila (CNF-02/03)", () => {
    type Mutation = { method: string; url: string };

    /**
     * Lista con esas ventas, el impact de cualquiera de ellas y las mutaciones:
     * sin `rejection` se aplican; con él, la RPC responde 409 con ese mensaje.
     */
    function installRowApi(items: Array<ReturnType<typeof sale>>, rejection?: string) {
      const mutations: Mutation[] = [];
      const impacts: string[] = [];

      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const method = init?.method ?? "GET";

        if (method !== "GET") {
          mutations.push({ method, url: path });

          return rejection
            ? jsonResponse({ error: { code: "CONFLICT", message: rejection } }, 409)
            : jsonResponse({
                data: path.endsWith("/return") ? { sale: items[0], stockMovements: [] } : items[0],
              });
        }

        if (path.includes("/impact?action=")) {
          impacts.push(path);

          return jsonResponse({
            data: allowedSaleImpact(path.endsWith("=cancel") ? "cancel" : "return"),
          });
        }

        return jsonResponse({ data: { items, limit: 10, skip: 0, total: items.length } });
      });

      return { impacts, mutations };
    }

    async function openRowAction(label: string) {
      const user = userEvent.setup();

      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);
      await user.click(await screen.findByRole("menuitem", { name: label }));
    }

    /** El modal ya con el efecto calculado (antes hay otro, de carga). */
    async function effectDialog(name: string) {
      await screen.findByText("Qué va a pasar");

      return within(screen.getByRole("dialog", { name }));
    }

    it.each<[string, string, string, Mutation]>([
      ["Anular", "Anular venta", "cancel", { method: "PATCH", url: "/api/sales/001/cancel" }],
      ["Devolver", "Devolver venta", "return", { method: "POST", url: "/api/sales/001/return" }],
    ])(
      "«%s» abre la confirmación con el efecto, no ejecuta al cancelar y ejecuta una vez al confirmar",
      async (menuLabel, title, action, mutation) => {
        const { impacts, mutations } = installRowApi([sale("001"), sale("002")]);

        renderPage();
        await openRowAction(menuLabel);

        const dialog = await effectDialog(title);

        expect(impacts).toEqual([`/api/sales/001/impact?action=${action}`]);
        expect(dialog.getByText("Harina PAN 1 kg")).toBeInTheDocument();
        expect(dialog.getByText("+3 und")).toBeInTheDocument();
        expect(mutations).toEqual([]);

        fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(mutations).toEqual([]);

        // Cada apertura recalcula el efecto.
        await openRowAction(menuLabel);

        const confirm = (await effectDialog(title)).getByRole("button", { name: title });

        expect(impacts).toHaveLength(2);

        fireEvent.click(confirm);
        fireEvent.click(confirm);

        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(mutations).toEqual([mutation]);
      },
    );

    it("el rechazo de la RPC se muestra dentro del modal, que no se cierra, y no como error de la lista", async () => {
      const rejection = "La venta F-001 tiene 1 pago(s) activo(s) por Bs 100.00.";
      const { mutations } = installRowApi([sale("001")], rejection);

      renderPage();
      await openRowAction("Anular");

      const dialog = await effectDialog("Anular venta");

      fireEvent.click(dialog.getByRole("button", { name: "Anular venta" }));

      expect(await dialog.findByRole("alert")).toHaveTextContent(rejection);
      expect(mutations).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: "Anular venta" })).toBeInTheDocument();
      expect(screen.getAllByText(rejection)).toHaveLength(1);
    });

    it.each<[string, boolean]>([
      ["pendiente_pago", true],
      ["pagada", true],
      ["cancelada", false],
      ["devuelta", false],
      ["borrador", false],
    ])("venta %s: «Anular» y «Devolver» habilitadas = %s", async (status, enabled) => {
      const user = userEvent.setup();

      installRowApi([sale("001", status)]);
      renderPage();
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      for (const label of ["Anular", "Devolver"]) {
        const item = await screen.findByRole("menuitem", { name: label });

        if (enabled) {
          expect(item).toBeEnabled();
        } else {
          expect(item).toBeDisabled();
        }
      }
      // Las demás acciones de la fila siguen ahí.
      for (const label of ["Ver detalle", "Registrar pago", "Ver recibo"]) {
        expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
      }
    });

    it("sin `sales.create` la fila no ofrece «Anular» ni «Devolver», como el detalle (CNF-S1)", async () => {
      const user = userEvent.setup();
      const { impacts } = installRowApi([sale("001", "pagada")]);

      mockDeniedPermissions.add("sales.create");
      renderPage();
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      // Las acciones que no exigen ese permiso siguen ahí.
      for (const label of ["Ver detalle", "Registrar pago", "Ver recibo"]) {
        expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
      }
      expect(screen.queryByRole("menuitem", { name: "Anular" })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Devolver" })).not.toBeInTheDocument();
      expect(impacts).toEqual([]);
    });

    it("con `sales.create` pero sin otros permisos la fila sigue ofreciendo «Anular» y «Devolver»", async () => {
      const user = userEvent.setup();

      installRowApi([sale("001", "pagada")]);
      mockDeniedPermissions.add("payments.view");
      mockDeniedPermissions.add("payments.manage");
      renderPage();
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      expect(await screen.findByRole("menuitem", { name: "Anular" })).toBeEnabled();
      expect(screen.getByRole("menuitem", { name: "Devolver" })).toBeEnabled();
    });
  });
});
