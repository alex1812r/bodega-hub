import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { assertInventoryReportAccess, parseStockAdjustmentsQuery } from "@/modules/reports/services/inventoryReports";
import { getStockAdjustmentsReport as getStockAdjustmentsReportMock } from "@/modules/reports/services/inventoryReports.mock-server";
import { getStockAdjustmentsReport as getStockAdjustmentsReportServer } from "@/modules/reports/services/inventoryReports.server";

/** Ajustes y mermas por motivo y periodo (REP-07). `from` y `to` obligatorios; `groupBy` day | week | month | auto. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    // Además de `reports.view`, el permiso de lectura de Inventario (ver `assertInventoryReportAccess`).
    assertInventoryReportAccess(auth);
    // 400 si los parámetros no son válidos.
    const query = parseStockAdjustmentsQuery(new URL(request.url).searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getStockAdjustmentsReportServer(query, auth.storeId)
        : getStockAdjustmentsReportMock(query, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
