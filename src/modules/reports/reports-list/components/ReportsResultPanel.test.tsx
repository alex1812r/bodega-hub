import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as reportsHooks from "../../hooks/useReports";
import { reportCatalog, type ReportDefinition } from "../config/reportCatalog";
import { ReportsResultPanel } from "./ReportsResultPanel";

jest.mock("../../hooks/useReports", () => {
  const queryResult = () => ({
    data: { items: [], limit: 10, skip: 0, total: 35 },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });

  return {
    ...jest.requireActual("../../hooks/useReports"),
    useCustomerPurchasesReport: jest.fn(queryResult),
    useDailySalesReport: jest.fn(queryResult),
    useGrossProfitReport: jest.fn(queryResult),
    useLowStockReport: jest.fn(queryResult),
    useProductProfitabilityReport: jest.fn(queryResult),
    usePurchasesReport: jest.fn(queryResult),
    useStockCardReport: jest.fn(queryResult),
    useSupplierPurchasesReport: jest.fn(queryResult),
    useTopCustomersReport: jest.fn(queryResult),
    useTopProductsReport: jest.fn(queryResult),
  };
});

const hooks = jest.mocked(reportsHooks);
const scope: reportsHooks.ReportRequestScope = {
  enabled: true,
  pathPrefix: "/api/platform/reports",
  storeScope: "all",
};
const dateFilters = { from: "2026-01-01", to: "2026-01-31" };
const purchasesFilters = { from: "2026-02-01", supplierId: "sup-1", to: "2026-02-28" };
const stockCardFilters = { productId: "prod-1" };

function getReport(id: ReportDefinition["id"]) {
  const report = reportCatalog.find((item) => item.id === id);
  if (!report) {
    throw new Error(`Reporte ${id} no encontrado`);
  }
  return report;
}

function panel(id: ReportDefinition["id"]) {
  return (
    <ReportsResultPanel
      dateFilters={dateFilters}
      purchasesFilters={purchasesFilters}
      report={getReport(id)}
      scope={scope}
      stockCardFilters={stockCardFilters}
    />
  );
}

describe("ReportsResultPanel", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.clearAllMocks();
    // Escritorio: la paginacion muestra los botones de pagina.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: true,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it.each([
    ["daily-sales", "useDailySalesReport", {}],
    ["gross-profit", "useGrossProfitReport", {}],
    ["product-profitability", "useProductProfitabilityReport", {}],
    ["low-stock", "useLowStockReport", {}],
    ["customer-purchases", "useCustomerPurchasesReport", {}],
    ["supplier-purchases", "useSupplierPurchasesReport", {}],
    ["stock-card", "useStockCardReport", stockCardFilters],
    ["top-products", "useTopProductsReport", dateFilters],
    ["top-customers", "useTopCustomersReport", dateFilters],
    ["purchases", "usePurchasesReport", purchasesFilters],
  ] as const)("queries %s with its filters, first page and scope", (id, hookName, filters) => {
    render(panel(id));

    expect(hooks[hookName]).toHaveBeenLastCalledWith({ ...filters, limit: 10, skip: 0 }, scope);
    expect(screen.getByText(`Resultados: ${getReport(id).name}`)).toBeVisible();
    expect(screen.getByText("Mostrando 1-10 de 35 registros")).toBeVisible();
  });

  it("keeps the current page when switching between reports with the same reset deps", async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel("daily-sales"));

    await user.click(screen.getByRole("button", { name: "Ir a pagina 2" }));
    expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith({ limit: 10, skip: 10 }, scope);

    rerender(panel("gross-profit"));
    expect(hooks.useGrossProfitReport).toHaveBeenLastCalledWith({ limit: 10, skip: 10 }, scope);
  });

  it("goes back to the first page when the reset deps change", async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel("daily-sales"));

    await user.click(screen.getByRole("button", { name: "Ir a pagina 2" }));
    rerender(panel("top-products"));

    expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith(
      { ...dateFilters, limit: 10, skip: 0 },
      scope,
    );
  });
});
