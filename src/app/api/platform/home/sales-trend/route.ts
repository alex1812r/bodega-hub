import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { resolvePlatformReportStoreIds } from "@/modules/platform/services/reportStoreScope";
import * as dashboardMock from "@/modules/dashboard/services/dashboard.mock-server";
import * as dashboardServer from "@/modules/dashboard/services/dashboard.server";
import { assertReportDateParams } from "@/modules/reports/services/reportParams";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "platform.dashboard.view");
    const searchParams = new URL(request.url).searchParams;
    // 400 si `from`/`to`/`date` no son fechas válidas o `from > to` (como `/api/dashboard/sales-trend`).
    assertReportDateParams(searchParams);
    const storeIds = await resolvePlatformReportStoreIds(searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await dashboardServer.getDashboardSalesTrend(searchParams, storeIds, { useAdmin: true })
        : dashboardMock.getDashboardSalesTrend(searchParams, storeIds);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
