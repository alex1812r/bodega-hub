import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { SALE_IMPACT_ACTIONS } from "@/modules/sales/services/saleImpact";
import { getSaleImpact as getSaleImpactMock } from "@/modules/sales/services/saleImpact.mock-server";
import { getSaleImpact as getSaleImpactServer } from "@/modules/sales/services/saleImpact.server";
import { impactLedgerAccess } from "@/shared/impact/impactAccess";
import { impactJson, parseImpactAction } from "@/shared/impact/impactServer";

/**
 * Efecto de anular (`action=cancel`) o devolver (`action=return`) la venta, sin
 * escribir. Mismo permiso que las acciones reales (`sales.create`). El saldo
 * del baúl solo viaja con `vault.view` y el detalle de la caja con `cash.view`.
 */
export async function GET(request: Request, context: RouteContext<"/api/sales/[id]/impact">) {
  try {
    const auth = await requireStorePermission(request, "sales.create");
    const action = parseImpactAction(request, SALE_IMPACT_ACTIONS);
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase"
        ? await getSaleImpactServer(id, action, auth.storeId, impactLedgerAccess(auth.permissions))
        : getSaleImpactMock(id, action, auth.storeId);

    return impactJson(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
