import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getDashboardSalesTrend as getDashboardSalesTrendMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardSalesTrend as getDashboardSalesTrendServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "dashboard.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getDashboardSalesTrendServer(searchParams)
        : getDashboardSalesTrendMock(searchParams);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
