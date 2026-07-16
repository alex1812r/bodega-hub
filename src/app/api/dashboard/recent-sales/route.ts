import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getRecentSales as getRecentSalesMock } from "@/modules/dashboard/services/dashboard.mock-server";
import { getRecentSales as getRecentSalesServer } from "@/modules/dashboard/services/dashboard.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "dashboard.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getRecentSalesServer(searchParams, auth.storeId)
        : getRecentSalesMock(searchParams, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
