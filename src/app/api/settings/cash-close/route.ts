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
 * Umbral de faltante al cerrar caja de la tienda, solo lectura. Lo necesita
 * quien cierra la caja (el cajero no tiene `settings.view`, que es de admin):
 * por eso no va en `GET /api/settings`. Se cambia con `PATCH /api/settings`
 * (`cashCloseDiffAlertVes`).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, [
      "cash.operate",
      "cash.view",
      "settings.view",
    ]);

    return jsonData(await getSettingsService().getCashCloseSettings(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
