import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { assertInventoryReportAccess, parseStockTurnoverQuery } from "@/modules/reports/services/inventoryReports";
import { getStockTurnoverReport as getStockTurnoverReportMock } from "@/modules/reports/services/inventoryReports.mock-server";
import { getStockTurnoverReport as getStockTurnoverReportServer } from "@/modules/reports/services/inventoryReports.server";

/** Rotación de inventario por producto o por categoría (REP-07). `from` y `to` obligatorios; `groupBy` product | category. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    // Además de `reports.view`, el permiso de lectura de Inventario (ver `assertInventoryReportAccess`).
    assertInventoryReportAccess(auth);
    // 400 si los parámetros no son válidos.
    const query = parseStockTurnoverQuery(new URL(request.url).searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getStockTurnoverReportServer(query, auth.storeId)
        : getStockTurnoverReportMock(query, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
