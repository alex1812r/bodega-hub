import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as exchangeRatesMockServer from "@/modules/settings/services/exchangeRates.mock-server";
import * as exchangeRatesServer from "@/modules/settings/services/exchangeRates.server";

function getExchangeRatesService() {
  return resolveDataSource() === "supabase" ? exchangeRatesServer : exchangeRatesMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "dashboard.view");
    const service = getExchangeRatesService();
    return jsonData(await service.getCurrentExchangeRate());
  } catch (error) {
    return toErrorResponse(error);
  }
}
