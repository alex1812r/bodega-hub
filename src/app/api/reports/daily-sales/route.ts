import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { getDailySalesReport as getDailySalesReportMock } from "@/modules/reports/services/reports.mock-server";
import { getDailySalesReport as getDailySalesReportServer } from "@/modules/reports/services/reports.server";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getDailySalesReportServer(searchParams)
        : getDailySalesReportMock(searchParams);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
