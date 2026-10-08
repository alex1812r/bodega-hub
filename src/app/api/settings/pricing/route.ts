import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";
import * as settingsServer from "@/modules/settings/services/settings.server";

function getSettingsService() {
  return resolveDataSource() === "supabase" ? settingsServer : settingsMockServer;
}

/**
 * Semáforo de ganancia y chips de % de la tienda, solo lectura. Lo necesita
 * cualquiera que vea productos (vendedor y almacén no tienen `settings.view`,
 * que es de admin): por eso no va en `GET /api/settings`. Se cambia con
 * `PATCH /api/settings` (`pricing`).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, ["products.view", "settings.view"]);

    return jsonData(await getSettingsService().getPricingSettings(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
