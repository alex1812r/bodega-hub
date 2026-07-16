import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import { createStoreAdminSchema } from "@/modules/platform/services/users.schemas";
import * as usersMockServer from "@/modules/platform/services/users.mock-server";
import * as usersServer from "@/modules/platform/services/users.server";

function getUsersService() {
  return resolveDataSource() === "supabase" ? usersServer : usersMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "platform.users.view");
    return jsonData(await getUsersService().listPlatformUsers(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "platform.users.manage");
    const input = createStoreAdminSchema.parse(await request.json());
    return jsonCreated(await getUsersService().createStoreAdmin(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
