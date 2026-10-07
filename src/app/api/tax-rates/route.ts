import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStoreAnyPermission, requireStorePermission } from "@/lib/api/requirePermission";
import * as taxRatesMockServer from "@/modules/settings/services/taxRates.mock-server";
import { createTaxRateSchema } from "@/modules/settings/services/taxRates.schemas";
import * as taxRatesServer from "@/modules/settings/services/taxRates.server";

function getTaxRatesService() {
  return resolveDataSource() === "supabase" ? taxRatesServer : taxRatesMockServer;
}

export async function GET(request: Request) {
  try {
    // El catalogo lo leen las pantallas de productos y de compras: entre esos
    // permisos y el de Configuracion cubren a todos los roles de tienda.
    const auth = await requireStoreAnyPermission(request, [
      "products.view",
      "purchases.view",
      "settings.view",
    ]);
    const activeOnly = new URL(request.url).searchParams.get("active")?.toLowerCase() === "true";

    return jsonData(await getTaxRatesService().listTaxRates(auth.storeId, { activeOnly }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    // Mismo permiso que guardar Configuracion (PATCH /api/settings): solo admin.
    const auth = await requireStorePermission(request, "users.manage");
    const input = createTaxRateSchema.parse(await readJsonBody(request));

    return jsonCreated(await getTaxRatesService().createTaxRate(input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
