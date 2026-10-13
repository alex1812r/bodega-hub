import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { assertInventoryReportAccess, parseDeadStockQuery } from "@/modules/reports/services/inventoryReports";
import { getDeadStockReport as getDeadStockReportMock } from "@/modules/reports/services/inventoryReports.mock-server";
import { getDeadStockReport as getDeadStockReportServer } from "@/modules/reports/services/inventoryReports.server";

/** Productos sin movimiento en N días con su valor a costo (REP-07). `days` 1–3650 (30 por defecto), `categoryId` opcional. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    // Además de `reports.view`, el permiso de lectura de Inventario (ver `assertInventoryReportAccess`).
    assertInventoryReportAccess(auth);
    // 400 si los parámetros no son válidos.
    const query = parseDeadStockQuery(new URL(request.url).searchParams);
    const data =
      resolveDataSource() === "supabase"
        ? await getDeadStockReportServer(query, auth.storeId)
        : getDeadStockReportMock(query, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
