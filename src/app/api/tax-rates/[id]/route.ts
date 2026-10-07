import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as taxRatesMockServer from "@/modules/settings/services/taxRates.mock-server";
import { updateTaxRateSchema } from "@/modules/settings/services/taxRates.schemas";
import * as taxRatesServer from "@/modules/settings/services/taxRates.server";

function getTaxRatesService() {
  return resolveDataSource() === "supabase" ? taxRatesServer : taxRatesMockServer;
}

export async function PATCH(request: Request, context: RouteContext<"/api/tax-rates/[id]">) {
  try {
    // Mismo permiso que guardar Configuracion (PATCH /api/settings): solo admin.
    const auth = await requireStorePermission(request, "users.manage");
    const { id } = await context.params;
    const input = updateTaxRateSchema.parse(await readJsonBody(request));

    return jsonData(await getTaxRatesService().updateTaxRate(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
