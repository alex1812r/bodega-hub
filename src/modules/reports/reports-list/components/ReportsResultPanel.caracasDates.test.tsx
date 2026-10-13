/**
 * REP-F8 · R-10: las fechas del kardex, de compras y de «última compra» son
 * instantes y se pintan en su día operativo de Caracas, no en la zona del
 * navegador. 03:30 UTC del día 11 son las 23:30 del día 10 en Caracas y las
 * 12:30 del día 11 en Tokio.
 *
 * @jest-environment ./src/modules/reports/reports-list/testing/tokyoTimezoneEnvironment.ts
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { getReportById, type ReportId } from "../config/reportCatalog";
import { ReportsResultPanel } from "./ReportsResultPanel";

const EDGE = "2026-05-11T03:30:00.000Z";
const mockRows: Record<string, unknown[]> = {};

function mockPaged(slug: string) {
  return () => ({
    data: { items: mockRows[slug] ?? [], limit: 10, skip: 0, total: mockRows[slug]?.length ?? 0 },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  });
}

jest.mock("../../hooks/useReports", () => ({
  ...jest.requireActual("../../hooks/useReports"),
  useCustomerPurchasesReport: jest.fn(mockPaged("customer-purchases")),
  useFxDepreciationReport: jest.fn(() => ({
    data: {
      items: [],
      limit: 10,
      skip: 0,
      summary: {
        byMethod: [],
        capitalLossRef: 0,
        capitalRefAtCollection: 0,
        capitalRefToday: 0,
        depreciationPctOnVes: 0,
        generatedAt: "2026-05-11T03:30:00.000Z",
        usdHeldRef: 0,
        valuationRateAt: "2026-05-11T03:30:00.000Z",
        valuationRateVes: 40,
        vesExposed: 0,
        vesLossRef: 0,
        vesRefAtCollection: 0,
        vesRefToday: 0,
      },
      total: 0,
    },
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: jest.fn(),
  })),
  usePurchasesReport: jest.fn(mockPaged("purchases")),
  useStockCardReport: jest.fn(mockPaged("stock-card")),
  useSupplierPurchasesReport: jest.fn(mockPaged("supplier-purchases")),
}));

jest.mock("../../../inventory/restock", () => ({
  RestockPurchaseButton: () => null,
}));

function renderPanel(id: ReportId) {
  return render(
    <ReportsResultPanel
      dateFilters={{}}
      purchasesFilters={{}}
      report={getReportById(id)}
      stockCardFilters={{}}
    />,
  );
}

describe("ReportsResultPanel · fechas en día operativo de Caracas (REP-F8 R-10)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    for (const key of Object.keys(mockRows)) {
      delete mockRows[key];
    }

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: !query.includes("max-width"),
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }),
      writable: true,
    });
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it("la prueba corre con el reloj local en Tokio", () => {
    expect(new Date(EDGE).getDate()).toBe(11);
    expect(new Date(EDGE).getHours()).toBe(12);
  });

  it("kardex: el movimiento sale en el día 10", () => {
    mockRows["stock-card"] = [
      { createdAt: EDGE, id: "m-1", productName: "Harina", quantityDelta: -1, sku: "H-1", stockAfter: 4, type: "venta" },
    ];
    renderPanel("stock-card");

    expect(screen.getAllByText("10/05/2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("11/05/2026")).not.toBeInTheDocument();
  });

  it("compras: la fecha de la compra sale en el día 10", () => {
    mockRows.purchases = [
      { createdAt: EDGE, id: "c-1", itemsCount: 1, purchaseNumber: "C-1", supplierId: "s-1", totalRef: 5, totalVes: 200 },
    ];
    renderPanel("purchases");

    expect(screen.getAllByText("10/05/2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("11/05/2026")).not.toBeInTheDocument();
  });

  it.each(["customer-purchases", "supplier-purchases"] as const)(
    "%s: «última compra» sale en el día 10",
    (reportId) => {
      mockRows[reportId] = [
        {
          customerId: "x-1",
          lastPurchaseAt: EDGE,
          name: "Ana",
          pendingVes: 0,
          purchasesCount: 1,
          salesCount: 1,
          supplierId: "x-1",
          totalRef: 5,
        },
      ];
      renderPanel(reportId);

      expect(screen.getAllByText("10/05/2026").length).toBeGreaterThan(0);
      expect(screen.queryByText("11/05/2026")).not.toBeInTheDocument();
    },
  );

  it("depreciación FX: la tasa «Registrada» sale en el día 10", () => {
    renderPanel("fx-depreciation");

    expect(screen.getByText("Registrada 10/05/2026")).toBeInTheDocument();
  });
});
