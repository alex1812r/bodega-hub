import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSupplierPurchasesReport as getSupplierPurchasesReportMock } from "@/modules/reports/services/reports.mock-server";
import { getSupplierPurchasesReport as getSupplierPurchasesReportServer } from "@/modules/reports/services/reports.server";
import { assertReportDateParams } from "@/modules/reports/services/reportParams";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    // 400 si `from`/`to`/`date` no son fechas válidas o `from > to`.
    assertReportDateParams(searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getSupplierPurchasesReportServer(searchParams, [auth.storeId])
        : getSupplierPurchasesReportMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
