import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getTopProductsReport as getTopProductsReportMock } from "@/modules/reports/services/reports.mock-server";
import { getTopProductsReport as getTopProductsReportServer } from "@/modules/reports/services/reports.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getTopProductsReportServer(searchParams, [auth.storeId])
        : getTopProductsReportMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
