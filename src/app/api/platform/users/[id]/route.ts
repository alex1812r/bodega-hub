import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as usersMockServer from "@/modules/platform/services/users.mock-server";
import * as usersServer from "@/modules/platform/services/users.server";

function getUsersService() {
  return resolveDataSource() === "supabase" ? usersServer : usersMockServer;
}

type UserRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: UserRouteContext) {
  try {
    await requirePermission(request, "platform.users.view");
    const { id } = await context.params;
    return jsonData(await getUsersService().getPlatformUser(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
