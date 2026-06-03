import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getDashboardSummary as getDashboardSummaryMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardSummary as getDashboardSummaryServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "dashboard.view");
    const data =
      resolveDataSource() === "supabase"
        ? await getDashboardSummaryServer()
        : getDashboardSummaryMock();

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
