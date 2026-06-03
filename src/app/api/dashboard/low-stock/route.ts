import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getDashboardLowStock as getDashboardLowStockMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getDashboardLowStock as getDashboardLowStockServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "dashboard.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getDashboardLowStockServer(searchParams)
        : getDashboardLowStockMock(searchParams);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
