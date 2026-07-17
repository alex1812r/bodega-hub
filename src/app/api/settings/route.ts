import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as settingsMockServer from "@/modules/settings/services/settings.mock-server";
import * as settingsServer from "@/modules/settings/services/settings.server";

const paymentMethodSchema = z.enum([
  "efectivo_ves",
  "efectivo_usd",
  "pago_movil",
  "punto_venta",
  "transferencia",
]);

const settingsSchema = z.object({
  businessName: z.string().min(1).optional(),
  defaultTaxRate: z.number().min(0).optional(),
  enabledPaymentMethods: z
    .array(paymentMethodSchema)
    .min(1, "Debes habilitar al menos un metodo de pago.")
    .optional(),
  invoicePrefix: z.string().min(1).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
});

function getSettingsService() {
  return resolveDataSource() === "supabase" ? settingsServer : settingsMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "settings.view");
    const service = getSettingsService();
    return jsonData(await service.getSettings(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireStorePermission(request, "users.manage");
    const input = settingsSchema.parse(await request.json());
    const service = getSettingsService();
    return jsonData(await service.updateSettings(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
