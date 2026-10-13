import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getPurchasesReport as getPurchasesReportMock } from "@/modules/reports/services/reports.mock-server";
import { getPurchasesReport as getPurchasesReportServer } from "@/modules/reports/services/reports.server";
import { assertReportSeriesParams } from "@/modules/reports/services/reportSeries";
import { assertReportIdParams } from "@/modules/reports/services/reportParams";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    // 400 si el identificador no tiene forma de id.
    assertReportIdParams(searchParams, { supplierId: "El proveedor" });
    // 400 si `from`/`to`/`groupBy` no son válidos; `status` lo valida el servicio (400).
    assertReportSeriesParams(searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getPurchasesReportServer(searchParams, [auth.storeId])
        : getPurchasesReportMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
