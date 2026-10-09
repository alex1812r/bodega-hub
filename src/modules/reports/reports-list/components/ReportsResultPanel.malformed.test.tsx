/**
 * REP-F8 · R-05: una respuesta 200 con campos nulos, faltantes o de otro tipo no
 * tumba la página. El panel muestra sus datos saneados o su estado de error en
 * español con «Reintentar»; lo que está fuera del panel sigue vivo.
 *
 * Los casos son los del script de caos `ui-robust2.cjs`.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Permission } from "@/shared/auth/permissions";

import { getReportById, type ReportId } from "../config/reportCatalog";
import { ReportsResultPanel } from "./ReportsResultPanel";

const mockData: Record<string, unknown> = {};
const mockRefetch = jest.fn();

function mockQuery(slug: string) {
  return () => ({
    data: mockData[slug],
    error: null,
    isFetching: false,
    isLoading: false,
    refetch: mockRefetch,
  });
}

jest.mock("../../hooks/useReports", () => ({
  ...jest.requireActual("../../hooks/useReports"),
  useCustomerPurchasesReport: jest.fn(mockQuery("customer-purchases")),
  useDailySalesReport: jest.fn(mockQuery("daily-sales")),
  useLowStockReport: jest.fn(mockQuery("low-stock")),
  useProductProfitabilityReport: jest.fn(mockQuery("product-profitability")),
  usePurchasesReport: jest.fn(mockQuery("purchases")),
  useStockCardReport: jest.fn(mockQuery("stock-card")),
  useSupplierPurchasesReport: jest.fn(mockQuery("supplier-purchases")),
  useTopCustomersReport: jest.fn(mockQuery("top-customers")),
  useTopProductsReport: jest.fn(mockQuery("top-products")),
}));

jest.mock("../../hooks/useMoneyReports", () => ({
  useCashCloseDifferencesReport: jest.fn(mockQuery("cash-close-differences")),
  usePayablesAgingReport: jest.fn(mockQuery("payables-aging")),
  useReceivablesAgingReport: jest.fn(mockQuery("receivables-aging")),
  useSalesByCategoryReport: jest.fn(mockQuery("sales-by-category")),
  useSalesByHourReport: jest.fn(mockQuery("sales-by-hour")),
}));

jest.mock("../../hooks/useInventoryReports", () => ({
  useDeadStockReport: jest.fn(mockQuery("dead-stock")),
  useStockAdjustmentsReport: jest.fn(mockQuery("stock-adjustments")),
  useStockTurnoverReport: jest.fn(mockQuery("stock-turnover")),
}));

jest.mock("../../../../shared/auth/usePermission", () => {
  const { getRolePermissions } = jest.requireActual("../../../../shared/auth/permissions");
  const permissions: Permission[] = getRolePermissions("admin");

  return { usePermission: () => ({ can: () => true, isLoading: false, permissions, role: "admin" }) };
});

jest.mock("../../../products/hooks/useProducts", () => ({
  useAllCategories: () => ({ data: undefined, error: null }),
}));

jest.mock("../../../contacts/hooks/useContacts", () => ({
  useContact: () => ({ data: undefined, error: null }),
}));

jest.mock("../../../inventory/restock", () => ({
  RestockPurchaseButton: () => null,
}));

const RANGE = { from: "2026-05-01", to: "2026-05-18" };
const zero = { count: 0, paidVes: 0, totalRef: 0, totalVes: 0 };

function bucket(key: string, values: Record<string, unknown>) {
  return { from: key, key, label: `${key.slice(8)}/${key.slice(5, 7)}`, to: key, ...values };
}

function series(current: unknown[], previous: unknown[] | null, totals: unknown) {
  return {
    current,
    groupBy: "day",
    previous,
    previousRange: previous ? { from: "2026-04-29", to: "2026-04-30" } : null,
    range: { from: "2026-05-01", to: "2026-05-02" },
    totals,
  };
}

const CASES: [ReportId, string, unknown][] = [
  ["daily-sales", "items null", { items: null, limit: 10, skip: 0, total: null }],
  [
    "daily-sales",
    "campos null",
    {
      items: [{ paidVes: null, saleDate: null, salesCount: null, totalRef: null, totalVes: null }],
      limit: 10,
      series: series(
        [bucket("2026-05-01", { count: null, paidVes: null, totalRef: null, totalVes: null })],
        null,
        {
          current: { count: null, paidVes: null, totalRef: null, totalVes: null },
          deltaPct: null,
          previous: null,
        },
      ),
      skip: 0,
      total: 1,
    },
  ],
  [
    "daily-sales",
    "campos faltantes",
    { items: [{}], limit: 10, series: { current: [{ key: "2026-05-01" }], totals: {} }, skip: 0, total: 1 },
  ],
  [
    "daily-sales",
    "números como texto",
    {
      items: [{ paidVes: "-", saleDate: "no-es-fecha", salesCount: "x", totalRef: "abc", totalVes: "Infinity" }],
      limit: 10,
      series: series(
        [bucket("2026-05-01", { count: "x", paidVes: "z", totalRef: "abc", totalVes: "y" })],
        [bucket("2026-04-29", zero)],
        { current: { count: 1, paidVes: 1, totalRef: "abc", totalVes: 1 }, deltaPct: "NaN", previous: zero },
      ),
      skip: 0,
      total: "muchos",
    },
  ],
  ["top-products", "items null", { items: null, limit: 10, skip: 0, total: 0 }],
  [
    "top-products",
    "campos null",
    {
      items: [{ name: null, productId: null, revenueRef: null, sku: null, unitsSold: null }],
      limit: 10,
      skip: 0,
      total: 1,
    },
  ],
  [
    "sales-by-hour",
    "matrix null",
    { byHour: null, byWeekday: null, matrix: null, range: RANGE, totals: null },
  ],
  [
    "sales-by-hour",
    "matrix corta",
    {
      byHour: [],
      byWeekday: [],
      matrix: [[{ salesCount: 1, totalRef: "NaN", totalVes: null }]],
      range: RANGE,
      totals: { salesCount: 5, totalRef: null, totalVes: null },
    },
  ],
  [
    "dead-stock",
    "summary null",
    {
      asOf: null,
      days: null,
      items: [
        {
          category: null,
          costRef: null,
          daysIdle: null,
          daysSinceLastMovement: null,
          idleSince: null,
          lastMovementAt: null,
          lastSaleAt: null,
          product: null,
          stock: null,
          stockValueRef: null,
        },
      ],
      limit: 10,
      skip: 0,
      summary: null,
      total: 1,
    },
  ],
  [
    "stock-turnover",
    "turnover basura",
    {
      groupBy: "product",
      inventoryBasis: "x",
      items: [
        {
          averageStockValueRef: null,
          category: { id: null, name: null },
          closingStock: null,
          cogsRef: null,
          daysOfInventory: "NaN",
          key: "k",
          openingStock: null,
          product: null,
          productsCount: null,
          soldUnits: null,
          stock: null,
          stockValueRef: null,
          turnover: "Infinity",
        },
      ],
      limit: 10,
      range: RANGE,
      rangeDays: 0,
      skip: 0,
      total: 1,
      totals: null,
    },
  ],
  [
    "cash-close-differences",
    "totals null",
    {
      items: [
        {
          cashSessionId: "x",
          closeDate: null,
          closedAt: null,
          closedReason: "zzz",
          counted: null,
          currency: "eur",
          difference: "NaN",
          expected: null,
          registerId: null,
          registerName: null,
          runningDifference: "Infinity",
        },
      ],
      limit: 10,
      range: { from: null, to: null },
      skip: 0,
      total: 1,
      totals: null,
    },
  ],
  [
    "sales-by-category",
    "totals null",
    {
      items: [
        {
          categoryId: null,
          categoryName: null,
          costRef: null,
          grossProfitRef: "NaN",
          marginPct: "Infinity",
          markupPct: "NaN",
          revenueRef: 0,
          units: null,
        },
      ],
      range: RANGE,
      totals: null,
    },
  ],
];

/** REP-F10 (N-11): una fila sin ningún campo pintaba «undefined» en la etiqueta del gráfico o en la celda. */
const EMPTY_ROW_REPORTS: ReportId[] = [
  "top-customers",
  "customer-purchases",
  "supplier-purchases",
  "purchases",
  "top-products",
  "product-profitability",
  "low-stock",
  "stock-card",
];

function getReport(id: ReportId) {
  return getReportById(id);
}

function renderPage(id: ReportId) {
  return render(
    <div>
      <p>Catálogo y filtros siguen aquí</p>
      <ReportsResultPanel
        dateFilters={{ ...RANGE, compare: true }}
        inventoryFilters={{ days: 30, turnoverBy: "product" }}
        moneyFilters={{ currency: "ves" }}
        purchasesFilters={RANGE}
        report={getReport(id)}
        stockCardFilters={{}}
      />
    </div>,
  );
}

describe("ReportsResultPanel · respuestas 200 malformadas (REP-F8 R-05)", () => {
  const originalResizeObserver = global.ResizeObserver;
  const originalMatchMedia = window.matchMedia;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    for (const key of Object.keys(mockData)) {
      delete mockData[key];
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
    // React registra en consola cada error que atrapa un límite: es lo esperado aquí.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    global.ResizeObserver = originalResizeObserver;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  it.each(CASES)("%s · %s: no lanza fuera del panel", (reportId, _name, data) => {
    mockData[reportId] = data;

    expect(() => renderPage(reportId)).not.toThrow();

    // El resto de la página sigue montado.
    expect(screen.getByText("Catálogo y filtros siguen aquí")).toBeInTheDocument();

    const failed = screen.queryByText("No pudimos mostrar este reporte");

    if (failed) {
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    } else {
      // Datos saneados: ninguna cifra rota a la vista.
      expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined|Invalid date|\[object Object\]/);
    }
  });

  it.each(EMPTY_ROW_REPORTS)("%s · filas sin campos: ni «undefined» ni celdas en blanco (N-11)", (reportId) => {
    mockData[reportId] = { items: [{}, {}], limit: 10, skip: 0, total: 2 };

    expect(() => renderPage(reportId)).not.toThrow();
    expect(screen.getByText("Catálogo y filtros siguen aquí")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined|Invalid date|\[object Object\]/);
    expect(
      [...document.querySelectorAll("[aria-label]")].map((node) => node.getAttribute("aria-label")).join(" "),
    ).not.toMatch(/undefined|NaN/);

    if (!screen.queryByText("No pudimos mostrar este reporte")) {
      // Cada celda de las filas rotas dice algo: «—» donde falta el dato.
      const cells = [...document.querySelectorAll("tbody td")];

      expect(cells.length).toBeGreaterThan(0);
      expect(cells.filter((cell) => cell.textContent?.trim() === "")).toHaveLength(0);
    }
  });

  it("«Reintentar» reinicia el límite y vuelve a pintar el reporte cuando la respuesta ya es buena", async () => {
    mockData["daily-sales"] = { items: null, limit: 10, skip: 0, total: null };
    renderPage("daily-sales");

    expect(screen.getByText("No pudimos mostrar este reporte")).toBeInTheDocument();

    mockData["daily-sales"] = {
      items: [{ paidVes: 40, saleDate: "2026-05-10", salesCount: 1, totalRef: 1, totalVes: 40 }],
      limit: 10,
      skip: 0,
      total: 1,
    };
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(screen.queryByText("No pudimos mostrar este reporte")).not.toBeInTheDocument();
    expect(screen.getByText("Resultados: Ventas diarias")).toBeInTheDocument();
    expect(screen.getAllByText("10/05/2026").length).toBeGreaterThan(0);
  });

  it("cambiar de reporte también reinicia el límite", () => {
    mockData["daily-sales"] = { items: null, limit: 10, skip: 0, total: null };
    mockData["top-products"] = {
      items: [{ name: "Harina", productId: "p-1", revenueRef: 5, sku: "H-1", unitsSold: 3 }],
      limit: 10,
      skip: 0,
      total: 1,
    };
    const view = renderPage("daily-sales");

    expect(screen.getByText("No pudimos mostrar este reporte")).toBeInTheDocument();

    view.rerender(
      <div>
        <ReportsResultPanel
          dateFilters={RANGE}
          purchasesFilters={RANGE}
          report={getReport("top-products")}
          stockCardFilters={{}}
        />
      </div>,
    );

    expect(screen.queryByText("No pudimos mostrar este reporte")).not.toBeInTheDocument();
    expect(screen.getByText("Resultados: Top productos")).toBeInTheDocument();
  });
});
