import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as exchangeRatesMockServer from "@/modules/settings/services/exchangeRates.mock-server";
import * as exchangeRatesServer from "@/modules/settings/services/exchangeRates.server";

function getExchangeRatesService() {
  return resolveDataSource() === "supabase" ? exchangeRatesServer : exchangeRatesMockServer;
}

export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "dashboard.view");
    const service = getExchangeRatesService();
    return jsonData(await service.getCurrentExchangeRate(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
