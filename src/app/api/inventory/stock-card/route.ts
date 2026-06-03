import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as inventoryMockServer from "@/modules/inventory/services/inventory.mock-server";
import * as inventoryServer from "@/modules/inventory/services/inventory.server";

function getInventoryService() {
  return resolveDataSource() === "supabase" ? inventoryServer : inventoryMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.view");
    const service = getInventoryService();
    return jsonData(await service.getStockCard(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}
