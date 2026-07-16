import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as paymentsMockServer from "@/modules/payments/services/payments.mock-server";
import * as paymentsServer from "@/modules/payments/services/payments.server";

const updatePaymentSchema = z.object({
  bankName: z.string().optional(),
  notes: z.string().optional(),
  phone: z.string().optional(),
  referenceCode: z.string().optional(),
});

function getPaymentsService() {
  return resolveDataSource() === "supabase" ? paymentsServer : paymentsMockServer;
}

export async function GET(request: Request, context: RouteContext<"/api/payments/[id]">) {
  try {
    const auth = await requireStorePermission(request, "payments.view");
    const { id } = await context.params;
    const service = getPaymentsService();
    return jsonData(await service.getPaymentById(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/payments/[id]">) {
  try {
    const auth = await requireStorePermission(request, "payments.manage");
    const { id } = await context.params;
    const input = updatePaymentSchema.parse(await request.json());
    const service = getPaymentsService();
    return jsonData(await service.updatePayment(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
