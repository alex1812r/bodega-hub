import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requirePermission } from "@/lib/api/requirePermission";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";

function getPaymentsService() {
  return resolveDataSource() === "supabase" ? paymentsServer : paymentsMockServer;
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/payments/[id]/cancel">,
) {
  try {
    await requirePermission(request, "payments.manage");
    const { id } = await context.params;
    const service = getPaymentsService();
    return jsonData(await service.cancelPayment(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
