import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { resolvePlatformReportStoreIds } from "@/modules/platform/services/reportStoreScope";
import * as reportsMock from "@/modules/reports/services/reports.mock-server";
import * as reportsServer from "@/modules/reports/services/reports.server";

const reportHandlers = {
  "customer-purchases": {
    mock: reportsMock.getCustomerPurchasesReport,
    server: reportsServer.getCustomerPurchasesReport,
  },
  "daily-sales": {
    mock: reportsMock.getDailySalesReport,
    server: reportsServer.getDailySalesReport,
  },
  "gross-profit": {
    mock: reportsMock.getGrossProfitReport,
    server: reportsServer.getGrossProfitReport,
  },
  "low-stock": {
    mock: reportsMock.getLowStockReport,
    server: reportsServer.getLowStockReport,
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
