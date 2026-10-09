/**
 * COM-08 · lista de compras: columnas Pagado y Saldo, badge de estado de pago,
 * filtro "Con saldo pendiente" y rango de fechas. Todo el estado de la lista
 * vive en la URL (regla 15) y el detalle se abre con `returnTo`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** URL simulada: `useSearchParams` la sigue como hace Next tras un `history.replaceState`. */
const mockNavigation = {
  listeners: new Set<() => void>(),
  query: "",
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => "/purchases",
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
/** Permisos que la sesión simulada NO tiene; vacío = admin. */
const mockDeniedPermissions = new Set<string>();
/** Rol de la sesión simulada: decide quién ve los pagos de una compra. */
const mockSession = { role: "admin" };

jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => !mockDeniedPermissions.has(permission),
    isLoading: false,
    role: mockSession.role,
  }),
}));
jest.mock("./components/PurchasesExportActions", () => ({
  PurchasesExportActions: ({ exportFilters }: { exportFilters: unknown }) => (
    <span data-testid="export-filters">{JSON.stringify(exportFilters)}</span>
  ),
}));

import { PurchasesListPage } from "./page";

function purchase(id: string, overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-10-06T13:32:00.000Z",
    discountRef: 0,
    id,
    itemsCount: 1,
    paidRef: 0,
    paidVes: 0,
    purchaseNumber: `C-${id}`,
    refRateVes: 510,
    status: "recibido",
    subtotalRef: 20,
    supplier: { id: "cont-supplier", name: `Proveedor ${id}`, type: "proveedor" },
    supplierId: "cont-supplier",
    taxRef: 0,
    totalRef: 20,
    totalVes: 10200,
    userId: "user-1",
    ...overrides,
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

describe("PurchasesListPage", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  let listItems: ReturnType<typeof purchase>[];
  /** Total que declara el servidor; por defecto, las compras de `listItems`. */
  let listTotal: number | undefined;
  let listFailure: { message: string; status: number } | null;

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/purchases?${query}` : "/purchases");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    listItems = [
      purchase("001"),
      purchase("002", { paidRef: 5.02, paidVes: 2500, totalRef: 18 }),
      purchase("003", { paidRef: 20, paidVes: 10200 }),
      purchase("004", { status: "cancelado", totalRef: 33.5 }),
    ];
    listTotal = undefined;
    listFailure = null;
    mockDeniedPermissions.clear();
    mockSession.role = "admin";
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
      if (listFailure) {
        return jsonResponse(
          { error: { code: "INTERNAL_ERROR", message: listFailure.message } },
          listFailure.status,
        );
      }

      // Como el servidor: más allá del total no hay filas, y devuelve el `skip` pedido.
      const query = new URLSearchParams(String(url).split("?")[1] ?? "");
      const skip = Number(query.get("skip") ?? 0);
      const total = listTotal ?? listItems.length;

      return jsonResponse({
        data: {
          items: skip < total ? listItems : [],
          limit: Number(query.get("limit") ?? 10),
          skip,
          total,
          ...(query.get("pendingBalance") === "1" ? { pendingBalanceRef: 32.98 } : {}),
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

  /** Query de cada `GET /api/purchases`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/purchases")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastListRequest() {
    const requests = listRequests();

    return requests[requests.length - 1];
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  function pendingToggle() {
    return screen.getByRole("button", { name: "Con saldo pendiente" });
  }

  function rowOf(supplierName: string) {
    const row = screen.getByText(supplierName).closest("tr");

    if (!row) {
      throw new Error(`No hay fila para ${supplierName}.`);
    }

    return within(row);
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <PurchasesListPage />
      </QueryClientProvider>,
    );
  }

  describe("Pagado, Saldo y estado de pago", () => {
    it("pinta las columnas y, por fila, lo pagado, el saldo y el badge", async () => {
      renderPage();
      await screen.findByText("Proveedor 001");

      const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);

      expect(headers).toEqual(
        expect.arrayContaining(["Estado", "Pago", "Total (REF)", "Pagado (REF)", "Saldo (REF)"]),
      );

      // Sin pagos: debe todo.
      expect(rowOf("Proveedor 001").getByText("Pendiente")).toBeInTheDocument();
      expect(rowOf("Proveedor 001").getByText("ref 0.00")).toBeInTheDocument();
      expect(rowOf("Proveedor 001").getAllByText("ref 20.00")).toHaveLength(2);

      // Abono parcial: total 18, pagado 5.02, saldo 12.98.
      expect(rowOf("Proveedor 002").getByText("Parcial")).toBeInTheDocument();
      expect(rowOf("Proveedor 002").getByText("ref 5.02")).toBeInTheDocument();
      expect(rowOf("Proveedor 002").getByText("ref 12.98")).toBeInTheDocument();

      // Pagada entera: saldo 0.
      expect(rowOf("Proveedor 003").getByText("Pagada")).toBeInTheDocument();
      expect(rowOf("Proveedor 003").getByText("ref 0.00")).toBeInTheDocument();
    });

    it("el saldo que se debe va resaltado; el saldo en cero, no", async () => {
      renderPage();
      await screen.findByText("Proveedor 001");

      expect(rowOf("Proveedor 002").getByText("ref 12.98")).toHaveClass("text-destructive");
      expect(rowOf("Proveedor 003").getByText("ref 0.00")).not.toHaveClass("text-destructive");
    });

    it("una compra cancelada no lleva estado de pago ni saldo", async () => {
      renderPage();
      await screen.findByText("Proveedor 004");

      const row = rowOf("Proveedor 004");

      expect(row.getByText("Cancelado")).toBeInTheDocument();
      expect(row.queryByText(/^(Pagada|Parcial|Pendiente)$/)).not.toBeInTheDocument();
      expect(row.getAllByTitle("No aplica")).toHaveLength(2);
    });
  });

  describe("filtro «Con saldo pendiente»", () => {
    it("un clic lo activa: escribe la URL, filtra en servidor y enseña el saldo del filtro", async () => {
      const user = userEvent.setup();

      renderPage();
      await screen.findByText("Proveedor 001");
      expect(pendingToggle()).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(lastListRequest()).not.toHaveProperty("pendingBalance");

      await user.click(pendingToggle());

      expect(pendingToggle()).toHaveAttribute("aria-pressed", "true");
      expect(urlParams()).toEqual({ pendingBalance: "1" });
      await waitFor(() => expect(lastListRequest()).toMatchObject({ pendingBalance: "1" }));

      const summary = await screen.findByRole("status");

      expect(summary).toHaveTextContent("Saldo pendiente en 4 compras");
      expect(summary).toHaveTextContent("ref 32.98");
      expect(screen.getByTestId("export-filters")).toHaveTextContent('"pendingBalance":"1"');
    });

    it("otro clic lo quita de la URL y de la consulta", async () => {
      const user = userEvent.setup();

      openAt("pendingBalance=1");
      renderPage();
      await screen.findByRole("status");

      await user.click(pendingToggle());

      expect(urlParams()).toEqual({});
      await waitFor(() => expect(lastListRequest()).not.toHaveProperty("pendingBalance"));
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    });

    it("activarlo vuelve a la página 1", async () => {
      const user = userEvent.setup();

      listTotal = 40;
      openAt("page=3");
      renderPage();
      await screen.findByText("Proveedor 001");
      expect(lastListRequest()).toMatchObject({ skip: "20" });

      await user.click(pendingToggle());

      expect(urlParams()).toEqual({ pendingBalance: "1" });
      await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "0" }));
    });
  });

  describe("rango de fechas", () => {
    it("Desde y Hasta escriben `from` / `to` en la URL y filtran en servidor", async () => {
      renderPage();
      await screen.findByText("Proveedor 001");

      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-06" } });

      expect(urlParams()).toEqual({ from: "2026-10-01", to: "2026-10-06" });
      await waitFor(() =>
        expect(lastListRequest()).toMatchObject({ from: "2026-10-01", to: "2026-10-06" }),
      );
      expect(screen.getByTestId("export-filters")).toHaveTextContent('"from":"2026-10-01"');
    });

    it("un rango invertido no se puede elegir: el otro extremo acompaña", async () => {
      openAt("from=2026-10-01&to=2026-10-05");
      renderPage();
      await screen.findByText("Proveedor 001");

      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-08" } });
      expect(urlParams()).toEqual({ from: "2026-10-08", to: "2026-10-08" });

      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-02" } });
      expect(urlParams()).toEqual({ from: "2026-10-02", to: "2026-10-02" });
    });
  });

  describe("estado en la URL (regla 15)", () => {
    it("al montar con parámetros restaura búsqueda, estado, saldo, rango, página y tamaño", async () => {
      listTotal = 80;
      openAt(
        "search=acme&status=recibido&pendingBalance=1&from=2026-10-01&to=2026-10-06&page=3&limit=25",
      );
      renderPage();
      await screen.findByText("Proveedor 001");

      expect(screen.getByLabelText("Búsqueda")).toHaveValue("acme");
      expect(screen.getByLabelText("Estado")).toHaveValue("recibido");
      expect(pendingToggle()).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-01");
      expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-06");
      expect(listRequests()).toEqual([
        {
          from: "2026-10-01",
          limit: "25",
          pendingBalance: "1",
          search: "acme",
          skip: "50",
          status: "recibido",
          to: "2026-10-06",
        },
      ]);
    });

    it("un parámetro inválido cae a su valor por defecto sin romper el resto", async () => {
      openAt("status=pagada&from=2026-02-31&pendingBalance=si&to=2026-10-06");
      renderPage();
      await screen.findByText("Proveedor 001");

      expect(screen.getByLabelText("Estado")).toHaveValue("all");
      expect(screen.getByLabelText("Desde")).toHaveValue("");
      expect(pendingToggle()).toHaveAttribute("aria-pressed", "false");
      expect(listRequests()).toEqual([{ limit: "10", skip: "0", to: "2026-10-06" }]);
    });

    it("la búsqueda y el estado se escriben en la URL y viajan al servidor", async () => {
      const user = userEvent.setup();

      renderPage();
      await screen.findByText("Proveedor 001");

      await user.type(screen.getByLabelText("Búsqueda"), "acme");
      await user.selectOptions(screen.getByLabelText("Estado"), "pedido");

      await waitFor(() => expect(urlParams()).toEqual({ search: "acme", status: "pedido" }));
      await waitFor(() =>
        expect(lastListRequest()).toMatchObject({ search: "acme", status: "pedido" }),
      );
    });

    it("«Limpiar filtros» solo aparece con filtros y los quita todos, sin tocar el tamaño", async () => {
      const user = userEvent.setup();

      openAt("search=acme&status=recibido&pendingBalance=1&from=2026-10-01&limit=25");
      renderPage();
      await screen.findByText("Proveedor 001");

      await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

      expect(urlParams()).toEqual({ limit: "25" });
      expect(screen.getByLabelText("Búsqueda")).toHaveValue("");
      await waitFor(() => expect(lastListRequest()).toEqual({ limit: "25", skip: "0" }));
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("una página más allá de la última cae en la última que existe", async () => {
      listTotal = 15;
      openAt("page=9");
      renderPage();

      await waitFor(() => expect(urlParams()).toEqual({ page: "2" }));
      await waitFor(() => expect(lastListRequest()).toMatchObject({ skip: "10" }));
    });

    it("«Ver detalle» abre la compra con la URL exacta de la lista en returnTo", async () => {
      const user = userEvent.setup();

      listTotal = 40;
      openAt("status=recibido&pendingBalance=1&from=2026-10-01&to=2026-10-06&page=2");
      renderPage();
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      const href = (await screen.findByRole("menuitem", { name: "Ver detalle" })).getAttribute(
        "href",
      );
      const detailUrl = new URL(href ?? "", "http://localhost");
      const returnTo = new URL(detailUrl.searchParams.get("returnTo") ?? "", "http://localhost");

      expect(detailUrl.pathname).toBe("/purchases/001");
      expect([...detailUrl.searchParams.keys()]).toEqual(["returnTo"]);
      expect(returnTo.pathname).toBe("/purchases");
      expect(Object.fromEntries(returnTo.searchParams)).toEqual({
        from: "2026-10-01",
        page: "2",
        pendingBalance: "1",
        status: "recibido",
        to: "2026-10-06",
      });
    });
  });

  describe("la tabla cabe sin desplazamiento horizontal (COM-F4)", () => {
    function header(name: string) {
      return screen.getByRole("columnheader", { name });
    }

    it("el número de compra va entero y es un enlace al detalle con returnTo", async () => {
      openAt("pendingBalance=1&page=1");
      renderPage();
      await screen.findByText("Proveedor 001");

      const link = rowOf("Proveedor 001").getByRole("link", { name: "#C-001" });
      const detailUrl = new URL(link.getAttribute("href") ?? "", "http://localhost");
      const returnTo = new URL(detailUrl.searchParams.get("returnTo") ?? "", "http://localhost");

      expect(link).toHaveTextContent(/^#C-001$/);
      expect(link).toHaveClass("whitespace-nowrap");
      expect(link).not.toHaveClass("truncate");
      expect(link.closest("td")).not.toHaveClass("overflow-hidden");
      expect(link.closest("td")?.className).not.toMatch(/max-w-/);
      expect(detailUrl.pathname).toBe("/purchases/001");
      expect([...detailUrl.searchParams.keys()]).toEqual(["returnTo"]);
      expect(returnTo.pathname).toBe("/purchases");
      expect(Object.fromEntries(returnTo.searchParams)).toEqual({ pendingBalance: "1" });
    });

    it("Fecha y Pagado solo se ven con ancho de contenedor de sobra; el resto, siempre", async () => {
      renderPage();
      await screen.findByText("Proveedor 001");

      // El ancho que cuenta es el de la tarjeta de la tabla, no el de la ventana.
      expect(screen.getByRole("table").closest(".\\@container")).not.toBeNull();
      expect(header("Fecha")).toHaveClass("hidden", "@6xl:table-cell");
      expect(header("Pagado (REF)")).toHaveClass("hidden", "@7xl:table-cell");

      for (const name of [
        "N° Compra",
        "Proveedor",
        "Estado",
        "Pago",
        "Total (REF)",
        "Saldo (REF)",
        "Acciones",
      ]) {
        expect(header(name)).not.toHaveClass("hidden");
      }
    });

    it("las celdas siguen la misma regla que su cabecera y la fecha no se pierde al ocultar su columna", async () => {
      renderPage();
      await screen.findByText("Proveedor 002");

      const row = rowOf("Proveedor 002");
      const paidCell = row.getByText("ref 5.02").closest("td");
      const [dateUnderNumber, dateCell] = row.getAllByText(/^6 oct\.?, \d{2}:\d{2}$/);

      expect(paidCell).toHaveClass("hidden", "@7xl:table-cell");
      // Bajo el número mientras la columna Fecha está oculta; después, solo en su columna.
      expect(dateUnderNumber).toHaveClass("@6xl:hidden");
      expect(dateCell.closest("td")).toHaveClass("hidden", "@6xl:table-cell");
      expect(row.getByText("ref 12.98").closest("td")).not.toHaveClass("hidden");
      expect(row.getByRole("button", { name: /acciones/i }).closest("td")).not.toHaveClass(
        "hidden",
      );
    });

    it("importes, fecha y sus cabeceras no se parten en dos líneas", async () => {
      renderPage();
      await screen.findByText("Proveedor 002");

      const row = rowOf("Proveedor 002");

      for (const name of ["Fecha", "Total (REF)", "Pagado (REF)", "Saldo (REF)"]) {
        expect(header(name)).toHaveClass("whitespace-nowrap");
      }

      expect(row.getByText("ref 18.00").closest("td")).toHaveClass("whitespace-nowrap");
      expect(row.getByText("ref 12.98").closest("td")).toHaveClass("whitespace-nowrap");
    });

    it("el nombre del proveedor tiene tope de ancho y se recorta con el nombre completo en el título", async () => {
      renderPage();

      const name = await screen.findByText("Proveedor 001");

      expect(name).toHaveClass("truncate");
      expect(name).toHaveAttribute("title", "Proveedor 001");
      expect(name.parentElement?.className).toMatch(/(^| )max-w-/);
    });
  });

  describe("recibir desde la fila (COM-F4)", () => {
    /** Peticiones que no son lecturas: recibir es un PATCH. */
    function writeRequests() {
      return fetchMock.mock.calls.filter(([, init]) => {
        const method = (init as RequestInit | undefined)?.method;

        return method !== undefined && method !== "GET";
      });
    }

    async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      return screen.findAllByRole("menuitem");
    }

    it("en un pedido no recibe: lleva al detalle con receive=1 y la URL de la lista en returnTo", async () => {
      const user = userEvent.setup();

      listItems = [purchase("001", { status: "pedido" })];
      openAt("status=pedido&pendingBalance=1");
      renderPage();
      await openRowMenu(user);

      expect(screen.queryByRole("menuitem", { name: /Recibir pedido/ })).not.toBeInTheDocument();

      const receive = screen.getByRole("menuitem", { name: "Recibir mercancía…" });
      const detailUrl = new URL(receive.getAttribute("href") ?? "", "http://localhost");
      const returnTo = new URL(detailUrl.searchParams.get("returnTo") ?? "", "http://localhost");

      expect(receive.tagName).toBe("A");
      expect(detailUrl.pathname).toBe("/purchases/001");
      expect(detailUrl.searchParams.get("receive")).toBe("1");
      expect(returnTo.pathname).toBe("/purchases");
      expect(Object.fromEntries(returnTo.searchParams)).toEqual({
        pendingBalance: "1",
        status: "pedido",
      });

      // jsdom no navega: el clic solo demuestra que no sale ninguna escritura.
      receive.addEventListener("click", (event) => event.preventDefault());
      await user.click(receive);

      expect(writeRequests()).toHaveLength(0);
    });

    it("una compra que no está en pedido no ofrece recibir", async () => {
      const user = userEvent.setup();

      listItems = [purchase("001", { status: "recibido" })];
      renderPage();

      const labels = (await openRowMenu(user)).map((item) => item.textContent);

      expect(labels).toContain("Ver detalle");
      expect(labels.some((label) => /recibir/i.test(label ?? ""))).toBe(false);
    });

    it("sin permiso de recibir, el pedido no ofrece la acción", async () => {
      const user = userEvent.setup();

      mockDeniedPermissions.add("purchases.create");
      listItems = [purchase("001", { status: "pedido" })];
      renderPage();

      const labels = (await openRowMenu(user)).map((item) => item.textContent);

      expect(labels).toContain("Ver detalle");
      expect(labels.some((label) => /recibir/i.test(label ?? ""))).toBe(false);
    });
  });

  // COM-F10 · F-G1: la fila ofrecía Cancelar, Devolver y Registrar pago a todos los roles y estados.
  describe("acciones de la fila según permiso y estado (COM-F10 · F-G1)", () => {
    async function rowMenu(user: ReturnType<typeof userEvent.setup>) {
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      return screen.findAllByRole("menuitem");
    }

    async function rowLabels(user: ReturnType<typeof userEvent.setup>) {
      return (await rowMenu(user)).map((item) => item.textContent);
    }

    /** El contador: ve compras y gestiona pagos, no crea compras. */
    function asContador() {
      mockSession.role = "contador";
      mockDeniedPermissions.add("purchases.create");
    }

    /** Almacén: crea y recibe compras, no gestiona pagos. */
    function asAlmacen() {
      mockSession.role = "almacen";
      mockDeniedPermissions.add("payments.manage");
      mockDeniedPermissions.add("payments.view");
    }

    it("admin, compra recibida con saldo: detalle, pago, cancelar y devolver", async () => {
      const user = userEvent.setup();

      listItems = [purchase("001", { status: "recibido" })];
      renderPage();

      expect(await rowLabels(user)).toEqual(["Ver detalle", "Registrar pago", "Cancelar", "Devolver"]);
      expect(screen.getByRole("menuitem", { name: "Registrar pago" })).toHaveAttribute(
        "href",
        "/payments?purchaseId=001",
      );
    });

    it("contador: no ve Cancelar ni Devolver (terminaban en 403) y sí Registrar pago", async () => {
      const user = userEvent.setup();

      asContador();
      listItems = [purchase("001", { status: "recibido" })];
      renderPage();

      expect(await rowLabels(user)).toEqual(["Ver detalle", "Registrar pago"]);
    });

    it("almacén: no ve Registrar pago (llevaba a «sin permiso») y sí Cancelar y Devolver", async () => {
      const user = userEvent.setup();

      asAlmacen();
      listItems = [purchase("001", { status: "pedido" })];
      renderPage();

      expect(await rowLabels(user)).toEqual([
        "Ver detalle",
        "Recibir mercancía…",
        "Cancelar",
        "Devolver",
      ]);
    });

    it("una compra ya pagada no ofrece Registrar pago", async () => {
      const user = userEvent.setup();

      listItems = [purchase("001", { paidRef: 20, paidVes: 10200 })];
      renderPage();

      expect(await rowLabels(user)).toEqual(["Ver detalle", "Cancelar", "Devolver"]);
    });

    it.each(["cancelado", "devuelto"])(
      "una compra en estado %s no admite pago, y Cancelar y Devolver quedan deshabilitadas como en el detalle",
      async (status) => {
        const user = userEvent.setup();

        listItems = [purchase("001", { status })];
        renderPage();

        expect(await rowLabels(user)).toEqual(["Ver detalle", "Cancelar", "Devolver"]);
        expect(screen.getByRole("menuitem", { name: "Cancelar" })).toBeDisabled();
        expect(screen.getByRole("menuitem", { name: "Devolver" })).toBeDisabled();

        await user.click(screen.getByRole("menuitem", { name: "Cancelar" }));

        expect(
          fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method),
        ).toHaveLength(0);
      },
    );

    it("contador sobre una compra anulada: solo Ver detalle", async () => {
      const user = userEvent.setup();

      asContador();
      listItems = [purchase("001", { status: "cancelado" })];
      renderPage();

      expect(await rowLabels(user)).toEqual(["Ver detalle"]);
    });
  });

  describe("estados de la lista", () => {
    it("sin compras y sin filtros invita a registrar la primera", async () => {
      listItems = [];
      renderPage();

      expect(await screen.findByText("No hay compras para mostrar")).toBeInTheDocument();
      expect(screen.getByText("Registra una compra para verla aquí.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("sin resultados con filtros ofrece limpiarlos", async () => {
      const user = userEvent.setup();

      listItems = [];
      openAt("pendingBalance=1");
      renderPage();

      expect(await screen.findByText(/Ninguna compra coincide con los filtros/)).toBeInTheDocument();

      await user.click(screen.getAllByRole("button", { name: "Limpiar filtros" })[0]);

      expect(urlParams()).toEqual({});
    });

    it("si el listado falla enseña el mensaje del servidor", async () => {
      listFailure = { message: "No se pudo cargar las compras.", status: 500 };
      renderPage();

      expect(await screen.findByText("No se pudo cargar las compras.")).toBeInTheDocument();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText("Proveedor 001")).not.toBeInTheDocument();
    });
  });
});
