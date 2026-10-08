import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { pricingSettingsSchema } from "@/modules/settings/services/pricingSettings.schemas";
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
  /** Alícuota por defecto para categorías nuevas (`tax_rates.id`); el servicio exige que esté activa. */
  defaultTaxRateId: z.string().trim().min(1).optional(),
  enabledPaymentMethods: z
    .array(paymentMethodSchema)
    .min(1, "Debes habilitar al menos un metodo de pago.")
    .optional(),
  invoicePrefix: z.string().min(1).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  /** Semáforo de ganancia y chips de %: se envía completo (los tres campos). */
  pricing: pricingSettingsSchema.optional(),
});

/**
 * Un rechazo de `pricing` responde 400 con su motivo en español como mensaje
 * (umbrales invertidos, chips repetidos…); el resto conserva la respuesta
 * genérica de validación.
 */
function parseSettingsInput(body: unknown) {
  const parsed = settingsSchema.safeParse(body);

  if (parsed.success) {
    return parsed.data;
  }

  const pricingIssue = parsed.error.issues.find((issue) => issue.path[0] === "pricing");

  if (pricingIssue) {
    throw new ApiError(400, "BAD_REQUEST", pricingIssue.message, { issues: parsed.error.issues });
  }

  throw parsed.error;
}

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
    const input = parseSettingsInput(await request.json());
    const service = getSettingsService();
    return jsonData(await service.updateSettings(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
