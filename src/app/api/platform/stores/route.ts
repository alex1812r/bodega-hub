import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { createStoreSchema } from "@/modules/platform/services/stores.schemas";
import * as storesMockServer from "@/modules/platform/services/stores.mock-server";
import * as storesServer from "@/modules/platform/services/stores.server";

function getStoresService() {
  return resolveDataSource() === "supabase" ? storesServer : storesMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "platform.stores.view");
    return jsonData(await getStoresService().listStores(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "platform.stores.manage");
    const input = createStoreSchema.parse(await request.json());
    return jsonCreated(await getStoresService().createStore(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
