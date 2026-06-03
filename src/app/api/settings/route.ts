import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";
import * as settingsServer from "@/modules/settings/services/settings.server";

const settingsSchema = z.object({
  businessName: z.string().min(1).optional(),
  defaultTaxRate: z.number().min(0).optional(),
  invoicePrefix: z.string().min(1).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
});

function getSettingsService() {
  return resolveDataSource() === "supabase" ? settingsServer : settingsMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "settings.view");
    const service = getSettingsService();
    return jsonData(await service.getSettings());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requirePermission(request, "users.manage");
    const input = settingsSchema.parse(await request.json());
    const service = getSettingsService();
    return jsonData(await service.updateSettings(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
