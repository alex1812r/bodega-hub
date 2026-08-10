import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { convertPackToUnitsSchema } from "@/modules/products/services/packConversionSchemas";
import * as inventoryMockServer from "@/modules/inventory/services/inventory.mock-server";
import * as inventoryServer from "@/modules/inventory/services/inventory.server";

function getInventoryService() {
  return resolveDataSource() === "supabase" ? inventoryServer : inventoryMockServer;
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "inventory.manage");
    const input = convertPackToUnitsSchema.parse(await request.json());
    const service = getInventoryService();
    return jsonCreated(await service.convertPackToUnits(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
