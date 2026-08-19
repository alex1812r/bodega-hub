import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getFxDepreciationReport as getFxDepreciationReportMock } from "@/modules/reports/services/fxDepreciationReport.mock-server";
import { getFxDepreciationReport as getFxDepreciationReportServer } from "@/modules/reports/services/fxDepreciationReport.server";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    const data =
      resolveDataSource() === "supabase"
        ? await getFxDepreciationReportServer(searchParams, [auth.storeId])
        : getFxDepreciationReportMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
