import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import * as reportsHooks from "../../hooks/useReports";
import { reportCatalog, type ReportDefinition } from "../config/reportCatalog";
import { ReportsResultPanel, type ReportPagination } from "./ReportsResultPanel";

type PageRequest = { limit?: number; skip?: number };

jest.mock("../../hooks/useReports", () => {
  /** Reporte de `total` filas: una página fuera del total llega vacía, como responde el servidor. */
  const pagedReport = (total: number) => (filters: PageRequest = {}) => {
    const limit = filters.limit ?? 10;
    const skip = filters.skip ?? 0;
    const count = Math.max(0, Math.min(limit, total - skip));

    return {
      data: {
        items: Array.from({ length: count }, (_, index) => {
          const id = `fila-${skip + index + 1}`;

          // Los campos que pintan las columnas de cualquiera de los reportes.
          return {
            costRef: 1,
            createdAt: "2026-01-15T12:00:00.000Z",
            currentStock: 1,
            customerId: id,
            grossProfitRef: 1,
            id,
            itemsCount: 1,
            minStock: 2,
            name: `Fila ${skip + index + 1}`,
            paidVes: 1,
            pendingVes: 0,
            productId: `Fila ${skip + index + 1}`,
            purchaseNumber: id,
            purchasesCount: 1,
            quantityDelta: 1,
            revenueRef: 2,
            saleDate: "2026-01-15",
            salesCount: 1,
            sku: id,
            stockAfter: 1,
            supplierId: id,
            totalRef: 1,
            totalVes: skip + index,
            type: "venta",
            unitsSold: 1,
          };
        }),
        limit,
        skip,
        total,
      },
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: jest.fn(),
    };
  };

  return {
    ...jest.requireActual("../../hooks/useReports"),
    useCustomerPurchasesReport: jest.fn(pagedReport(4)),
    useDailySalesReport: jest.fn(pagedReport(35)),
    useGrossProfitReport: jest.fn(pagedReport(35)),
    useLowStockReport: jest.fn(pagedReport(3)),
    useProductProfitabilityReport: jest.fn(pagedReport(5)),
    usePurchasesReport: jest.fn(pagedReport(35)),
    useStockCardReport: jest.fn(pagedReport(35)),
    useSupplierPurchasesReport: jest.fn(pagedReport(2)),
    useTopCustomersReport: jest.fn(pagedReport(35)),
    useTopProductsReport: jest.fn(pagedReport(35)),
  };
});

const hooks = jest.mocked(reportsHooks);
const scope: reportsHooks.ReportRequestScope = {
  enabled: true,
  pathPrefix: "/api/platform/reports",
  storeScope: "all",
};
const range = { from: "2026-01-01", to: "2026-01-31" };
const purchasesFilters = { from: "2026-02-01", supplierId: "sup-1", to: "2026-02-28" };
const stockCardFilters = { productId: "prod-1" };

function getReport(id: ReportDefinition["id"]) {
  const report = reportCatalog.find((item) => item.id === id);
  if (!report) {
    throw new Error(`Reporte ${id} no encontrado`);
  }
  return report;
}

function panel(
  id: ReportDefinition["id"],
  overrides: {
    dateFilters?: reportsHooks.ReportDateRangeFilters;
    pagination?: ReportPagination;
  } = {},
) {
  return (
    <ReportsResultPanel
      dateFilters={overrides.dateFilters ?? range}
      pagination={overrides.pagination}
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
    // Escritorio: la paginación muestra los botones de página.
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
    ["daily-sales", "useDailySalesReport", { ...range, groupBy: "auto" }],
    ["gross-profit", "useGrossProfitReport", { ...range, groupBy: "auto" }],
    ["product-profitability", "useProductProfitabilityReport", {}],
    ["low-stock", "useLowStockReport", {}],
    ["customer-purchases", "useCustomerPurchasesReport", {}],
    ["supplier-purchases", "useSupplierPurchasesReport", {}],
    ["stock-card", "useStockCardReport", stockCardFilters],
    ["top-products", "useTopProductsReport", range],
    ["top-customers", "useTopCustomersReport", range],
    ["purchases", "usePurchasesReport", { ...purchasesFilters, groupBy: "auto" }],
  ] as const)("queries %s with its filters, first page and scope", (id, hookName, filters) => {
    render(panel(id));

    expect(hooks[hookName]).toHaveBeenLastCalledWith({ ...filters, limit: 10, skip: 0 }, scope);
    expect(screen.getByText(`Resultados: ${getReport(id).name}`)).toBeVisible();
  });

  it("passes groupBy and compare only to the series reports", () => {
    const dateFilters = { ...range, compare: true, groupBy: "week" } as const;
    const { rerender } = render(panel("daily-sales", { dateFilters }));

    expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
      { ...range, compare: true, groupBy: "week", limit: 10, skip: 0 },
      scope,
    );

    rerender(panel("purchases", { dateFilters }));
    expect(hooks.usePurchasesReport).toHaveBeenLastCalledWith(
      { ...purchasesFilters, compare: true, groupBy: "week", limit: 10, skip: 0 },
      scope,
    );

    rerender(panel("top-products", { dateFilters }));
    expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith({ ...range, limit: 10, skip: 0 }, scope);
  });

  it("does not ask for the series without a complete range", () => {
    render(panel("daily-sales", { dateFilters: { compare: true, groupBy: "week" } }));

    expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith({ limit: 10, skip: 0 }, scope);
  });

  // D20: la página se arrastraba entre reportes y dejaba "No hay registros" en los cortos.
  it.each(["low-stock", "product-profitability", "customer-purchases", "supplier-purchases"] as const)(
    "starts %s on its first page after leaving page 2 of a long report",
    async (shortReport) => {
      const user = userEvent.setup();
      const { rerender } = render(panel("daily-sales"));

      await user.click(screen.getByRole("button", { name: "Ir a pagina 2" }));
      expect(hooks.useDailySalesReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ skip: 10 }),
        scope,
      );

      rerender(panel(shortReport));

      expect(screen.queryByText("No hay registros para mostrar")).not.toBeInTheDocument();
      expect(screen.getAllByText("Fila 1").length).toBeGreaterThan(0);
    },
  );

  it("goes back to the first page when the range changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel("top-products"));

    await user.click(screen.getByRole("button", { name: "Ir a pagina 2" }));
    expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith({ ...range, limit: 10, skip: 10 }, scope);

    const nextRange = { from: "2026-03-01", to: "2026-03-31" };
    rerender(panel("top-products", { dateFilters: nextRange }));

    expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith(
      { ...nextRange, limit: 10, skip: 0 },
      scope,
    );
  });

  it("returns to the first page when an out-of-range page comes back empty with a total", async () => {
    const setSkip = jest.fn();
    const pagination: ReportPagination = { limit: 10, setLimit: jest.fn(), setSkip, skip: 90 };

    render(panel("low-stock", { pagination }));

    expect(hooks.useLowStockReport).toHaveBeenLastCalledWith({ limit: 10, skip: 90 }, scope);
    await waitFor(() => expect(setSkip).toHaveBeenCalledWith(0));
  });

  it("uses the external pagination when it is given", async () => {
    const user = userEvent.setup();
    const setSkip = jest.fn();
    const pagination: ReportPagination = { limit: 10, setLimit: jest.fn(), setSkip, skip: 10 };

    render(panel("top-products", { pagination }));

    expect(hooks.useTopProductsReport).toHaveBeenLastCalledWith({ ...range, limit: 10, skip: 10 }, scope);

    await user.click(screen.getByRole("button", { name: "Ir a pagina 3" }));
    expect(setSkip).toHaveBeenCalledWith(20);
  });
});
