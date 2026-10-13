import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getStockCard as getStockCardMock } from "@/modules/reports/services/reports.mock-server";
import { getStockCard as getStockCardServer } from "@/modules/reports/services/reports.server";
import { assertReportDateParams, assertReportIdParams } from "@/modules/reports/services/reportParams";

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "reports.view");
    const searchParams = new URL(request.url).searchParams;
    // 400 si `from`/`to`/`date` no son fechas válidas o `from > to`.
    assertReportDateParams(searchParams);
    // 400 si el identificador no tiene forma de id.
    assertReportIdParams(searchParams, { productId: "El producto" });
    const data =
      resolveDataSource() === "supabase"
        ? await getStockCardServer(searchParams, [auth.storeId])
        : getStockCardMock(searchParams, [auth.storeId]);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
