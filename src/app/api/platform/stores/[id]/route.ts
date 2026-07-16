import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { updateStoreSchema } from "@/modules/platform/services/stores.schemas";
import * as storesMockServer from "@/modules/platform/services/stores.mock-server";
import * as storesServer from "@/modules/platform/services/stores.server";

function getStoresService() {
  return resolveDataSource() === "supabase" ? storesServer : storesMockServer;
}

type StoreRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: StoreRouteContext) {
  try {
    await requirePermission(request, "platform.stores.view");
    const { id } = await context.params;
    return jsonData(await getStoresService().getStore(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: StoreRouteContext) {
  try {
    await requirePermission(request, "platform.stores.manage");
    const { id } = await context.params;
    const input = updateStoreSchema.parse(await request.json());
    return jsonData(await getStoresService().updateStore(id, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
