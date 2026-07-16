import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as exchangeRatesMockServer from "@/modules/settings/services/exchangeRates.mock-server";
import * as exchangeRatesServer from "@/modules/settings/services/exchangeRates.server";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

/**
 * Tasa de referencia de plataforma (oficial / BCV).
 * Usa la tienda default solo como ancla de persistencia; no opera el ERP.
 */
export async function GET(request: Request) {
  try {
    await requirePermission(request, "platform.dashboard.view");
    const data =
      resolveDataSource() === "supabase"
        ? await exchangeRatesServer.getCurrentExchangeRate(DEFAULT_STORE_ID)
        : exchangeRatesMockServer.getCurrentExchangeRate(DEFAULT_STORE_ID);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
