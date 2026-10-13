import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { assertMoneyReportAccess, parseAgingQuery } from "@/modules/reports/services/moneyReports";
import { getPayablesAgingReport as getPayablesAgingReportMock } from "@/modules/reports/services/moneyReports.mock-server";
import { getPayablesAgingReport as getPayablesAgingReportServer } from "@/modules/reports/services/moneyReports.server";

/** Cuentas por pagar con antigüedad (REP-06). `bucket`, `contactId`, `skip`, `limit`. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    // Permisos propios del reporte además de `reports.view` (ver `assertMoneyReportAccess`).
    assertMoneyReportAccess("payables-aging", auth);
    // 400 si los parámetros no son válidos.
    const query = parseAgingQuery(new URL(request.url).searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getPayablesAgingReportServer(query, auth.storeId)
        : getPayablesAgingReportMock(query, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
