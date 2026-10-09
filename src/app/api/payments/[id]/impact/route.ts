import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { PAYMENT_IMPACT_ACTIONS } from "@/modules/payments/services/paymentImpact";
import { getPaymentImpact as getPaymentImpactMock } from "@/modules/payments/services/paymentImpact.mock-server";
import { getPaymentImpact as getPaymentImpactServer } from "@/modules/payments/services/paymentImpact.server";
import { impactJson, parseImpactAction } from "@/shared/impact/impactServer";

/**
 * Efecto de anular el pago (`action=cancel`), sin escribir. Mismo permiso que
 * la anulación real (`payments.manage`) y misma regla de acceso a pagos de
 * compras.
 */
export async function GET(request: Request, context: RouteContext<"/api/payments/[id]/impact">) {
  try {
    const auth = await requireStorePermission(request, "payments.manage");
    const action = parseImpactAction(request, PAYMENT_IMPACT_ACTIONS);
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase"
        ? await getPaymentImpactServer(id, action, auth.storeId, auth.role)
        : getPaymentImpactMock(id, action, auth.storeId, auth.role);

    return impactJson(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
