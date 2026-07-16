import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { resolvePlatformReportStoreIds } from "@/modules/platform/services/reportStoreScope";
import * as dashboardMock from "@/modules/dashboard/services/dashboard.mock-server";
import * as dashboardServer from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "platform.dashboard.view");
    const searchParams = new URL(request.url).searchParams;
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
