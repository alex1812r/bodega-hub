import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

export async function POST(request: Request, context: RouteContext<"/api/purchases/[id]/return">) {
  try {
    await requirePermission(request, "purchases.create");
    const { id } = await context.params;
    const service = getPurchasesService();
    return jsonData(await service.returnPurchase(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
