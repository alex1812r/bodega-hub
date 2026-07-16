import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as inventoryMockServer from "@/modules/inventory/services/inventory.mock-server";
import * as inventoryServer from "@/modules/inventory/services/inventory.server";

function getInventoryService() {
  return resolveDataSource() === "supabase" ? inventoryServer : inventoryMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "inventory.view");
    const service = getInventoryService();
    return jsonData(await service.listStockMovements(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
