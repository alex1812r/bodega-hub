import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";
import * as settingsServer from "@/modules/settings/services/settings.server";
import { permissions } from "@/shared/auth/permissions";

const permissionSchema = z.enum(permissions);

const userSchema = z.object({
  deniedPermissions: z.array(permissionSchema).optional(),
  grantedPermissions: z.array(permissionSchema).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "vendedor", "almacen", "contador"]).optional(),
});

function getUsersService() {
  return resolveDataSource() === "supabase" ? settingsServer : settingsMockServer;
}

export async function PATCH(request: Request, context: RouteContext<"/api/users/[id]">) {
  try {
    const auth = await requireStorePermission(request, "users.manage");
    const { id } = await context.params;
    const input = userSchema.parse(await request.json());
    const service = getUsersService();
    return jsonData(await service.updateUser(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
