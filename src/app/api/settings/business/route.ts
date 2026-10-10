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
 * Nombre del negocio, solo lectura. Lo imprimen el recibo de venta y el recibo
 * de nómina, que abren vendedor y contador sin `settings.view` (de admin): por
 * eso no va en `GET /api/settings`. Se cambia con `PATCH /api/settings`
 * (`businessName`).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, [
      "sales.view",
      "payroll.view_own",
      "settings.view",
    ]);

    return jsonData(await getSettingsService().getBusinessSettings(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
