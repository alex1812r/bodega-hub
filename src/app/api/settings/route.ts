import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { cashCloseDiffAlertVesSchema } from "@/modules/settings/services/cashCloseSettings.schemas";
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
  /** Faltante en Bs que el cierre de caja debe superar para pedir confirmación (≥ 0). */
  cashCloseDiffAlertVes: cashCloseDiffAlertVesSchema.optional(),
  defaultTaxRate: z.number().min(0).optional(),
  /** Alícuota por defecto para categorías nuevas (`tax_rates.id`); el servicio exige que esté activa. */
  defaultTaxRateId: z.string().trim().min(1).optional(),
  enabledPaymentMethods: z
    .array(paymentMethodSchema)
    .min(1, "Debes habilitar al menos un método de pago.")
    .optional(),
  invoicePrefix: z.string().min(1).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  /** Semáforo de ganancia y chips de %: se envía completo (los tres campos). */
  pricing: pricingSettingsSchema.optional(),
});

/** Campos cuyo rechazo responde 400 con su motivo en español como mensaje. */
const fieldsWithOwnMessage: ReadonlyArray<PropertyKey> = ["pricing", "cashCloseDiffAlertVes"];

/**
 * Un rechazo de `pricing` (umbrales invertidos, chips repetidos…) o de
 * `cashCloseDiffAlertVes` (negativo, no numérico) responde 400 con su motivo en
 * español como mensaje; el resto conserva la respuesta genérica de validación.
 */
function parseSettingsInput(body: unknown) {
  const parsed = settingsSchema.safeParse(body);

  if (parsed.success) {
    return parsed.data;
  }

  const ownMessageIssue = parsed.error.issues.find((issue) =>
    fieldsWithOwnMessage.includes(issue.path[0]),
  );

  if (ownMessageIssue) {
    throw new ApiError(400, "BAD_REQUEST", ownMessageIssue.message, { issues: parsed.error.issues });
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
    const input = parseSettingsInput(await readJsonBody(request));
    const service = getSettingsService();
    return jsonData(await service.updateSettings(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
