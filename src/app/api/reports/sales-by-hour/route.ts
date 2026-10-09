import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { assertMoneyReportAccess, parseMoneyReportRange } from "@/modules/reports/services/moneyReports";
import { getSalesByHourReport as getSalesByHourReportMock } from "@/modules/reports/services/moneyReports.mock-server";
import { getSalesByHourReport as getSalesByHourReportServer } from "@/modules/reports/services/moneyReports.server";

/** Ventas por hora del día y día de la semana (REP-06). `from` y `to` obligatorios. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    // Permisos propios del reporte además de `reports.view` (ver `assertMoneyReportAccess`).
    assertMoneyReportAccess("sales-by-hour", auth);
    // 400 si los parámetros no son válidos.
    const query = parseMoneyReportRange(new URL(request.url).searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getSalesByHourReportServer(query, auth.storeId)
        : getSalesByHourReportMock(query, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
