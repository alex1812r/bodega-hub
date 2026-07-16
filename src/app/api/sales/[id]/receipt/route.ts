import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSaleReceipt as getSaleReceiptMock } from "@/modules/sales/services/sales.mock-server";
import { getSaleReceipt as getSaleReceiptServer } from "@/modules/sales/services/sales.server";

export async function GET(request: Request, context: RouteContext<"/api/sales/[id]/receipt">) {
  try {
    const auth = await requireStorePermission(request, "sales.view");
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase"
        ? await getSaleReceiptServer(id, auth.storeId)
        : getSaleReceiptMock(id, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
