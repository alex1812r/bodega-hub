import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { resolvePlatformReportStoreIds } from "@/modules/platform/services/reportStoreScope";
import * as reportsMock from "@/modules/reports/services/reports.mock-server";
import * as reportsServer from "@/modules/reports/services/reports.server";
import { getDailyCloseSummary as getDailyCloseSummaryMock } from "@/modules/reports/services/dailyCloseSummary.mock-server";
import { getDailyCloseSummary as getDailyCloseSummaryServer } from "@/modules/reports/services/dailyCloseSummary.server";
import { assertReportDateParams, assertReportIdParams } from "@/modules/reports/services/reportParams";
import { assertReportSeriesParams, parseReportSeriesParams } from "@/modules/reports/services/reportSeries";

const reportHandlers = {
  "customer-purchases": {
    mock: reportsMock.getCustomerPurchasesReport,
    server: reportsServer.getCustomerPurchasesReport,
  },
  "daily-close": {
    mock: getDailyCloseSummaryMock,
    server: getDailyCloseSummaryServer,
  },
  "daily-sales": {
    mock: reportsMock.getDailySalesReport,
    server: reportsServer.getDailySalesReport,
  },
  "fx-depreciation": {
    mock: reportsMock.getFxDepreciationReport,
    server: reportsServer.getFxDepreciationReport,
  },
  "gross-profit": {
    mock: reportsMock.getGrossProfitReport,
    server: reportsServer.getGrossProfitReport,
  },
  "low-stock": {
    mock: reportsMock.getLowStockReport,
    server: reportsServer.getLowStockReport,
  },
  "payment-methods": {
    mock: reportsMock.getPaymentMethodsReport,
    server: reportsServer.getPaymentMethodsReport,
  },
  "product-profitability": {
    mock: reportsMock.getProductProfitabilityReport,
    server: reportsServer.getProductProfitabilityReport,
  },
  purchases: {
    mock: reportsMock.getPurchasesReport,
    server: reportsServer.getPurchasesReport,
  },
  "stock-card": {
    mock: reportsMock.getStockCard,
    server: reportsServer.getStockCard,
  },
  "supplier-purchases": {
    mock: reportsMock.getSupplierPurchasesReport,
    server: reportsServer.getSupplierPurchasesReport,
  },
  "top-customers": {
    mock: reportsMock.getTopCustomersReport,
    server: reportsServer.getTopCustomersReport,
  },
  "top-products": {
    mock: reportsMock.getTopProductsReport,
    server: reportsServer.getTopProductsReport,
  },
} as const;

type PlatformReportId = keyof typeof reportHandlers;

/**
 * Validación de entrada de cada reporte: la MISMA que hace su ruta de tienda
 * (`/api/reports/<reporte>`, REP-F7) antes de llamar al servicio. 400 si una
 * fecha no es un día real con el año en 2000..actual+1, si `from > to` o si un
 * id no tiene forma de id. `low-stock` no recibe fechas ni ids.
 */
const reportValidators: Record<PlatformReportId, (searchParams: URLSearchParams) => void> = {
  "customer-purchases": assertReportDateParams,
  "daily-close": assertReportDateParams,
  "daily-sales": assertReportSeriesParams,
  "fx-depreciation": assertReportDateParams,
  "gross-profit": assertReportSeriesParams,
  "low-stock": () => undefined,
  "payment-methods": (searchParams) => {
    parseReportSeriesParams(searchParams);
  },
  "product-profitability": assertReportDateParams,
  purchases: (searchParams) => {
    assertReportIdParams(searchParams, { supplierId: "El proveedor" });
    assertReportSeriesParams(searchParams);
  },
  "stock-card": (searchParams) => {
    assertReportDateParams(searchParams);
    assertReportIdParams(searchParams, { productId: "El producto" });
  },
  "supplier-purchases": assertReportDateParams,
  "top-customers": assertReportDateParams,
  "top-products": assertReportDateParams,
};

type RouteContext = { params: Promise<{ report: string }> };

function isPlatformReportId(value: string): value is PlatformReportId {
  return value in reportHandlers;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await requirePermission(request, "platform.reports.view");
    const { report } = await context.params;

    if (!isPlatformReportId(report)) {
      throw new ApiError(404, "NOT_FOUND", "Reporte no encontrado.");
    }

    const searchParams = new URL(request.url).searchParams;
    reportValidators[report](searchParams);
    const storeIds = await resolvePlatformReportStoreIds(searchParams);
    const handler = reportHandlers[report];
    const data =
      resolveDataSource() === "supabase"
        ? await handler.server(searchParams, storeIds, { useAdmin: true })
        : handler.mock(searchParams, storeIds);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
