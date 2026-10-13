/**
 * Errores de las consultas propias de la página del dashboard (resumen y
 * métricas).
 *
 * - REP-F9: el error no se enseña crudo; solo un error de negocio muestra su
 *   mensaje.
 * - REP-F10 (N-12): un fallo del resumen ya no sustituye todo el dashboard por
 *   un único error: se queda en las tarjetas que dependen del resumen y el
 *   resto (mix de pagos, cierre, gráfico, ventas recientes, columna de avisos)
 *   sigue montado.
 * - REP-F10 (N-04): un fallo de las métricas no pinta ceros como si fueran datos.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientApiError } from "../../shared/api/apiFetch";

type MockQuery = { data?: unknown; error?: Error | null };

let mockSummary: MockQuery = {};
let mockMetrics: MockQuery = {};
const mockRefetchSummary = jest.fn();
const mockRefetchMetrics = jest.fn();

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
jest.mock("../../modules/dashboard/hooks/useDashboard", () => ({
  useDashboardMetrics: () => ({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: mockRefetchMetrics,
    ...mockMetrics,
  }),
  useDashboardSummary: () => ({
    data: undefined,
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: mockRefetchSummary,
    ...mockSummary,
  }),
}));
jest.mock("../../modules/dashboard/components/DashboardPeriodField", () => ({
  DashboardPeriodField: () => null,
}));
// Cada tarjeta lleva su propia consulta: aquí solo importa que sigan montadas.
jest.mock("../../modules/dashboard/components/DashboardPaymentMethodsCard", () => ({
  DashboardPaymentMethodsCard: () => <div data-testid="card-payment-methods" />,
}));
jest.mock("../../modules/dashboard/components/DashboardDailyCloseCard", () => ({
  DashboardDailyCloseCard: () => <div data-testid="card-daily-close" />,
}));
jest.mock("../../modules/dashboard/components/DashboardSalesChartCard", () => ({
  DashboardSalesChartCard: () => <div data-testid="card-sales-chart" />,
}));
jest.mock("../../modules/dashboard/components/DashboardRecentSalesCard", () => ({
  DashboardRecentSalesCard: () => <div data-testid="card-recent-sales" />,
}));
jest.mock("../../modules/dashboard/components/DashboardOverdueReceivablesCard", () => ({
  DashboardOverdueReceivablesCard: () => <div data-testid="card-overdue" />,
}));
jest.mock("../../modules/dashboard/components/DashboardLowStockCard", () => ({
  DashboardLowStockCard: ({ totalCount }: { totalCount: number }) => (
    <div data-testid="card-low-stock">{totalCount}</div>
  ),
}));
jest.mock("../../modules/products/components/price-review/PriceReviewDashboardCard", () => ({
  PriceReviewDashboardCard: () => <div data-testid="card-price-review" />,
}));

import DashboardPage from "./page";

const OTHER_CARDS = [
  "card-payment-methods",
  "card-daily-close",
  "card-sales-chart",
  "card-recent-sales",
  "card-overdue",
  "card-low-stock",
  "card-price-review",
];

const summary = {
  activeCustomers: 4,
  dayOverDayChangePercent: null,
  lowStockCount: 2,
  pendingSalesCount: 0,
  previousDayTotalRef: 0,
  salesCount: 3,
  totalRef: 37.5,
  totalVes: 19500,
};

const metrics = {
  from: "2026-05-18",
  paidVes: 19500,
  pendingVes: 0,
  salesCount: 2,
  to: "2026-05-18",
  totalRef: 37.5,
  totalVes: 19500,
  unitsSold: 5,
};

function expectOtherCardsAlive() {
  for (const testId of OTHER_CARDS) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

describe("DashboardPage · error del resumen principal (REP-F9, REP-F10 N-12)", () => {
  beforeEach(() => {
    mockSummary = {};
    mockMetrics = { data: metrics };
    mockRefetchSummary.mockReset();
    mockRefetchMetrics.mockReset();
  });

  it("un error de negocio enseña su mensaje, deja reintentar y no tumba el resto del dashboard", async () => {
    mockSummary = { error: new ClientApiError(403, "FORBIDDEN", "No tienes permiso para ver el resumen.") };
    render(<DashboardPage />);

    expect(screen.getByText("No pudimos cargar el resumen")).toBeInTheDocument();
    expect(screen.getByText("No tienes permiso para ver el resumen.")).toBeInTheDocument();
    expect(screen.queryByText("No pudimos cargar el dashboard")).not.toBeInTheDocument();
    expectOtherCardsAlive();
    // Las tarjetas de ventas (métricas) siguen con sus cifras.
    expect(screen.getByText("ref 37.50")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mockRefetchSummary).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["un 500 con mensaje interno", new ClientApiError(500, "UNKNOWN_ERROR", 'relation "public.sales" does not exist')],
    ["un fallo de red", new Error('Failed to fetch ["dashboard","summary"]')],
  ])("%s sale con el texto genérico, sin el mensaje interno", (_name, error) => {
    mockSummary = { error };
    render(<DashboardPage />);

    expect(screen.getByText("No pudimos cargar el resumen")).toBeInTheDocument();
    expect(screen.getByText("No pudimos cargar el resumen principal.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Failed to fetch|public\.sales|\["dashboard"/);
    expectOtherCardsAlive();
  });
});

describe("DashboardPage · error de las métricas (REP-F10 N-04)", () => {
  beforeEach(() => {
    mockSummary = { data: summary };
    mockMetrics = {};
    mockRefetchSummary.mockReset();
    mockRefetchMetrics.mockReset();
  });

  it("no pinta «ref 0.00 · 0 ventas»: error en los indicadores, con «Reintentar», y el resto vivo", async () => {
    mockMetrics = { error: new ClientApiError(500, "UNKNOWN_ERROR", "URI too long") };
    render(<DashboardPage />);

    expect(screen.getByText("No pudimos cargar los indicadores de ventas")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ref 0\.00|\b0 ventas|URI too long/);
    expectOtherCardsAlive();
    expect(screen.getByTestId("card-low-stock")).toHaveTextContent("2");

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mockRefetchMetrics).toHaveBeenCalledTimes(1);
    expect(mockRefetchSummary).not.toHaveBeenCalled();
  });

  it("con métricas, pinta sus cifras y ningún error", () => {
    mockMetrics = { data: metrics };
    render(<DashboardPage />);

    expect(screen.getByText("ref 37.50")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });
});
