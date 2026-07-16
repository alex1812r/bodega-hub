import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

export async function GET(request: Request, context: RouteContext<"/api/purchases/[id]">) {
  try {
    const auth = await requireStorePermission(request, "purchases.view");
    const { id } = await context.params;
    const service = getPurchasesService();
    return jsonData(await service.getPurchaseById(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
