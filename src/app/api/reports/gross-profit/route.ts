import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getGrossProfitReport as getGrossProfitReportMock } from "@/modules/reports/services/reports.mock-server";
import { getGrossProfitReport as getGrossProfitReportServer } from "@/modules/reports/services/reports.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getGrossProfitReportServer(searchParams)
        : getGrossProfitReportMock(searchParams);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
