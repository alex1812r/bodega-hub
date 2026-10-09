/**
 * SHR-19 M4 · el rechazo de «Anular pago» se ve dentro del modal de confirmacion
 * (que sigue abierto para reintentar), no detras, y no deja promesas sin capturar.
 *
 * PAG-05 · el estado de la lista vive en la URL, los filtros visibles son fecha,
 * metodo y tipo, los enlaces profundos se ven como chips (nunca un campo de ID)
 * y la columna "Documento" enlaza al detalle con `returnTo`.
 *
 * PAG-F2 · «Ver comprobante» lleva `returnTo`, la cabecera «Comprobante» cabe en su
 * columna, una pagina fuera de rango cae en la ultima valida y la exportacion recibe
 * los textos humanos de los chips (nunca ids).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SCROLL_POSITIONS_STORAGE_KEY } from "@/shared/hooks/useScrollRestoration";

/** URL simulada: `useSearchParams` la sigue como hace Next tras un `history.replaceState`. */
const mockNavigation = {
  listeners: new Set<() => void>(),
  query: "",
};
const mockAuth: { permissions: string[] | "all"; role: string } = {
  permissions: "all",
  role: "admin",
};

jest.mock("next/navigation", () => {
  const react = jest.requireActual<typeof import("react")>("react");

  return {
    usePathname: () => "/payments",
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
  usePermission: () => ({
    can: (permission: string) =>
      mockAuth.permissions === "all" || mockAuth.permissions.includes(permission),
    role: mockAuth.role,
  }),
}));
jest.mock("./components/PaymentsExportActions", () => ({
  PaymentsExportActions: ({
    exportFilters,
    filterLabels,
  }: {
    exportFilters: unknown;
    filterLabels?: readonly string[];
  }) => (
    <>
      <output data-testid="export-filters">{JSON.stringify(exportFilters)}</output>
      <output data-testid="export-filter-labels">{JSON.stringify(filterLabels ?? null)}</output>
    </>
  ),
}));
jest.mock("../components/RegisterPaymentModal", () => ({
  RegisterPaymentModal: () => null,
}));

import { computePaymentImpact } from "../services/paymentImpact";
import { PaymentsListPage } from "./page";

const REJECTION = "El pago pertenece a una caja ya cerrada y transferida.";

function payment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    amountRef: 0.2,
    amountVes: 100,
    contact: { id: "cont-customer", name: "Cliente Demo", type: "cliente" },
    contactId: "cont-customer",
    createdAt: "2026-10-06T13:32:00.000Z",
    currency: "VES",
    direction: "entrada",
    id,
    method: "efectivo_ves",
    refRateVes: 510,
    relatedDocument: { href: "/sales/sale-002", label: "V-000002" },
    saleId: "sale-002",
    status: "activo",
    ...overrides,
  };
}

/** Impact que serviría el endpoint para un cobro en efectivo de la caja abierta «Caja 1». */
function cancelImpact(paymentId: string) {
  return computePaymentImpact({
    action: "cancel",
    canCancelPayments: true,
    document: {
      contactName: "Cliente Demo",
      id: "sale-002",
      kind: "sale",
      number: "V-000002",
      paidVes: 100,
      status: "pagada",
      totalVes: 100,
    },
    ledger: {
      cashMovements: [
        {
          amountRef: 0,
          amountVes: 100,
          registerName: "Caja 1",
          sessionStatus: "open",
          type: "sale_in",
          vaultTransferredAt: null,
        },
      ],
      kind: "full",
      vault: null,
      vaultMovements: [],
    },
    payment: {
      amount: 100,
      amountRef: 0.2,
      amountVes: 100,
      changeMethod: null,
      changeRef: 0,
      changeVes: 0,
      currency: "VES",
      id: paymentId,
      method: "efectivo_ves",
      status: "activo",
    },
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("PaymentsListPage", () => {
  const fetchMock = jest.fn();
  const unhandled = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const nativeReplaceState = window.history.replaceState.bind(window.history);
  let cancelResponse: () => Promise<Response>;
  let listItems: ReturnType<typeof payment>[];
  /** Total que declara el servidor; por defecto, los pagos de `listItems`. */
  let listTotal: number | undefined;
  let detailResponses: Record<string, () => Promise<Response>>;
  let isMobile: boolean;

  /** Deja la pantalla en esa query, como si se hubiera abierto con ese enlace. */
  function openAt(query: string) {
    nativeReplaceState(null, "", query ? `/payments?${query}` : "/payments");
    mockNavigation.query = query;
  }

  beforeEach(() => {
    mockAuth.permissions = "all";
    mockAuth.role = "admin";
    isMobile = false;
    listItems = [payment("pay-001"), payment("pay-002")];
    listTotal = undefined;
    detailResponses = Object.fromEntries(
      ["pay-001", "pay-002"].map((id) => [
        `/api/payments/${id}/impact`,
        async () => jsonResponse({ data: cancelImpact(id) }),
      ]),
    );
    openAt("");
    // Lo que hace Next con un `replaceState`: reflejar la URL en `useSearchParams`.
    window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      nativeReplaceState(data, unused, url);
      mockNavigation.query = window.location.search.slice(1);
      mockNavigation.listeners.forEach((listener) => listener());
    };
    // jsdom no trae matchMedia; la tabla de escritorio es la que tiene el menu de fila.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: jest.fn(),
        matches: isMobile,
        media: query,
        removeEventListener: jest.fn(),
      }),
    });
    cancelResponse = async () =>
      jsonResponse({ error: { code: "CONFLICT", message: REJECTION } }, 409);
    unhandled.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return cancelResponse();
      }

      const path = String(url).split("?")[0];

      if (path !== "/api/payments") {
        return (
          detailResponses[path]?.() ??
          jsonResponse({ error: { code: "NOT_FOUND", message: "No encontrado." } }, 404)
        );
      }

      // Como el servidor: mas alla del total no hay filas, y devuelve el `skip` pedido.
      const query = new URLSearchParams(String(url).split("?")[1] ?? "");
      const skip = Number(query.get("skip") ?? 0);
      const total = listTotal ?? listItems.length;

      return jsonResponse({
        data: {
          items: skip < total ? listItems : [],
          limit: Number(query.get("limit") ?? 10),
          skip,
          total,
        },
      });
    });
    global.fetch = fetchMock;
    process.on("unhandledRejection", unhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", unhandled);
    window.history.replaceState = nativeReplaceState;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function cancelCalls() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      .map(([url]) => String(url));
  }

  /** Query de cada `GET /api/payments`, en orden. */
  function listRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.split("?")[0] === "/api/payments")
      .map((url) => Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")));
  }

  function lastListRequest() {
    const requests = listRequests();

    return requests[requests.length - 1];
  }

  function requestedPaths() {
    return fetchMock.mock.calls.map(([url]) => String(url).split("?")[0]);
  }

  /**
   * Rutas pedidas por la lista y sus filtros. Deja fuera la unica peticion ajena
   * legitima: la del aviso de ventas pendientes (PAG-07), `open-documents` con
   * `olderThanDays`.
   */
  function listRequestedPaths() {
    return fetchMock.mock.calls
      .map(([url]) => String(url).split("?"))
      .filter(
        ([path, search = ""]) =>
          !(
            path === "/api/payments/open-documents" &&
            new URLSearchParams(search).has("olderThanDays")
          ),
      )
      .map(([path]) => path);
  }

  function urlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
  }

  function filtersPanel() {
    return within(screen.getByRole("region", { name: "Filtros de pagos" }));
  }

  async function openCancelModal(user: ReturnType<typeof userEvent.setup>, row: number) {
    const menus = await screen.findAllByRole("button", { name: /acciones/i });

    await user.click(menus[row]);
    await user.click(await screen.findByRole("menuitem", { name: "Anular" }));
    // El modal calcula primero el efecto; el botón de anular llega con él.
    await screen.findByRole("button", { name: "Anular pago" });

    return within(screen.getByRole("dialog"));
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <PaymentsListPage />
      </QueryClientProvider>,
    );
  }

  // PAG-F4 D: un pago que llega sin `contact` (la respuesta del POST recién insertada
  // en la lista) no enseña el id interno del contacto.
  it("una fila sin datos del contacto dice «Sin contacto», nunca el id", async () => {
    listItems = [
      payment("pay-001", { contact: undefined, contactId: "cont-both" }),
      payment("pay-002"),
    ];
    const { container } = renderPage();

    expect(await screen.findByText("Cliente Demo")).toBeInTheDocument();
    expect(screen.getByText("Sin contacto")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("cont-both");
  });

  describe("anular pago", () => {
    it("CNF-06: confirma con el efecto del pago de esa fila y cancelar no anula nada", async () => {
      const user = userEvent.setup();

      renderPage();
      const dialog = await openCancelModal(user, 1);

      expect(
        fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/impact")),
      ).toEqual(["/api/payments/pay-002/impact?action=cancel"]);
      expect(dialog.getByText("Sale de la caja «Caja 1»: −Bs. 100,00")).toBeInTheDocument();
      expect(dialog.getByText("Pendiente de pago")).toBeInTheDocument();

      await user.click(dialog.getByRole("button", { name: "Cancelar" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(cancelCalls()).toEqual([]);
    });

    it("muestra el rechazo del servidor dentro del modal, que sigue abierto para reintentar", async () => {
      const user = userEvent.setup();

      renderPage();
      const dialog = await openCancelModal(user, 0);

      await user.click(dialog.getByRole("button", { name: "Anular pago" }));

      expect(await dialog.findByRole("alert")).toHaveTextContent(REJECTION);
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(cancelCalls()).toEqual(["/api/payments/pay-001/cancel"]);

      // Reintento: ahora el servidor acepta y el modal se cierra.
      cancelResponse = async () =>
        jsonResponse({ data: { ...payment("pay-001"), status: "anulado" } });
      await user.click(dialog.getByRole("button", { name: "Anular pago" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(cancelCalls()).toHaveLength(2);
    });

    it("un corte de red tambien se ve dentro del modal y no deja una promesa sin capturar", async () => {
      const user = userEvent.setup();

      cancelResponse = async () => {
        throw new TypeError("Failed to fetch");
      };
      renderPage();
      const dialog = await openCancelModal(user, 0);

      await user.click(dialog.getByRole("button", { name: "Anular pago" }));

      expect(await dialog.findByRole("alert")).toHaveTextContent("Failed to fetch");
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("el error de un pago no reaparece al cancelar y abrir el modal para otro pago", async () => {
      const user = userEvent.setup();

      renderPage();
      const dialog = await openCancelModal(user, 0);

      await user.click(dialog.getByRole("button", { name: "Anular pago" }));
      expect(await dialog.findByRole("alert")).toHaveTextContent(REJECTION);

      await user.click(dialog.getByRole("button", { name: "Cancelar" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      // La lista sigue ahi (el fallo de la anulacion no la sustituye por un error).
      expect(screen.queryByText(REJECTION)).not.toBeInTheDocument();

      const reopened = await openCancelModal(user, 1);

      expect(reopened.queryByRole("alert")).not.toBeInTheDocument();
      expect(reopened.getByRole("button", { name: "Anular pago" })).toBeEnabled();
    });
  });

  describe("PAG-05 · estado en la URL", () => {
    it("abre con los filtros, la pagina y el tamaño que trae la URL", async () => {
      listTotal = 60;
      openAt("direction=entrada&method=pago_movil&from=2026-10-01&to=2026-10-06&page=3&limit=25");
      renderPage();

      await screen.findAllByRole("link", { name: "V-000002" });

      expect(lastListRequest()).toEqual({
        direction: "entrada",
        from: "2026-10-01",
        limit: "25",
        method: "pago_movil",
        skip: "50",
        to: "2026-10-06",
      });
      expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-01");
      expect(screen.getByLabelText("Hasta")).toHaveValue("2026-10-06");
      expect(screen.getByLabelText("Método")).toHaveValue("pago_movil");
      expect(screen.getByLabelText("Tipo")).toHaveValue("entrada");
    });

    it("sin parametros no envia filtros y un valor invalido de la URL cae a su default", async () => {
      openAt("method=bitcoin&from=2026-02-31&direction=todo");
      renderPage();

      await screen.findAllByRole("link", { name: "V-000002" });

      expect(lastListRequest()).toEqual({ limit: "10", skip: "0" });
      expect(screen.getByLabelText("Método")).toHaveValue("all");
      expect(screen.getByLabelText("Desde")).toHaveValue("");
    });

    it("cambiar metodo, tipo y fechas escribe la URL, vuelve a la pagina 1 y pide la lista filtrada", async () => {
      const user = userEvent.setup();

      listTotal = 25;
      openAt("page=2");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      await user.selectOptions(screen.getByLabelText("Método"), "efectivo_usd");

      expect(urlParams()).toEqual({ method: "efectivo_usd" });
      await waitFor(() =>
        expect(lastListRequest()).toEqual({ limit: "10", method: "efectivo_usd", skip: "0" }),
      );

      await user.selectOptions(screen.getByLabelText("Tipo"), "salida");
      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-06" } });

      expect(urlParams()).toEqual({
        direction: "salida",
        from: "2026-10-01",
        method: "efectivo_usd",
        to: "2026-10-06",
      });
      await waitFor(() =>
        expect(lastListRequest()).toEqual({
          direction: "salida",
          from: "2026-10-01",
          limit: "10",
          method: "efectivo_usd",
          skip: "0",
          to: "2026-10-06",
        }),
      );
    });

    it("ofrece todos los metodos con etiqueta en español", async () => {
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      expect(
        within(screen.getByLabelText("Método"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual([
        "Todos los métodos",
        "Efectivo USD",
        "Efectivo VES",
        "Pago móvil",
        "Punto de venta",
        "Transferencia",
      ]);
    });

    it("un rango invertido no se puede dejar: el otro extremo acompaña a la fecha movida", async () => {
      openAt("from=2026-10-01&to=2026-10-05");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-08" } });
      expect(urlParams()).toEqual({ from: "2026-10-08", to: "2026-10-08" });

      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-02" } });
      expect(urlParams()).toEqual({ from: "2026-10-02", to: "2026-10-02" });
    });

    it("una pagina mas alla de la ultima cae en la ultima valida y la URL lo refleja", async () => {
      listTotal = 25;
      openAt("page=99&method=efectivo_ves");
      renderPage();

      await waitFor(() => expect(urlParams()).toEqual({ method: "efectivo_ves", page: "3" }));
      await waitFor(() =>
        expect(lastListRequest()).toEqual({ limit: "10", method: "efectivo_ves", skip: "20" }),
      );
      expect(await screen.findAllByRole("link", { name: "V-000002" })).not.toHaveLength(0);
    });

    it("con una sola pagina, ?page=99 vuelve a la primera y no deja «Mostrando 981 a 7»", async () => {
      listItems = Array.from({ length: 7 }, (_, index) => payment(`pay-00${index + 1}`));
      openAt("page=99");
      renderPage();

      await waitFor(() => expect(urlParams()).toEqual({}));
      await waitFor(() => expect(lastListRequest()).toEqual({ limit: "10", skip: "0" }));
      expect(await screen.findAllByRole("link", { name: "V-000002" })).toHaveLength(7);
      expect(screen.queryByText(/981/)).not.toBeInTheDocument();
      expect(screen.queryByText("No hay pagos para mostrar")).not.toBeInTheDocument();
    });

    it("sin pagos, una pagina fuera de rango vuelve a la primera", async () => {
      listItems = [];
      openAt("page=4&method=pago_movil");
      renderPage();

      await waitFor(() => expect(urlParams()).toEqual({ method: "pago_movil" }));
      expect(await screen.findByText("No hay pagos para mostrar")).toBeInTheDocument();
    });

    it("una pagina valida no se toca", async () => {
      listTotal = 25;
      openAt("page=3");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });
      await settle();

      expect(urlParams()).toEqual({ page: "3" });
      expect(listRequests()).toEqual([{ limit: "10", skip: "20" }]);
    });

    it("la exportacion recibe los textos humanos de los chips, nunca los ids", async () => {
      openAt("saleId=sale-002&contactId=cont-customer");
      renderPage();
      await filtersPanel().findByText("Venta V-000002");

      expect(JSON.parse(screen.getByTestId("export-filter-labels").textContent ?? "null")).toEqual([
        "Venta V-000002",
        "Contacto: Cliente Demo",
      ]);
    });

    it("la exportacion omite el filtro cuyo texto aun no se conoce (ni id ni texto neutro)", async () => {
      listItems = [];
      openAt("saleId=sale-999&contactId=cont-999");
      renderPage();
      await filtersPanel().findByText("Venta seleccionada");
      await waitFor(() => expect(requestedPaths()).toContain("/api/contacts/cont-999"));
      await settle();

      expect(JSON.parse(screen.getByTestId("export-filter-labels").textContent ?? "null")).toEqual(
        [],
      );
    });

    it("la exportacion recibe los mismos filtros que la lista", async () => {
      openAt("method=transferencia&from=2026-10-01&to=2026-10-06&saleId=sale-002");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      expect(JSON.parse(screen.getByTestId("export-filters").textContent ?? "{}")).toEqual({
        from: "2026-10-01",
        method: "transferencia",
        saleId: "sale-002",
        to: "2026-10-06",
      });
    });
  });

  describe("PAG-05 · sin campos de ID: enlaces profundos como chips", () => {
    it("no hay ningun campo donde teclear un contacto, una venta o una compra", async () => {
      openAt("saleId=sale-002&contactId=cont-customer");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Contacto")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Venta")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Compra")).not.toBeInTheDocument();
    });

    it("muestra la venta y el contacto de la URL con texto humano, sin pedir nada mas", async () => {
      openAt("saleId=sale-002&contactId=cont-customer");
      renderPage();

      expect(await filtersPanel().findByText("Venta V-000002")).toBeInTheDocument();
      expect(filtersPanel().getByText("Contacto: Cliente Demo")).toBeInTheDocument();
      expect(lastListRequest()).toEqual({
        contactId: "cont-customer",
        limit: "10",
        saleId: "sale-002",
        skip: "0",
      });
      expect(listRequestedPaths().every((path) => path === "/api/payments")).toBe(true);
      expect(filtersPanel().queryByText(/sale-002|cont-customer/)).not.toBeInTheDocument();
    });

    it("si la lista viene vacia resuelve el numero de compra y el contacto con sus detalles; mientras, texto neutro", async () => {
      let releasePurchase: (response: Response) => void = () => undefined;

      listItems = [];
      detailResponses["/api/purchases/purchase-001"] = () =>
        new Promise<Response>((resolve) => {
          releasePurchase = resolve;
        });
      detailResponses["/api/contacts/cont-supplier"] = async () =>
        jsonResponse({ data: { id: "cont-supplier", name: "Proveedor Demo" } });
      openAt("purchaseId=purchase-001&contactId=cont-supplier");
      renderPage();

      expect(await filtersPanel().findByText("Contacto: Proveedor Demo")).toBeInTheDocument();
      expect(filtersPanel().getByText("Compra seleccionada")).toBeInTheDocument();
      expect(filtersPanel().queryByText(/purchase-001|cont-supplier/)).not.toBeInTheDocument();

      await act(async () => {
        releasePurchase(jsonResponse({ data: { id: "purchase-001", purchaseNumber: "C-001" } }));
      });

      expect(await filtersPanel().findByText("Compra #C-001")).toBeInTheDocument();
    });

    it("si el detalle no se puede leer el chip se queda con el texto neutro, nunca con el id", async () => {
      listItems = [];
      openAt("saleId=sale-999&contactId=cont-999");
      renderPage();

      expect(await filtersPanel().findByText("Venta seleccionada")).toBeInTheDocument();
      await waitFor(() => expect(requestedPaths()).toContain("/api/contacts/cont-999"));
      await settle();
      expect(filtersPanel().getByText("Contacto seleccionado")).toBeInTheDocument();
      expect(filtersPanel().queryByText(/sale-999|cont-999/)).not.toBeInTheDocument();
    });

    it("quitar un chip borra ese parametro de la URL y conserva el resto", async () => {
      const user = userEvent.setup();

      openAt("saleId=sale-002&contactId=cont-customer&method=efectivo_ves");
      renderPage();

      await user.click(
        await filtersPanel().findByRole("button", { name: "Quitar filtro Venta V-000002" }),
      );

      expect(urlParams()).toEqual({ contactId: "cont-customer", method: "efectivo_ves" });
      expect(filtersPanel().queryByText("Venta V-000002")).not.toBeInTheDocument();
      await waitFor(() =>
        expect(lastListRequest()).toEqual({
          contactId: "cont-customer",
          limit: "10",
          method: "efectivo_ves",
          skip: "0",
        }),
      );
    });

    it("«Limpiar filtros» solo aparece con algun filtro activo y los quita todos sin tocar el tamaño de pagina", async () => {
      const user = userEvent.setup();

      openAt("limit=25");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Método"), "pago_movil");
      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
      act(() => {
        window.history.replaceState(
          null,
          "",
          "/payments?limit=25&method=pago_movil&from=2026-10-01&saleId=sale-002&page=2",
        );
      });

      await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));

      expect(urlParams()).toEqual({ limit: "25" });
      expect(screen.getByLabelText("Método")).toHaveValue("all");
      expect(screen.getByLabelText("Desde")).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
      await waitFor(() => expect(lastListRequest()).toEqual({ limit: "25", skip: "0" }));
    });
  });

  describe("PAG-05 · columna Documento", () => {
    it("enlaza el numero de venta o compra a su detalle con la URL exacta de la lista en returnTo", async () => {
      listItems = [
        payment("pay-001"),
        payment("pay-002", {
          direction: "salida",
          purchaseId: "purchase-001",
          relatedDocument: { href: "/purchases/purchase-001", label: "#C-001" },
          saleId: undefined,
        }),
      ];
      listTotal = 25;
      openAt("method=efectivo_ves&from=2026-10-01&page=2");
      renderPage();

      // La lista reescribe sus parametros en el orden del schema: es la misma URL.
      const returnTo = encodeURIComponent("/payments?from=2026-10-01&method=efectivo_ves&page=2");

      expect(await screen.findByRole("link", { name: "V-000002" })).toHaveAttribute(
        "href",
        `/sales/sale-002?returnTo=${returnTo}`,
      );
      expect(screen.getByRole("link", { name: "#C-001" })).toHaveAttribute(
        "href",
        `/purchases/purchase-001?returnTo=${returnTo}`,
      );
    });

    it("el returnTo sigue a la URL cuando cambia un filtro", async () => {
      const user = userEvent.setup();

      listItems = [payment("pay-001")];
      renderPage();
      expect(await screen.findByRole("link", { name: "V-000002" })).toHaveAttribute(
        "href",
        `/sales/sale-002?returnTo=${encodeURIComponent("/payments")}`,
      );

      await user.selectOptions(screen.getByLabelText("Método"), "efectivo_ves");

      await waitFor(() =>
        expect(screen.getByRole("link", { name: "V-000002" })).toHaveAttribute(
          "href",
          `/sales/sale-002?returnTo=${encodeURIComponent("/payments?method=efectivo_ves")}`,
        ),
      );
    });

    it("un pago sin numero de documento enlaza con «Venta», no con el id", async () => {
      listItems = [payment("pay-001", { relatedDocument: undefined })];
      renderPage();

      expect(await screen.findByRole("link", { name: "Venta" })).toHaveAttribute(
        "href",
        `/sales/sale-002?returnTo=${encodeURIComponent("/payments")}`,
      );
      expect(screen.queryByText("sale-002")).not.toBeInTheDocument();
    });

    it("las cabeceras son «Comprobante» y «Documento»: ninguna se llama ID", async () => {
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);

      expect(headers).toEqual(expect.arrayContaining(["Comprobante", "Documento"]));
      expect(headers.some((header) => /\bID\b/i.test(header ?? ""))).toBe(false);
      expect(headers).not.toContain("Referencia");
    });

    it("«Ver comprobante» abre el detalle del pago con la URL exacta de la lista en returnTo", async () => {
      const user = userEvent.setup();

      listTotal = 25;
      openAt("method=efectivo_ves&from=2026-10-01&page=2");
      renderPage();
      await user.click((await screen.findAllByRole("button", { name: /acciones/i }))[0]);

      expect(await screen.findByRole("menuitem", { name: "Ver comprobante" })).toHaveAttribute(
        "href",
        `/payments/pay-001?returnTo=${encodeURIComponent(
          "/payments?from=2026-10-01&method=efectivo_ves&page=2",
        )}`,
      );
    });

    it("la columna «Comprobante» es tan ancha como su cabecera: no pisa «Contacto»", async () => {
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      const header = screen.getByRole("columnheader", { name: "Comprobante" });
      const widthRem = Number(/(?:^|\s)w-\[([\d.]+)rem\]/.exec(header.className)?.[1]);

      // «COMPROBANTE» (12 px, mayusculas, tracking-wider) mide 101 px y la celda
      // lleva 16 px de relleno a cada lado.
      expect(widthRem * 16).toBeGreaterThanOrEqual(101 + 2 * 16);
      expect(header).toHaveClass("whitespace-nowrap");
    });

    it("en la tarjeta movil el documento tambien se ve y enlaza con returnTo", async () => {
      isMobile = true;
      listItems = [payment("pay-001")];
      openAt("method=efectivo_ves");
      renderPage();

      const link = await screen.findByRole("link", { name: "V-000002" });

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByText("Documento")).toBeInTheDocument();
      expect(link).toHaveAttribute(
        "href",
        `/sales/sale-002?returnTo=${encodeURIComponent("/payments?method=efectivo_ves")}`,
      );
    });
  });

  describe("PAG-05 · vendedor", () => {
    beforeEach(() => {
      mockAuth.role = "vendedor";
      mockAuth.permissions = ["payments.view", "sales.create"];
    });

    it("solo pide entradas y solo ofrece «Entrada» como tipo", async () => {
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      expect(lastListRequest()).toEqual({ direction: "entrada", limit: "10", skip: "0" });
      expect(
        within(screen.getByLabelText("Tipo"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["Entrada"]);
      expect(screen.getByLabelText("Tipo")).toHaveValue("entrada");
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("ignora purchaseId y direction=salida de la URL: ni los envia ni los muestra", async () => {
      openAt("purchaseId=purchase-001&direction=salida&method=efectivo_ves");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      expect(listRequests()).toEqual([
        { direction: "entrada", limit: "10", method: "efectivo_ves", skip: "0" },
      ]);
      expect(filtersPanel().queryByText(/Compra/)).not.toBeInTheDocument();
      expect(requestedPaths()).not.toContain("/api/purchases/purchase-001");
      expect(screen.getByLabelText("Método")).toHaveValue("efectivo_ves");
    });
  });

  describe("DET-06d · volver con filtros y scroll", () => {
    /** Posición guardada para `url` y espía del `scrollTo` de la ventana (sin `<main>`, hace scroll ella). */
    function rememberScroll(url: string, top: number) {
      const scrollTo = jest.fn();

      Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
      window.sessionStorage.setItem(SCROLL_POSITIONS_STORAGE_KEY, JSON.stringify([[url, top]]));

      return scrollTo;
    }

    afterEach(() => {
      window.sessionStorage.clear();
    });

    it("restaura el scroll guardado de esa URL exacta cuando las filas ya estan pintadas", async () => {
      const scrollTo = rememberScroll("/payments?method=efectivo_ves&page=2", 640);

      listTotal = 25;
      openAt("method=efectivo_ves&page=2");
      renderPage();

      expect(scrollTo).not.toHaveBeenCalled();

      await screen.findAllByRole("link", { name: "V-000002" });

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 640);
    });

    it("sin posicion guardada para esa URL no mueve el scroll", async () => {
      const scrollTo = rememberScroll("/payments?method=efectivo_ves&page=2", 640);

      openAt("method=efectivo_ves");
      renderPage();
      await screen.findAllByRole("link", { name: "V-000002" });

      expect(scrollTo).not.toHaveBeenCalled();
    });

    it("abierta con filtros y enlace profundo, la unica peticion de la lista ya los lleva", async () => {
      listTotal = 60;
      openAt(
        "direction=salida&method=pago_movil&purchaseId=purchase-001&contactId=c-1&from=2026-10-01&to=2026-10-06&page=2",
      );
      renderPage();

      await screen.findAllByRole("link", { name: "V-000002" });
      await settle();

      expect(listRequests()).toEqual([
        {
          contactId: "c-1",
          direction: "salida",
          from: "2026-10-01",
          limit: "10",
          method: "pago_movil",
          purchaseId: "purchase-001",
          skip: "10",
          to: "2026-10-06",
        },
      ]);
    });
  });
});
