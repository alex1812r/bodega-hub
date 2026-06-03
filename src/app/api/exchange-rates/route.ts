import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonCreated, jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as exchangeRatesMockServer from "@/modules/settings/services/exchangeRates.mock-server";
import * as exchangeRatesServer from "@/modules/settings/services/exchangeRates.server";

const exchangeRateSchema = z.object({
  rateVes: z.number().positive(),
  source: z.string().optional(),
});

function getExchangeRatesService() {
  return resolveDataSource() === "supabase" ? exchangeRatesServer : exchangeRatesMockServer;
}

export async function GET(request: Request) {
  try {
    await requirePermission(request, "dashboard.view");
    const service = getExchangeRatesService();
    return jsonData(await service.listExchangeRates(new URL(request.url).searchParams));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requirePermission(request, "payments.manage");
    const input = exchangeRateSchema.parse(await request.json());
    const service = getExchangeRatesService();
    return jsonCreated(await service.createExchangeRate(input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
