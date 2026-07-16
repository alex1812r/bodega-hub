import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getDashboardSummary as getDashboardSummaryMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardSummary as getDashboardSummaryServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "dashboard.view");
    const data =
      resolveDataSource() === "supabase"
        ? await getDashboardSummaryServer(auth.storeId)
        : getDashboardSummaryMock(auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
