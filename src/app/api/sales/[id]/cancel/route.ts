import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { cancelSale as cancelSaleMock } from "@/modules/sales/services/sales.mock-server";
import { cancelSale as cancelSaleServer } from "@/modules/sales/services/sales.server";

export async function PATCH(request: Request, context: RouteContext<"/api/sales/[id]/cancel">) {
  try {
    const auth = await requireStorePermission(request, "sales.create");
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase"
        ? await cancelSaleServer(id, auth.storeId)
        : cancelSaleMock(id, auth.storeId);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
