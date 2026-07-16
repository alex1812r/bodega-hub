import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getDashboardMetrics as getDashboardMetricsMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardMetrics as getDashboardMetricsServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "dashboard.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getDashboardMetricsServer(searchParams, auth.storeId)
        : getDashboardMetricsMock(searchParams, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
