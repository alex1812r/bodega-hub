/**
 * REP-04 · gráfico encima de la tabla en los reportes de serie y de ranking,
 * variación frente al periodo anterior, aviso de agrupación automática y tabla
 * plegable. Las series salen de los constructores reales de `reportSeries`.
 *
 * jsdom no mide: se simula un contenedor de 390 × 280 para que recharts dibuje.
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { paymentMethodLabels } from "@/shared/payments/paymentMethods";
import { formatRef, formatVesBs } from "@/shared/utils/currency";

import type { ReportDateRangeFilters } from "../../hooks/useReports";
import {
  buildDailySalesSeries,
  buildGrossProfitSeries,
  buildPurchasesSeries,
  parseReportSeriesParams,
  resolveReportSeriesRequest,
  type ReportSeriesRequest,
} from "../../services/reportSeries";
import {
  MULTI_STORE_REPORT_IDS as REPORT_IDS,
  reportCatalog,
  type ReportId,
} from "../config/reportCatalog";
import { getGroupingNotice } from "./ReportSeriesChart";
import { ReportsResultPanel, type ReportPagination } from "./ReportsResultPanel";

type MockResponse = { data?: unknown; error?: Error | null; isLoading?: boolean };

const mockResponses: Record<string, MockResponse> = {};
const mockRefetch = jest.fn();

jest.mock("../../hooks/useReports", () => {
  const respond = (slug: string) => () => ({
    data: mockResponses[slug]?.data,
    error: mockResponses[slug]?.error ?? null,
    isFetching: false,
    isLoading: mockResponses[slug]?.isLoading ?? false,
    refetch: mockRefetch,
  });

  return {
    ...jest.requireActual("../../hooks/useReports"),
    useCustomerPurchasesReport: jest.fn(respond("customer-purchases")),
    useDailyCloseReport: jest.fn(respond("daily-close")),
    useDailySalesReport: jest.fn(respond("daily-sales")),
    useFxDepreciationReport: jest.fn(respond("fx-depreciation")),
    useGrossProfitReport: jest.fn(respond("gross-profit")),
    useLowStockReport: jest.fn(respond("low-stock")),
    usePaymentMethodsReport: jest.fn(respond("payment-methods")),
    useProductProfitabilityReport: jest.fn(respond("product-profitability")),
    usePurchasesReport: jest.fn(respond("purchases")),
    useStockCardReport: jest.fn(respond("stock-card")),
    useSupplierPurchasesReport: jest.fn(respond("supplier-purchases")),
    useTopCustomersReport: jest.fn(respond("top-customers")),
    useTopProductsReport: jest.fn(respond("top-products")),
  };
});

jest.mock("../../../inventory/restock", () => ({
  RestockPurchaseButton: () => null,
}));

const MAY = { from: "2026-05-01", to: "2026-05-10" };

function getReport(id: ReportId) {
  const report = reportCatalog.find((item) => item.id === id);

  if (!report) {
    throw new Error(`Reporte ${id} no encontrado`);
  }

  return report;
}

function seriesRequest(query: string): ReportSeriesRequest {
  const request = resolveReportSeriesRequest(parseReportSeriesParams(new URLSearchParams(query)));

  if (!request) {
    throw new Error(`La consulta "${query}" no pide serie`);
  }

  return request;
}

function sale(day: string, totalRef: number) {
  return { day, values: { count: 1, paidVes: totalRef * 40, totalRef, totalVes: totalRef * 40 } };
}

function page<T>(items: T[], extra: Record<string, unknown> = {}, total = items.length) {
  return { items, limit: 10, skip: 0, total, ...extra };
}

/** Fila con los campos que pinta cualquiera de las tablas. */
function row(position: number, value: number) {
  return {
    costRef: 1,
    createdAt: "2026-05-10T12:00:00.000Z",
    currentStock: 1,
    customerId: `id-${position}`,
    grossProfitRef: value,
    id: `id-${position}`,
    itemsCount: 1,
    minStock: 2,
    name: `Nombre ${position}`,
    paidVes: 1,
    pendingVes: 0,
    productId: `id-${position}`,
    purchaseNumber: `C-${position}`,
    purchasesCount: 1,
    quantityDelta: 1,
    revenueRef: value,
    saleDate: "2026-05-10",
    salesCount: 1,
    sku: `SKU-${position}`,
    stockAfter: 1,
    supplierId: `id-${position}`,
    totalRef: value,
    totalVes: value * 40,
    type: "venta",
    unitsSold: value,
  };
}

function renderPanel(
  id: ReportId,
  dateFilters: ReportDateRangeFilters = MAY,
  pagination?: ReportPagination,
) {
  return render(
    <ReportsResultPanel
      dateFilters={dateFilters}
      pagination={pagination}
      purchasesFilters={{ from: dateFilters.from, to: dateFilters.to }}
      report={getReport(id)}
      stockCardFilters={{}}
    />,
  );
}

function chartRegion(id: ReportId) {
  return screen.getByRole("region", { name: `Gráfico: ${getReport(id).name}` });
}

function setViewport(kind: "desktop" | "mobile") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query.includes("max-width") ? kind === "mobile" : kind === "desktop",
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
    writable: true,
  });
}

const SERIES_REPORTS = ["daily-sales", "gross-profit", "purchases"] as const;
const RANKING_REPORTS = [
  "top-products",
  "top-customers",
  "product-profitability",
  "customer-purchases",
  "supplier-purchases",
] as const;
const TABLE_ONLY_REPORTS = ["low-stock", "stock-card"] as const;

describe("ReportsResultPanel · gráficos (REP-04)", () => {
  const originalMatchMedia = window.matchMedia;
  const originalResizeObserver = global.ResizeObserver;
  let rectSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    for (const key of Object.keys(mockResponses)) {
      delete mockResponses[key];
    }

    setViewport("desktop");
    global.ResizeObserver = class {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function measure(this: HTMLElement) {
        return (
          this.id === "recharts_measurement_span"
            ? { height: 13, width: (this.textContent ?? "").length * 6.6 }
            : { height: 280, width: 390 }
        ) as DOMRect;
      });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    rectSpy.mockRestore();
    warnSpy.mockRestore();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
      writable: true,
    });
  });

  describe("catálogo", () => {
    it("todo reporte de serie o ranking declara su gráfico; el resto, ninguno", () => {
      const withChart = REPORT_IDS.filter((id) => getReport(id).chart);

      expect(withChart.filter((id) => getReport(id).chart === "line")).toEqual([...SERIES_REPORTS]);
      expect(withChart.filter((id) => getReport(id).chart === "ranking").sort()).toEqual(
        [...RANKING_REPORTS, "payment-methods"].sort(),
      );
      expect(REPORT_IDS.filter((id) => !getReport(id).chart).sort()).toEqual(
        [...TABLE_ONLY_REPORTS, "daily-close", "fx-depreciation"].sort(),
      );
    });
  });

  describe("reportes de serie: línea encima de la tabla", () => {
    const request = seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto");
    const responses: Record<(typeof SERIES_REPORTS)[number], unknown> = {
      "daily-sales": page([row(1, 100)], {
        series: buildDailySalesSeries(request, [sale("2026-05-02", 100), sale("2026-05-05", 50)]),
      }),
      "gross-profit": page([row(1, 100)], {
        series: buildGrossProfitSeries(request, [
          { day: "2026-05-02", values: { costRef: 60, grossProfitRef: 40, revenueRef: 100 } },
          { day: "2026-05-05", values: { costRef: 30, grossProfitRef: 110, revenueRef: 140 } },
        ]),
      }),
      purchases: page([row(1, 100)], {
        series: buildPurchasesSeries(request, [
          { day: "2026-05-02", values: { count: 1, totalRef: 100, totalVes: 4000 } },
          { day: "2026-05-05", values: { count: 2, totalRef: 50, totalVes: 2000 } },
        ]),
      }),
    };

    it.each(SERIES_REPORTS)("%s dibuja su gráfico de línea con el total, antes de la tabla", (id) => {
      mockResponses[id] = { data: responses[id] };
      renderPanel(id);

      const region = chartRegion(id);
      const chart = within(region).getByRole("img");

      expect(chart).toHaveAccessibleName(
        expect.stringMatching(new RegExp(`^${getReport(id).name}: 10 puntos`)),
      );
      expect(within(region).getByText("ref 150.00")).toBeInTheDocument();
      expect(within(region).getByText("1–10 may 2026 · por día")).toBeInTheDocument();
      // Sin aviso de agrupación. Compras, sin estado elegido, dice qué deja fuera.
      expect(within(region).queryAllByRole("note").map((note) => note.textContent)).toEqual(
        id === "purchases" ? ["No incluye compras canceladas ni devueltas."] : [],
      );
      expect(within(region).queryByTestId("report-delta")).not.toBeInTheDocument();

      const table = screen.getByText(`Resultados: ${getReport(id).name}`);

      expect(region.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(region.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("con comparación superpone el periodo anterior y muestra la variación del total", () => {
      mockResponses["daily-sales"] = {
        data: page([row(1, 100)], {
          series: buildDailySalesSeries(
            seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto&compare=1"),
            [sale("2026-05-02", 100), sale("2026-05-05", 50), sale("2026-04-25", 100)],
          ),
        }),
      };
      renderPanel("daily-sales", { ...MAY, compare: true });

      const region = chartRegion("daily-sales");
      const delta = within(region).getByTestId("report-delta");

      expect(delta).toHaveTextContent("↑ 50 %");
      expect(delta).toHaveTextContent("sube 50 %");
      expect(delta).toHaveTextContent("vs. periodo anterior");
      expect(within(region).getByText("Periodo anterior")).toBeInTheDocument();
    });

    it("una caída se anuncia con flecha, texto y color de error", () => {
      mockResponses["daily-sales"] = {
        data: page([row(1, 100)], {
          series: buildDailySalesSeries(
            seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto&compare=1"),
            [sale("2026-05-02", 50), sale("2026-04-25", 200)],
          ),
        }),
      };
      renderPanel("daily-sales", { ...MAY, compare: true });

      const delta = within(chartRegion("daily-sales")).getByTestId("report-delta");

      expect(delta).toHaveTextContent("↓ 75 %");
      expect(delta).toHaveTextContent("baja 75 %");
      expect(within(delta).getByText("↓ 75 %")).toHaveClass("text-error");
    });

    it("en compras la variación no lleva color de bueno o malo", () => {
      mockResponses.purchases = {
        data: page([row(1, 100)], {
          series: buildPurchasesSeries(
            seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto&compare=1"),
            [
              { day: "2026-05-02", values: { count: 1, totalRef: 150, totalVes: 6000 } },
              { day: "2026-04-25", values: { count: 1, totalRef: 100, totalVes: 4000 } },
            ],
          ),
        }),
      };
      renderPanel("purchases", { ...MAY, compare: true });

      const delta = within(chartRegion("purchases")).getByTestId("report-delta");

      expect(within(delta).getByText("↑ 50 %")).toHaveClass("text-on-surface");
      expect(within(delta).getByText("↑ 50 %")).not.toHaveClass("text-emerald-700");
    });

    it.each(SERIES_REPORTS)("%s: periodo anterior sin datos muestra «—», nunca NaN, Infinity ni 0 %%", (id) => {
      const compared = seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto&compare=1");
      const series = {
        "daily-sales": buildDailySalesSeries(compared, [sale("2026-05-02", 100)]),
        "gross-profit": buildGrossProfitSeries(compared, [
          { day: "2026-05-02", values: { costRef: 60, grossProfitRef: 40, revenueRef: 100 } },
        ]),
        purchases: buildPurchasesSeries(compared, [
          { day: "2026-05-02", values: { count: 1, totalRef: 100, totalVes: 4000 } },
        ]),
      }[id];

      mockResponses[id] = { data: page([row(1, 100)], { series }) };
      renderPanel(id, { ...MAY, compare: true });

      const region = chartRegion(id);
      const delta = within(region).getByTestId("report-delta");

      expect(series.totals.deltaPct).toBeNull();
      expect(delta).toHaveTextContent("—");
      expect(delta).toHaveTextContent("sin periodo anterior comparable");
      expect(delta.textContent).not.toMatch(/NaN|Infinity|\d\s?%/);
      expect(within(region).queryByText("Periodo anterior")).not.toBeInTheDocument();
      expect(region.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("rango de 2 años en ventas diarias: agrupa por mes, lo avisa y dibuja sin colgarse", () => {
      const request = seriesRequest("from=2024-05-19&to=2026-05-18&groupBy=auto");
      const rows = Array.from({ length: 730 }, (_, index) => {
        const day = new Date(Date.UTC(2024, 4, 19 + index)).toISOString().slice(0, 10);

        return sale(day, 10 + (index % 7));
      });

      mockResponses["daily-sales"] = {
        data: page([row(1, 100)], { series: buildDailySalesSeries(request, rows) }, 730),
      };
      renderPanel("daily-sales", { from: "2024-05-19", to: "2026-05-18" });

      const region = chartRegion("daily-sales");

      expect(request.groupBy).toBe("month");
      expect(within(region).getByRole("note")).toHaveTextContent(
        "Agrupado por mes automáticamente.",
      );
      expect(within(region).getByRole("img")).toHaveAccessibleName(
        expect.stringMatching(/^Ventas diarias: 25 puntos/),
      );
      expect(region.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("rango de 6 meses: agrupa por semana y lo avisa", () => {
      const request = seriesRequest("from=2025-11-19&to=2026-05-18&groupBy=auto");

      mockResponses["gross-profit"] = {
        data: page([row(1, 100)], {
          series: buildGrossProfitSeries(request, [
            { day: "2026-01-10", values: { costRef: 1, grossProfitRef: 9, revenueRef: 10 } },
          ]),
        }),
      };
      renderPanel("gross-profit", { from: "2025-11-19", to: "2026-05-18" });

      expect(within(chartRegion("gross-profit")).getByRole("note")).toHaveTextContent(
        "Agrupado por semana automáticamente.",
      );
    });

    it("una agrupación elegida a mano no lleva aviso", () => {
      mockResponses["daily-sales"] = {
        data: page([row(1, 100)], {
          series: buildDailySalesSeries(
            seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=week"),
            [sale("2026-05-02", 100)],
          ),
        }),
      };
      renderPanel("daily-sales", { ...MAY, groupBy: "week" });

      const region = chartRegion("daily-sales");

      expect(within(region).queryByRole("note")).not.toBeInTheDocument();
      expect(within(region).getByText("1–10 may 2026 · por semana")).toBeInTheDocument();
    });

    it("un solo día de datos: un punto, sin NaN", () => {
      mockResponses["daily-sales"] = {
        data: page([row(1, 100)], {
          series: buildDailySalesSeries(
            seriesRequest("from=2026-05-10&to=2026-05-10&groupBy=auto"),
            [sale("2026-05-10", 80)],
          ),
        }),
      };
      renderPanel("daily-sales", { from: "2026-05-10", to: "2026-05-10" });

      const region = chartRegion("daily-sales");

      expect(within(region).getByRole("img")).toHaveAccessibleName(
        expect.stringMatching(/^Ventas diarias: 1 punto/),
      );
      expect(region.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("rango sin movimiento: estado vacío en vez de una línea en 0", () => {
      mockResponses["daily-sales"] = {
        data: page([], {
          series: buildDailySalesSeries(seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto"), []),
        }),
      };
      renderPanel("daily-sales");

      const region = chartRegion("daily-sales");

      expect(within(region).getByText("Sin datos en este periodo")).toBeInTheDocument();
      expect(within(region).queryByRole("img")).not.toBeInTheDocument();
    });

    it("sin rango completo pide elegirlo y la tabla sigue disponible", () => {
      mockResponses["daily-sales"] = { data: page([row(1, 100)]) };
      renderPanel("daily-sales", {});

      const region = chartRegion("daily-sales");

      expect(within(region).getByText("Elige un rango de fechas")).toBeInTheDocument();
      expect(within(region).getByText("Todas las fechas")).toBeInTheDocument();
      expect(screen.getByText("Resultados: Ventas diarias")).toBeVisible();
    });

    it("cargando y error: estados propios del gráfico, con reintento", async () => {
      mockResponses["daily-sales"] = { isLoading: true };
      const { unmount } = renderPanel("daily-sales");

      expect(screen.getByRole("status", { name: "Cargando Ventas diarias" })).toBeInTheDocument();
      unmount();

      mockResponses["daily-sales"] = { error: new Error("Failed to fetch") };
      renderPanel("daily-sales");

      const region = chartRegion("daily-sales");

      // REP-F8 R-11: un fallo que no es de negocio no enseña su mensaje interno.
      expect(within(region).getByText("No pudimos cargar el reporte.")).toBeInTheDocument();
      expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
      await userEvent.click(within(region).getByRole("button", { name: /reintentar/i }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getGroupingNotice", () => {
    it("avisa solo cuando la agrupación efectiva no es la esperada", () => {
      expect(getGroupingNotice(undefined, "day")).toBeNull();
      expect(getGroupingNotice("auto", "day")).toBeNull();
      expect(getGroupingNotice("auto", "week")).toBe("Agrupado por semana automáticamente.");
      expect(getGroupingNotice(undefined, "month")).toBe("Agrupado por mes automáticamente.");
      expect(getGroupingNotice("month", "month")).toBeNull();
      expect(getGroupingNotice("day", "month")).toBe("Agrupado por mes automáticamente.");
      expect(getGroupingNotice("day", undefined)).toBeNull();
    });
  });

  describe("reportes de ranking: barras ordenadas encima de la tabla", () => {
    it.each(RANKING_REPORTS)("%s dibuja el ranking de la página visible, de mayor a menor", (id) => {
      mockResponses[id] = { data: page([row(1, 20), row(2, 90), row(3, 45)]) };
      renderPanel(id);

      const region = chartRegion(id);
      const chart = within(region).getByRole("img");
      const values = [...chart.querySelectorAll("text[data-value]")].map((node) => node.textContent);

      expect(chart).toHaveAccessibleName(expect.stringContaining("3 elementos"));
      expect(values).toHaveLength(3);
      expect(values[0]).toMatch(/90/);
      expect(values[2]).toMatch(/20/);
      expect(within(region).getByText(/^Top 3 de esta página · /)).toBeInTheDocument();

      const table = screen.getByText(`Resultados: ${getReport(id).name}`);

      expect(region.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("top productos mide unidades y muestra el rango; rentabilidad usa el nombre del producto", () => {
      mockResponses["top-products"] = { data: page([row(1, 20), row(2, 90)]) };
      const { unmount } = renderPanel("top-products");

      expect(
        within(chartRegion("top-products")).getByText(
          "Top 2 de esta página · Unidades vendidas · 1–10 may 2026",
        ),
      ).toBeInTheDocument();
      expect(within(chartRegion("top-products")).getByText("90 uds")).toBeInTheDocument();
      unmount();

      mockResponses["product-profitability"] = { data: page([row(1, 20), row(2, -5)]) };
      renderPanel("product-profitability");

      const region = chartRegion("product-profitability");

      expect(within(region).getByText("Top 2 de esta página · Ganancia bruta en REF")).toBeInTheDocument();
      expect(within(region).getByRole("img")).toHaveAccessibleName(
        expect.stringContaining("1. Nombre 1: ref 20.00. 2. Nombre 2: ref -5.00."),
      );
      expect(region.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    // REP-F2: el id interno (un UUID con datos reales) no se enseña nunca.
    it.each(["top-products", "product-profitability"] as const)(
      "%s rotula con el nombre del producto (SKU secundario) y no muestra el id interno",
      (id) => {
        mockResponses[id] = { data: page([row(1, 20), row(2, 90)]) };
        renderPanel(id);

        const region = chartRegion(id);

        expect(within(region).getByRole("img")).toHaveAccessibleName(
          expect.stringMatching(/1. Nombre 2: .*2. Nombre 1: /),
        );

        const table = screen.getByRole("table");

        expect(within(table).getByRole("cell", { name: "Nombre 2" })).toBeInTheDocument();
        expect(within(table).getByRole("cell", { name: "SKU-2" })).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(/id-[12]/);
      },
    );

    it("un producto sin nombre cae al SKU, no al id interno", () => {
      mockResponses["top-products"] = { data: page([{ ...row(1, 20), name: undefined }]) };
      renderPanel("top-products");

      expect(within(chartRegion("top-products")).getByRole("img")).toHaveAccessibleName(
        expect.stringContaining("1. SKU-1: "),
      );
      expect(within(screen.getByRole("table")).getAllByRole("cell", { name: "SKU-1" })).toHaveLength(2);
      expect(document.body).not.toHaveTextContent("id-1");
    });

    it("el kardex muestra el nombre del producto, no su id interno", () => {
      mockResponses["stock-card"] = {
        data: page([{ ...row(1, 20), productName: "Cable THW 12" }, { ...row(2, 5), id: "mov-2" }]),
      };
      renderPanel("stock-card");

      const table = screen.getByRole("table");

      expect(within(table).getByRole("cell", { name: "Cable THW 12" })).toBeInTheDocument();
      expect(within(table).getByRole("cell", { name: "SKU-2" })).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(/id-[12]/);
    });

    it("con más de 10 filas en la página dibuja solo las 10 mayores", () => {
      mockResponses["top-customers"] = {
        data: page(
          Array.from({ length: 25 }, (_, index) => row(index + 1, index + 1)),
          { limit: 25 },
          25,
        ),
      };
      renderPanel("top-customers");

      const region = chartRegion("top-customers");

      expect(within(region).getByRole("img").querySelectorAll("g[data-rank]")).toHaveLength(10);
      expect(within(region).getByText(/^Top 10 de esta página · /)).toBeInTheDocument();
    });

    it("sin filas: estado vacío; cargando: esqueleto", () => {
      mockResponses["top-customers"] = { data: page([]) };
      const { unmount } = renderPanel("top-customers");

      expect(within(chartRegion("top-customers")).getByText("Sin datos para el ranking")).toBeInTheDocument();
      unmount();

      mockResponses["top-customers"] = { isLoading: true };
      renderPanel("top-customers");

      expect(screen.getByRole("status", { name: /^Cargando Top clientes/ })).toBeInTheDocument();
    });
  });

  describe("métodos de pago: barras por método", () => {
    const items = [
      { amountRef: 120, amountVes: 0, method: "efectivo_usd", paymentCount: 3 },
      { amountRef: 300, amountVes: 12000, method: "pago_movil", paymentCount: 5 },
      { amountRef: 0, amountVes: 0, method: "transferencia", paymentCount: 0 },
    ];
    const summary = { paymentCount: 8, totalRef: 420, totalVes: 12000 };

    it("dibuja una barra por método, ordenadas por REF cobrado, y la tabla debajo", () => {
      mockResponses["payment-methods"] = { data: page(items, { summary }) };
      renderPanel("payment-methods");

      const region = chartRegion("payment-methods");
      const chart = within(region).getByRole("img");

      expect(chart).toHaveAccessibleName(
        expect.stringContaining(
          `1. ${paymentMethodLabels.pago_movil}: ref 300.00. 2. ${paymentMethodLabels.efectivo_usd}: ref 120.00.`,
        ),
      );
      expect(chart.querySelectorAll('rect[data-bar="previous"]')).toHaveLength(0);
      expect(within(region).queryByTestId("report-delta")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Tabla de datos/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.queryByRole("columnheader", { name: "Variación" })).not.toBeInTheDocument();
    });

    it("con comparación: valor anterior y variación por método, «—» si no hay con qué comparar", () => {
      mockResponses["payment-methods"] = {
        data: page(items, {
          comparison: {
            deltaPct: 5,
            deltaPctByMethod: { efectivo_usd: 20, pago_movil: null, transferencia: null },
            previous: {
              items: [
                { amountRef: 100, amountVes: 0, method: "efectivo_usd", paymentCount: 2 },
                { amountRef: 0, amountVes: 0, method: "pago_movil", paymentCount: 0 },
              ],
              summary: { paymentCount: 2, totalRef: 400, totalVes: 0 },
            },
            previousRange: { from: "2026-04-21", to: "2026-04-30" },
          },
          summary,
        }),
      };
      renderPanel("payment-methods", { ...MAY, compare: true });

      const region = chartRegion("payment-methods");
      const comparisons = [
        ...within(region).getByRole("img").querySelectorAll("text[data-comparison]"),
      ].map((node) => node.textContent);

      expect(within(region).getByTestId("report-delta")).toHaveTextContent("↑ 5 %");
      expect(comparisons).toEqual([
        "Antes ref 0.00 · —",
        "Antes ref 100.00 · ↑ 20 %",
        "Antes — · —",
      ]);
      expect(screen.getByRole("columnheader", { name: "REF anterior" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Variación" })).toBeInTheDocument();
      expect(screen.getByRole("cell", { name: "↑ 20 %" })).toBeInTheDocument();
      expect(document.body.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it("con comparación y el periodo anterior en 0: «—» en el total", () => {
      mockResponses["payment-methods"] = {
        data: page(items, {
          comparison: {
            deltaPct: null,
            deltaPctByMethod: { efectivo_usd: null, pago_movil: null, transferencia: null },
            previous: {
              items: items.map((item) => ({ ...item, amountRef: 0, amountVes: 0, paymentCount: 0 })),
              summary: { paymentCount: 0, totalRef: 0, totalVes: 0 },
            },
            previousRange: { from: "2026-04-21", to: "2026-04-30" },
          },
          summary,
        }),
      };
      renderPanel("payment-methods", { ...MAY, compare: true });

      const delta = within(chartRegion("payment-methods")).getByTestId("report-delta");

      expect(delta).toHaveTextContent("—");
      expect(delta.textContent).not.toMatch(/NaN|Infinity|\d\s?%/);
    });

    it("sin pagos en el rango: estado vacío en vez de barras en 0", () => {
      mockResponses["payment-methods"] = {
        data: page(
          items.map((item) => ({ ...item, amountRef: 0, amountVes: 0, paymentCount: 0 })),
          { summary: { paymentCount: 0, totalRef: 0, totalVes: 0 } },
        ),
      };
      renderPanel("payment-methods");

      const region = chartRegion("payment-methods");

      expect(within(region).getByText("Sin pagos")).toBeInTheDocument();
      expect(within(region).queryByRole("img")).not.toBeInTheDocument();
    });
  });

  describe("reportes sin gráfico", () => {
    it.each(TABLE_ONLY_REPORTS)("%s es solo tabla, sin sección plegable", (id) => {
      mockResponses[id] = { data: page([row(1, 20)]) };
      renderPanel(id);

      expect(screen.getByText(`Resultados: ${getReport(id).name}`)).toBeVisible();
      expect(screen.queryByRole("region", { name: /^Gráfico: / })).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Tabla de datos/ })).not.toBeInTheDocument();
    });

    it.each(["daily-close", "fx-depreciation"] as const)("%s no lleva gráfico ni sección plegable", (id) => {
      renderPanel(id);

      expect(screen.queryByRole("region", { name: /^Gráfico: / })).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Tabla de datos/ })).not.toBeInTheDocument();
    });
  });

  describe("tabla plegable debajo del gráfico", () => {
    function rows(total: number) {
      return page(
        Array.from({ length: 10 }, (_, index) => row(index + 1, index + 1)),
        {},
        total,
      );
    }

    it("en escritorio abre desplegada y se puede plegar; plegada resume los resultados", async () => {
      const user = userEvent.setup();
      mockResponses["top-customers"] = { data: rows(35) };
      renderPanel("top-customers");

      const toggle = screen.getByRole("button", { name: /Tabla de datos/ });

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("Resultados: Top clientes")).toBeVisible();

      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("Resultados: Top clientes")).not.toBeVisible();
      expect(within(toggle).getByText("Mostrando 1-10 de 35 registros")).toBeInTheDocument();
      expect(within(chartRegion("top-customers")).getByRole("img")).toBeInTheDocument();
    });

    it("en móvil abre plegada, con el gráfico a la vista, y se despliega al pulsar", async () => {
      const user = userEvent.setup();
      setViewport("mobile");
      mockResponses["top-customers"] = { data: rows(35) };
      renderPanel("top-customers");

      const toggle = screen.getByRole("button", { name: /Tabla de datos/ });

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("Resultados: Top clientes")).not.toBeVisible();
      expect(within(chartRegion("top-customers")).getByRole("img")).toBeInTheDocument();

      await user.click(toggle);

      expect(screen.getByText("Resultados: Top clientes")).toBeVisible();
    });

    it("la paginación de la tabla plegable sigue escribiendo fuera (URL)", async () => {
      const user = userEvent.setup();
      const setSkip = jest.fn();

      mockResponses["top-customers"] = { data: rows(35) };
      renderPanel("top-customers", MAY, { limit: 10, setLimit: jest.fn(), setSkip, skip: 0 });

      await user.click(screen.getByRole("button", { name: /^Ir a p[aá]gina 2$/ }));

      expect(setSkip).toHaveBeenCalledWith(10);
    });
  });
  describe("REP-F6 · moneda del gráfico y REF en la tabla de compras", () => {
    const request = seriesRequest("from=2026-05-01&to=2026-05-10&groupBy=auto");

    it("el total de la cabecera sigue al conmutador REF / Bs del gráfico", async () => {
      const user = userEvent.setup();

      mockResponses["daily-sales"] = {
        data: page([row(1, 100)], {
          series: buildDailySalesSeries(request, [sale("2026-05-02", 100), sale("2026-05-05", 50)]),
        }),
      };
      renderPanel("daily-sales");

      const region = within(chartRegion("daily-sales"));
      const total = () => region.getByText(/^Total vendido/);

      expect(total()).toHaveTextContent(`Total vendido ${formatRef(150)}`);

      await user.click(region.getByRole("button", { name: "Bs" }));

      expect(region.getByRole("button", { name: "Bs" })).toHaveAttribute("aria-pressed", "true");
      expect(total()).toHaveTextContent(`Total vendido ${formatVesBs(6000)}`);
      expect(total()).not.toHaveTextContent(formatRef(150));

      await user.click(region.getByRole("button", { name: "REF" }));

      expect(total()).toHaveTextContent(`Total vendido ${formatRef(150)}`);
    });

    it("una serie sin importes en Bs (ganancia bruta) deja el total en REF y sin conmutador", () => {
      mockResponses["gross-profit"] = {
        data: page([row(1, 100)], {
          series: buildGrossProfitSeries(request, [
            { day: "2026-05-02", values: { costRef: 60, grossProfitRef: 40, revenueRef: 100 } },
          ]),
        }),
      };
      renderPanel("gross-profit");

      const region = within(chartRegion("gross-profit"));

      expect(region.queryByRole("button", { name: "Bs" })).not.toBeInTheDocument();
      expect(region.getByText(/^Ganancia bruta/, { selector: "p" })).toHaveTextContent(formatRef(40));
    });

    it("la tabla de compras muestra el total en REF junto al de VES, o «—» si la fila no lo trae", () => {
      const withoutRef: Partial<ReturnType<typeof row>> = row(2, 50);

      delete withoutRef.totalRef;

      mockResponses.purchases = {
        data: page([row(1, 100), withoutRef], {
          series: buildPurchasesSeries(request, [
            { day: "2026-05-02", values: { count: 1, totalRef: 100, totalVes: 4000 } },
          ]),
        }),
      };
      renderPanel("purchases");

      const table = within(screen.getByRole("table"));
      const headers = table.getAllByRole("columnheader").map((header) => header.textContent);

      expect(headers).toEqual(expect.arrayContaining(["Total REF", "Total VES"]));
      expect(headers.indexOf("Total REF")).toBeLessThan(headers.indexOf("Total VES"));

      const [first, second] = table.getAllByRole("row").slice(1);

      expect(within(first!).getAllByRole("cell")[headers.indexOf("Total REF")]).toHaveTextContent(
        formatRef(100),
      );
      expect(within(second!).getAllByRole("cell")[headers.indexOf("Total REF")]).toHaveTextContent("—");
    });
  });
});
