import { z } from "zod";

import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

type ItemRouteContext = { params: Promise<{ id: string }> };

/** La nota es obligatoria: queda en el histórico de la quincena. */
const schema = z.object({
  notes: z.string().trim().min(1).max(500),
});

const service = () => (resolveDataSource() === "supabase" ? server : mock);

export async function POST(request: Request, context: ItemRouteContext) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const { id } = await context.params;
    const input = schema.parse(await request.json());

    return jsonData(await service().cancelPayrollPayment(id, input, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
