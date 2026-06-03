import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getRecentSales as getRecentSalesMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getRecentSales as getRecentSalesServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "dashboard.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getRecentSalesServer(searchParams)
        : getRecentSalesMock(searchParams);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
