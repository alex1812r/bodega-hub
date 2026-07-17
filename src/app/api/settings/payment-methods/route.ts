import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";
import * as settingsServer from "@/modules/settings/services/settings.server";

function getSettingsService() {
  return resolveDataSource() === "supabase" ? settingsServer : settingsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, [
      "sales.create",
      "payments.manage",
    ]);
    const settings = await getSettingsService().getSettings(auth.storeId);

    return jsonData({
      enabledPaymentMethods: settings.enabledPaymentMethods,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
