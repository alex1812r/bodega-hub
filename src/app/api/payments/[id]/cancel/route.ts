import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
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
    const auth = await requireStorePermission(request, "payments.manage");
    const { id } = await context.params;
    const service = getPaymentsService();
    return jsonData(await service.cancelPayment(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
