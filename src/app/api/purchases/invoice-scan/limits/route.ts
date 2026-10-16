import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import type { InvoiceScanLimits } from "@/modules/invoice-scan/contracts";
import { requireInvoiceScanSession } from "@/modules/invoice-scan/server/requireScanSession";
import { createInvoiceScanDeps } from "@/modules/invoice-scan/server/scanService";

/**
 * `GET /api/purchases/invoice-scan/limits`: páginas escaneadas hoy (día
 * operativo Caracas) por la tienda de la sesión frente a la cuota diaria. Lo
 * pinta el modal de escaneo antes de subir nada ("Escaneos hoy: X de Y").
 */
export async function GET(request: Request) {
  try {
    const dataSource = resolveDataSource();
    const ctx = await requireInvoiceScanSession(request, "purchases.create", dataSource);
    const deps = createInvoiceScanDeps(dataSource);
    const limits: InvoiceScanLimits = await deps.repo.getDailyUsage(ctx, deps.dailyLimit, deps.now());

    return jsonData(limits);
  } catch (error) {
    return toErrorResponse(error);
  }
}
