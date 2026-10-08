/**
 * PAG-07 · `/payments` avisa de las ventas en `pendiente_pago` abandonadas (retienen
 * stock sin vencimiento) encima de los filtros, con acceso a «Cobrar» y al detalle.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigation = { query: "" };
const mockAuth: { permissions: string[] | "all"; role: string } = {
  permissions: "all",
  role: "admin",
};

jest.mock("next/navigation", () => ({
  usePathname: () => "/payments",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNavigation.query),
}));
jest.mock("../../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) =>
      mockAuth.permissions === "all" || mockAuth.permissions.includes(permission),
    role: mockAuth.role,
  }),
}));
jest.mock("./components/PaymentsExportActions", () => ({
  PaymentsExportActions: () => null,
}));

import { PaymentsListPage } from "./page";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STALE_SALE = {
  contact: { id: "cont-customer", name: "Maria Perez" },
  createdAt: new Date(Date.now() - 12 * MS_PER_DAY).toISOString(),
  id: "sale-002",
  number: "F-0002",
  paidVes: 3000,
  pendingRef: 16.62,
  pendingVes: 8475,
  refRateVes: 510,
  status: "pendiente_pago",
  totalRef: 22.5,
  totalVes: 11475,
  type: "sale",
};

function listedPayment(id: string) {
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
    relatedDocument: { href: "/sales/sale-009", label: "V-000009" },
    saleId: "sale-009",
    status: "activo",
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

describe("PaymentsListPage · ventas pendientes de pago abandonadas (PAG-07)", () => {
  const fetchMock = jest.fn();
  const originalMatchMedia = window.matchMedia;
  let staleSales: (typeof STALE_SALE)[];
  let staleSalesFail: boolean;

  beforeEach(() => {
    mockAuth.permissions = "all";
    mockAuth.role = "admin";
    mockNavigation.query = "";
    window.history.replaceState(null, "", "/payments");
    staleSales = [STALE_SALE];
    staleSalesFail = false;
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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const [path] = String(url).split("?");

      if (init?.method === "POST") {
        // El cobro salda la venta: deja de estar pendiente.
        staleSales = [];

        return jsonResponse(
          {
            data: {
              ...listedPayment("pay-new"),
              pendingBalanceVes: 0,
              relatedDocument: { href: "/sales/sale-002", label: "F-0002" },
              saleId: "sale-002",
            },
          },
          201,
        );
      }

      if (path === "/api/payments") {
        return jsonResponse({
          data: { items: [listedPayment("pay-001")], limit: 10, skip: 0, total: 1 },
        });
      }

      if (path === "/api/payments/open-documents") {
        if (staleSalesFail) {
          return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Fallo interno." } }, 500);
        }

        return jsonResponse({
          data: {
            items: staleSales,
            limit: 50,
            skip: 0,
            total: staleSales.length,
            totals: {
              count: staleSales.length,
              pendingRef: staleSales.length ? 16.62 : 0,
              pendingVes: staleSales.length ? 8475 : 0,
              truncated: false,
            },
          },
        });
      }

      if (path === "/api/settings/payment-methods") {
        return jsonResponse({ data: { enabledPaymentMethods: ["efectivo_ves", "pago_movil"] } });
      }

      if (path === "/api/sales/sale-002") {
        return jsonResponse({
          data: {
            customer: { id: "cont-customer", name: "Maria Perez" },
            id: "sale-002",
            invoiceNumber: "F-0002",
            paidVes: 3000,
            refRateVes: 510,
            totalVes: 11475,
          },
        });
      }

      return jsonResponse({ error: { code: "NOT_FOUND", message: "No encontrado." } }, 404);
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  function staleSalesRequests() {
    return fetchMock.mock.calls
      .map(([url]) => String(url).split("?"))
      .filter(([path]) => path === "/api/payments/open-documents")
      .map(([, search]) => new URLSearchParams(search));
  }

  function posts() {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      .map(([url, init]) => ({
        body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
        url: String(url),
      }));
  }

  async function renderPage() {
    // Sin caducidad: lo que se vuelva a pedir es porque el cobro lo invalidó.
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsListPage />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Pagos" });
    await screen.findAllByText("Cliente Demo");

    return userEvent.setup();
  }

  function findNotice() {
    return screen.findByRole("region", { name: "Ventas pendientes de pago" });
  }

  function queryNotice() {
    return screen.queryByRole("region", { name: "Ventas pendientes de pago" });
  }

  it("pinta el aviso encima de los filtros y pide ventas de 7 días o más", async () => {
    await renderPage();

    const notice = await findNotice();
    const filters = screen.getByLabelText("Filtros de pagos");

    expect(
      within(notice).getByText("1 venta lleva 7 días o más pendiente de pago"),
    ).toBeInTheDocument();
    expect(
      notice.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const requests = staleSalesRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0].get("type")).toBe("sale");
    expect(requests[0].get("olderThanDays")).toBe("7");
  });

  it("«Ver venta» lleva al detalle con la URL exacta de la lista (filtros incluidos) como returnTo", async () => {
    const query = "method=transferencia&from=2026-09-01";

    window.history.replaceState(null, "", `/payments?${query}`);
    mockNavigation.query = query;

    const user = await renderPage();
    const notice = await findNotice();

    await user.click(within(notice).getByRole("button", { name: "Ver la venta" }));

    const link = within(notice).getByRole("link", { name: "Ver venta F-0002" });
    const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
    const returnTo = new URL(href.searchParams.get("returnTo") ?? "", "http://localhost");

    expect(href.pathname).toBe("/sales/sale-002");
    expect(returnTo.pathname).toBe("/payments");
    expect(returnTo.searchParams.get("method")).toBe("transferencia");
    expect(returnTo.searchParams.get("from")).toBe("2026-09-01");
    expect(notice.textContent).not.toMatch(/sale-002|cont-customer/);
  });

  it("«Cobrar» abre el modal de cobro de esa venta y, al registrar, el aviso desaparece sin recargar", async () => {
    const user = await renderPage();
    const notice = await findNotice();

    await user.click(within(notice).getByRole("button", { name: "Ver la venta" }));
    await user.click(within(notice).getByRole("button", { name: "Cobrar venta F-0002" }));

    const modal = await screen.findByRole("dialog", { name: "Cobrar saldo" });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await within(modal).findByText("Venta F-0002 de Maria Perez.")).toBeInTheDocument();

    await user.click(within(modal).getByRole("button", { name: "Completar saldo" }));
    await user.click(within(modal).getByRole("button", { name: "Registrar cobro" }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toMatchObject({ amount: 8475, saleId: "sale-002" });

    // La invalidación del cobro vuelve a pedir las ventas abandonadas.
    await waitFor(() => expect(staleSalesRequests()).toHaveLength(2));
    await waitFor(() => expect(queryNotice()).not.toBeInTheDocument());
  });

  it("sin payments.manage ni sales.create no pide las ventas ni pinta el aviso", async () => {
    mockAuth.permissions = ["payments.view"];
    mockAuth.role = "vendedor";
    await renderPage();

    expect(staleSalesRequests()).toHaveLength(0);
    expect(queryNotice()).not.toBeInTheDocument();
  });

  it("si la consulta de ventas abandonadas falla, la lista de pagos sigue igual y no hay aviso ni error", async () => {
    staleSalesFail = true;
    await renderPage();

    await waitFor(() => expect(staleSalesRequests()).toHaveLength(1));
    expect(queryNotice()).not.toBeInTheDocument();
    expect(screen.queryByText("Fallo interno.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Cliente Demo").length).toBeGreaterThan(0);
  });
});
