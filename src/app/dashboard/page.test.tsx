/**
 * PRO-F5 · la tarjeta "Por revisar" (PRO-11) va montada en el dashboard de la
 * tienda, encima de "Bajo stock", y cuando no pinta nada la columna queda con
 * un único hijo (sin hueco: el `gap` de un flex solo separa hijos presentes).
 */
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

let mockPermissions: string[] = [];

jest.mock("../../shared/auth/usePermission", () => ({
  usePermission: () => ({
    can: (permission: string) => mockPermissions.includes(permission),
    isLoading: false,
    permissions: mockPermissions,
    role: "admin",
  }),
}));
jest.mock("../../modules/dashboard/hooks/useDashboardKpiPeriod", () => ({
  useDashboardUrlPeriod: () => ({
    comparisonLabel: "vs ayer",
    currentFilters: {},
    kpiPeriodLabel: "Hoy",
    preset: "hoy",
    previousFilters: null,
    range: { from: "2026-05-18", preset: "today", to: "2026-05-18" },
    setRange: jest.fn(),
    today: "2026-05-18",
  }),
}));
jest.mock("../../modules/dashboard/hooks/useDashboard", () => {
  const query = { data: { lowStockCount: 2 }, error: null, isFetching: false, isLoading: false, refetch: jest.fn() };

  return { useDashboardMetrics: () => query, useDashboardSummary: () => query };
});
jest.mock("../../modules/dashboard/components/DashboardKpiCardsGrid", () => ({
  DashboardKpiCardsGrid: () => null,
}));
jest.mock("../../modules/dashboard/components/DashboardPaymentMethodsCard", () => ({
  DashboardPaymentMethodsCard: () => null,
}));
jest.mock("../../modules/dashboard/components/DashboardDailyCloseCard", () => ({
  DashboardDailyCloseCard: () => null,
}));
jest.mock("../../modules/dashboard/components/DashboardPeriodField", () => ({
  DashboardPeriodField: () => null,
}));
jest.mock("../../modules/dashboard/components/DashboardSalesChartCard", () => ({
  DashboardSalesChartCard: () => null,
}));
jest.mock("../../modules/dashboard/components/DashboardRecentSalesCard", () => ({
  DashboardRecentSalesCard: () => null,
}));
jest.mock("../../modules/dashboard/components/DashboardLowStockCard", () => ({
  DashboardLowStockCard: ({ totalCount }: { totalCount: number }) => (
    <div data-testid="low-stock">Bajo stock: {totalCount}</div>
  ),
}));

import DashboardPage from "./page";

function jsonResponse(payload: unknown, status = 200) {
  return {
    headers: { get: () => "application/json" },
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe("DashboardPage · tarjeta Por revisar (PRO-F5)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    mockPermissions = ["products.view"];
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>,
    );
  }

  /** La columna lateral: el hijo directo de la celda del grid. */
  function asideColumn() {
    const lowStockSlot = screen.getByTestId("low-stock").parentElement;
    const column = lowStockSlot?.parentElement;

    if (!lowStockSlot || !column) {
      throw new Error("Sin columna lateral");
    }

    return { column, lowStockSlot };
  }

  it("monta la tarjeta encima de Bajo stock, con enlace a la lista filtrada", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { total: 3 } }));
    renderPage();

    const link = await screen.findByRole("link", { name: /3 productos bajaron de ganancia.*Revisar/ });
    const { column, lowStockSlot } = asideColumn();

    expect(link).toHaveAttribute("href", "/products?review=1");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/products/price-review/summary"]);
    expect(Array.from(column.children)).toEqual([link, lowStockSlot]);
    expect(column).toHaveClass("flex", "h-full", "flex-col", "gap-6");
    expect(screen.getByTestId("low-stock")).toHaveTextContent("Bajo stock: 2");
  });

  it.each([
    ["con 0 productos", () => jsonResponse({ data: { total: 0 } })],
    ["con un 403", () => jsonResponse({ error: { code: "FORBIDDEN", message: "Sin permiso." } }, 403)],
    ["con un 500", () => jsonResponse({ error: { code: "ERROR", message: "No disponible." } }, 500)],
    ["mientras carga", () => new Promise<Response>(() => undefined)],
  ])("%s la columna solo tiene Bajo stock, a toda la altura", async (_name, respond) => {
    fetchMock.mockImplementation(respond);
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Deja resolver la consulta antes de mirar la estructura final.
    await waitFor(() => expect(fetchMock.mock.results[0].type).toBe("return"));
    await Promise.resolve();

    const { column, lowStockSlot } = asideColumn();

    expect(screen.queryByRole("link", { name: /Revisar/ })).not.toBeInTheDocument();
    expect(Array.from(column.children)).toEqual([lowStockSlot]);
    expect(lowStockSlot).toHaveClass("min-h-0", "flex-1");
    // La celda del grid no cambia: sigue siendo la de `DashboardContentGrid`.
    expect(column.parentElement).toHaveClass("min-w-0", "lg:col-span-1");
  });

  it("sin products.view ni consulta ni pinta la tarjeta", () => {
    mockPermissions = [];
    renderPage();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(Array.from(asideColumn().column.children)).toHaveLength(1);
  });

  it("el dashboard de plataforma no la monta", () => {
    const platformPage = readFileSync(
      join(process.cwd(), "src/modules/platform/dashboard/page.tsx"),
      "utf8",
    );

    expect(platformPage).not.toMatch(/PriceReview|price-review/);
  });
});

describe("DashboardPage · tarjeta Cuentas por cobrar vencidas (REP-09b)", () => {
  const fetchMock = jest.fn();
  const AGING_PATH = "/api/reports/receivables-aging";

  function agingSummary(overdue: number, dueSoon: number) {
    return {
      items: [],
      limit: 10,
      skip: 0,
      summary: {
        buckets: [
          { bucket: "0-7", documentsCount: 4, pendingRef: 40, pendingVes: 20000 },
          { bucket: "8-30", documentsCount: dueSoon, pendingRef: dueSoon * 5, pendingVes: dueSoon * 2500 },
          { bucket: "30+", documentsCount: overdue, pendingRef: overdue * 10, pendingVes: overdue * 5000 },
        ],
        totals: { documentsCount: 4 + dueSoon + overdue, pendingRef: 0, pendingVes: 0 },
      },
      total: 0,
    };
  }

  function respondWith(overdue: number, dueSoon: number, priceReviewTotal = 0) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).startsWith(AGING_PATH)
        ? jsonResponse({ data: agingSummary(overdue, dueSoon) })
        : jsonResponse({ data: { total: priceReviewTotal } }),
    );
  }

  function agingRequests() {
    return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(AGING_PATH));
  }

  beforeEach(() => {
    mockPermissions = ["products.view", "reports.view", "payments.manage"];
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>,
    );
  }

  function asideChildren() {
    const lowStockSlot = screen.getByTestId("low-stock").parentElement;

    if (!lowStockSlot?.parentElement) {
      throw new Error("Sin columna lateral");
    }

    return { children: Array.from(lowStockSlot.parentElement.children), lowStockSlot };
  }

  it("va después de Por revisar y antes de Bajo stock, con una sola petición del resumen", async () => {
    respondWith(2, 3, 3);
    renderPage();

    const overdue = await screen.findByRole("link", { name: /Cuentas por cobrar vencidas/ });
    const priceReview = await screen.findByRole("link", { name: /productos bajaron de ganancia/ });
    const { children, lowStockSlot } = asideChildren();

    expect(children).toEqual([priceReview, overdue, lowStockSlot]);
    expect(overdue).toHaveAttribute("href", "/reports?report=receivables-aging&bucket=30%2B");
    expect(agingRequests()).toEqual(["/api/reports/receivables-aging?limit=10"]);
  });

  it("sin documentos de más de 7 días la columna queda solo con Bajo stock, sin hueco", async () => {
    respondWith(0, 0);
    renderPage();

    await waitFor(() => expect(agingRequests()).toHaveLength(1));
    await waitFor(() => expect(fetchMock.mock.results.every((result) => result.type === "return")).toBe(true));
    await Promise.resolve();

    const { children, lowStockSlot } = asideChildren();

    expect(screen.queryByText("Cuentas por cobrar vencidas")).not.toBeInTheDocument();
    expect(children).toEqual([lowStockSlot]);
    expect(lowStockSlot).toHaveClass("min-h-0", "flex-1");
  });

  it.each([
    ["sin reports.view", ["products.view", "sales.create", "payments.manage"]],
    ["con reports.view pero sin payments.manage ni sales.create", ["products.view", "reports.view"]],
  ])("%s ni la pide ni la monta", async (_name, permissions) => {
    mockPermissions = permissions;
    respondWith(2, 3);
    renderPage();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await Promise.resolve();

    expect(agingRequests()).toEqual([]);
    expect(screen.queryByText("Cuentas por cobrar vencidas")).not.toBeInTheDocument();
    expect(asideChildren().children).toHaveLength(1);
  });

  it("el dashboard de plataforma no la monta", () => {
    const platformPage = readFileSync(
      join(process.cwd(), "src/modules/platform/dashboard/page.tsx"),
      "utf8",
    );

    expect(platformPage).not.toMatch(/OverdueReceivables|receivables-aging/);
  });
});
