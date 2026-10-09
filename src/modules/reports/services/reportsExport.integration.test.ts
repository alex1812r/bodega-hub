/**
 * @jest-environment node
 */

import ExcelJS from "exceljs";

import { getRolePermissions, type UserRole } from "@/shared/auth/permissions";
import { mockStockMovements } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { reportCatalog } from "../reports-list/config/reportCatalog";
import { buildReportsExportPdf } from "./buildReportsExportPdf";
import { buildReportsExportWorkbook } from "./buildReportsExportWorkbook";
import type { ChartImage } from "./captureChartImage";
import { getDailyCloseSummary } from "./dailyCloseSummary.mock-server";
import { fetchReportsForExport, type ReportsExportFilters } from "./fetchReportsForExport";
import { getFxDepreciationReport } from "./fxDepreciationReport.mock-server";
import {
  parseDeadStockQuery,
  parseStockAdjustmentsQuery,
  parseStockTurnoverQuery,
} from "./inventoryReports";
import * as inventoryMock from "./inventoryReports.mock-server";
import {
  parseAgingQuery,
  parseCashCloseDifferencesQuery,
  parseMoneyReportRange,
} from "./moneyReports";
import * as moneyMock from "./moneyReports.mock-server";
import * as reportsMock from "./reports.mock-server";

/**
 * REP-08 · «no debe romperse»: la exportación completa contra los datos del
 * mock, de punta a punta. Un BFF de prueba sirve cada ruta con su servicio
 * mock real; el PDF y el libro se construyen de verdad y se vuelven a abrir.
 */

const STORE_ID = DEFAULT_STORE_ID;
const PRODUCT_ID = mockStockMovements[0]!.productId;
const range = { from: "2025-06-01", to: "2026-05-18" };
const exportedAt = "2026-05-18T16:00:00.000Z";

/** PNG válido de 1 × 1, como el que devuelve la captura del gráfico. */
const chartImage: ChartImage = {
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  height: 480,
  width: 960,
};

type Handler = (searchParams: URLSearchParams) => unknown;

const stores = [STORE_ID];
const handlers: Record<string, Handler> = {
  "cash-close-differences": (params) =>
    moneyMock.getCashCloseDifferencesReport(parseCashCloseDifferencesQuery(params), STORE_ID),
  "customer-purchases": (params) => reportsMock.getCustomerPurchasesReport(params, stores),
  "daily-close": (params) => getDailyCloseSummary(params, stores),
  "daily-sales": (params) => reportsMock.getDailySalesReport(params, stores),
  "dead-stock": (params) => inventoryMock.getDeadStockReport(parseDeadStockQuery(params), STORE_ID),
  "fx-depreciation": (params) => getFxDepreciationReport(params, stores),
  "gross-profit": (params) => reportsMock.getGrossProfitReport(params, stores),
  "low-stock": (params) => reportsMock.getLowStockReport(params, stores),
  "payables-aging": (params) =>
    moneyMock.getPayablesAgingReport(parseAgingQuery(params), STORE_ID),
  "payment-methods": (params) => reportsMock.getPaymentMethodsReport(params, stores),
  "product-profitability": (params) => reportsMock.getProductProfitabilityReport(params, stores),
  purchases: (params) => reportsMock.getPurchasesReport(params, stores),
  "receivables-aging": (params) =>
    moneyMock.getReceivablesAgingReport(parseAgingQuery(params), STORE_ID),
  "sales-by-category": (params) =>
    moneyMock.getSalesByCategoryReport(parseMoneyReportRange(params), STORE_ID),
  "sales-by-hour": (params) =>
    moneyMock.getSalesByHourReport(parseMoneyReportRange(params), STORE_ID),
  settings: () => ({ businessName: "Bodega Demo" }),
  "stock-adjustments": (params) =>
    inventoryMock.getStockAdjustmentsReport(parseStockAdjustmentsQuery(params), STORE_ID),
  "stock-card": (params) => reportsMock.getStockCard(params, stores),
  "stock-turnover": (params) =>
    inventoryMock.getStockTurnoverReport(parseStockTurnoverQuery(params), STORE_ID),
  "supplier-purchases": (params) => reportsMock.getSupplierPurchasesReport(params, stores),
  "top-customers": (params) => reportsMock.getTopCustomersReport(params, stores),
  "top-products": (params) => reportsMock.getTopProductsReport(params, stores),
};

function installMockBff() {
  const requested: string[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const slug = url.pathname.split("/").pop() ?? "";
    const handler = handlers[slug];

    requested.push(slug);

    if (!handler) {
      throw new Error(`Ruta sin servicio mock: ${url.pathname}`);
    }

    return {
      headers: { get: () => "application/json" },
      json: async () => ({ data: handler(url.searchParams) }),
      ok: true,
      status: 200,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return requested;
}

function filtersFor(role: UserRole | null, activeReportId = "daily-sales"): ReportsExportFilters {
  return {
    dateFilters: range,
    purchasesFilters: range,
    stockCardFilters: { productId: PRODUCT_ID },
    view: role
      ? {
          activeReportId,
          compare: true,
          viewer: { permissions: getRolePermissions(role), role },
        }
      : undefined,
  };
}

async function reopen(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  return workbook;
}

function pdfHeader(pdf: ReturnType<typeof buildReportsExportPdf>) {
  return String.fromCharCode(...new Uint8Array(pdf.output("arraybuffer")).slice(0, 4));
}

const MULTI_STORE_NAMES = reportCatalog.map((report) => report.name);
const STORE_ONLY_NAMES = [
  "Ventas por hora y día de la sem",
  "Ventas y margen por categoría",
  "Cuentas por cobrar",
  "Cuentas por pagar",
  "Diferencias de cierre de caja",
  "Productos sin movimiento",
  "Rotación de inventario",
  "Ajustes y mermas",
];

describe("exportación de reportes con los datos del mock (REP-08)", () => {
  it("los 13 reportes de siempre se generan y abren, sin imagen", async () => {
    installMockBff();
    const filters = filtersFor(null);
    const data = await fetchReportsForExport(filters);

    // Hay datos de verdad que exportar.
    expect(data.dailySales.length).toBeGreaterThan(0);
    expect(data.purchases.length).toBeGreaterThan(0);
    expect(data.stockCard.length).toBeGreaterThan(0);

    const pdf = buildReportsExportPdf(data, { exportedAt, filters });

    expect(pdfHeader(pdf)).toBe("%PDF");
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(13);

    const workbook = await reopen(await buildReportsExportWorkbook(data, { exportedAt, filters }));

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(MULTI_STORE_NAMES);
    expect(workbook.worksheets.flatMap((worksheet) => worksheet.getImages())).toEqual([]);
  });

  it("un admin exporta además los reportes de dinero e inventario: 21 hojas que abren", async () => {
    const requested = installMockBff();
    const filters = filtersFor("admin");
    const data = await fetchReportsForExport(filters);

    expect(new Set(requested)).toEqual(new Set(Object.keys(handlers)));

    // jspdf-autotable avisa por consola cuando una tabla no cabe a lo ancho y se corta.
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const pdf = buildReportsExportPdf(data, { exportedAt, filters });

    expect(log.mock.calls.flat().join(" ")).not.toMatch(/could not fit page/);
    log.mockRestore();
    expect(pdfHeader(pdf)).toBe("%PDF");
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(21);

    const workbook = await reopen(await buildReportsExportWorkbook(data, { exportedAt, filters }));

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      ...MULTI_STORE_NAMES,
      ...STORE_ONLY_NAMES,
    ]);
    // 352 días sin `groupBy` en la URL: la agrupación automática es por semana.
    expect(workbook.getWorksheet("Ventas diarias")?.getCell("A3").value).toBe("Agrupación: Semana");
    expect(workbook.getWorksheet("Ventas diarias")?.getCell("A4").value).toBe(
      "Comparado con periodo anterior",
    );
    expect(workbook.getWorksheet("Ventas diarias")?.getCell("A5").value).toBe("Tienda: Bodega Demo");
  });

  it("con la imagen del gráfico, el PDF y el Excel siguen siendo válidos y la llevan una vez", async () => {
    installMockBff();
    const filters = filtersFor("admin", "gross-profit");
    const data = await fetchReportsForExport(filters);
    const metadata = { chartImage, exportedAt, filters };

    const pdf = buildReportsExportPdf(data, metadata);
    const pdfBytes = Buffer.from(pdf.output("arraybuffer")).toString("latin1");

    expect(pdfBytes.startsWith("%PDF")).toBe(true);
    expect(pdfBytes).toContain("/Subtype /Image");
    expect(pdfBytes.trimEnd().endsWith("%%EOF")).toBe(true);

    const workbook = await reopen(await buildReportsExportWorkbook(data, metadata));
    const withImages = workbook.worksheets.filter((worksheet) => worksheet.getImages().length > 0);

    expect(workbook.worksheets).toHaveLength(21);
    expect(withImages.map((worksheet) => worksheet.name)).toEqual(["Ganancia bruta"]);
    expect(withImages[0]?.getImages()).toHaveLength(1);
  });

  it("un contador no pide ni exporta los reportes de inventario", async () => {
    const requested = installMockBff();
    const filters = filtersFor("contador");
    const data = await fetchReportsForExport(filters);
    const workbook = await reopen(await buildReportsExportWorkbook(data, { exportedAt, filters }));

    expect(requested).not.toContain("dead-stock");
    expect(requested).not.toContain("stock-turnover");
    expect(requested).not.toContain("stock-adjustments");
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      ...MULTI_STORE_NAMES,
      ...STORE_ONLY_NAMES.slice(0, 5),
    ]);
  });

  it("«Cierre del día» y «Depreciación FX» exportan las mismas cifras que su servicio", async () => {
    installMockBff();
    const filters = filtersFor("admin");
    const data = await fetchReportsForExport(filters);
    const params = new URLSearchParams(range);
    const summary = getDailyCloseSummary(params, stores);
    const fx = getFxDepreciationReport(new URLSearchParams({ ...range, limit: "100" }), stores);

    expect(data.dailyClose).toEqual([
      { metric: "Ventas", value: summary.sales.salesCount },
      { metric: "Total REF", value: summary.sales.totalRef },
      { metric: "Total VES", value: summary.sales.totalVes },
      { metric: "Pagos activos", value: summary.paymentsSummary.paymentCount },
      { metric: "Cobros REF", value: summary.paymentsSummary.totalRef },
      { metric: "Perdida FX REF", value: summary.fx.vesLossRef },
      { metric: "Capital REF hoy", value: summary.fx.capitalRefToday },
      { metric: "Baul REF", value: summary.vault ? summary.vault.balanceRef : "N/D" },
      { metric: "Caja teorica REF", value: summary.cash ? summary.cash.theoreticalOpenRef : "N/D" },
    ]);
    expect(data.fxDepreciation).toHaveLength(fx.total);
    expect(data.fxDepreciation.slice(0, fx.items.length)).toEqual(fx.items);
    expect(data.fxDepreciationNote).toBe(
      `Tasa valorizacion ${fx.summary.valuationRateVes}; capital hoy REF ${fx.summary.capitalRefToday}; perdida VES REF ${fx.summary.vesLossRef} (${fx.summary.depreciationPctOnVes}%).`,
    );

    // Y esas cifras son las que quedan escritas en el libro.
    const workbook = await reopen(await buildReportsExportWorkbook(data, { exportedAt, filters }));
    const dailyClose = workbook.getWorksheet("Cierre del día");
    const written: unknown[][] = [];

    dailyClose?.eachRow((row) => written.push([row.getCell(1).value, row.getCell(2).value]));

    expect(written.slice(-data.dailyClose.length)).toEqual(
      data.dailyClose.map((row) => [row.metric, row.value]),
    );
  });

  it("el kardex exportado nombra el producto, no su id", async () => {
    installMockBff();
    const filters = filtersFor("admin", "stock-card");
    const data = await fetchReportsForExport(filters);
    const workbook = await reopen(await buildReportsExportWorkbook(data, { exportedAt, filters }));
    const header = String(workbook.getWorksheet("Kardex de producto")?.getCell("A2").value);

    expect(header).toMatch(/^Producto: .+/);
    expect(header).not.toContain(PRODUCT_ID);
    expect(header).not.toBe("Producto: seleccionado");
  });
});
