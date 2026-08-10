import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { createStoreUserSchema } from "@/modules/settings/services/createStoreUserSchema";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";
import * as settingsServer from "@/modules/settings/services/settings.server";

function getUsersService() {
  return resolveDataSource() === "supabase" ? settingsServer : settingsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "users.manage");
    const service = getUsersService();
    return jsonData(await service.listUsers(new URL(request.url).searchParams, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireStorePermission(request, "users.manage");
    const input = createStoreUserSchema.parse(await request.json());
    const service = getUsersService();
    return jsonCreated(await service.createUser(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
