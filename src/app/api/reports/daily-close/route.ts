import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getDailyCloseSummary as getDailyCloseSummaryMock } from "@/modules/reports/services/dailyCloseSummary.mock-server";
import { getDailyCloseSummary as getDailyCloseSummaryServer } from "@/modules/reports/services/dailyCloseSummary.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getDailyCloseSummaryServer(searchParams, [auth.storeId])
        : getDailyCloseSummaryMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
