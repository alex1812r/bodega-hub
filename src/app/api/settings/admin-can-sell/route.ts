import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as adminCanSellServer from "@/modules/settings/services/adminCanSell.server";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";

const adminCanSellSchema = z.object({ enabled: z.boolean() });

function getAdminCanSellService() {
  return resolveDataSource() === "supabase" ? adminCanSellServer : settingsMockServer;
}

/**
 * «El administrador puede vender» (POS-02): `sales.create` + `cash.operate`
 * concedidos a los administradores de la tienda. Solo lo ve y lo cambia quien
 * administra usuarios (`users.manage`: el admin de ESA tienda; el superadmin no
 * opera tiendas). La tienda sale de la sesión, nunca del cliente.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "users.manage");

    return jsonData(await getAdminCanSellService().getAdminCanSell(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireStorePermission(request, "users.manage");
    const { enabled } = adminCanSellSchema.parse(await readJsonBody(request));

    return jsonData(await getAdminCanSellService().setAdminCanSell(enabled, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
