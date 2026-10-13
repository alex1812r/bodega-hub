import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { assertMoneyReportAccess, parseCashCloseDifferencesQuery } from "@/modules/reports/services/moneyReports";
import { getCashCloseDifferencesReport as getCashCloseDifferencesReportMock } from "@/modules/reports/services/moneyReports.mock-server";
import { getCashCloseDifferencesReport as getCashCloseDifferencesReportServer } from "@/modules/reports/services/moneyReports.server";

/** Diferencias de cierre de caja (REP-06). `from`, `to`, `currency`, `skip`, `limit`. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    // Permisos propios del reporte además de `reports.view` (ver `assertMoneyReportAccess`).
    assertMoneyReportAccess("cash-close-differences", auth);
    // 400 si los parámetros no son válidos.
    const query = parseCashCloseDifferencesQuery(new URL(request.url).searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getCashCloseDifferencesReportServer(query, auth.storeId)
        : getCashCloseDifferencesReportMock(query, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
