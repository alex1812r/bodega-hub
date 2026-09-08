import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

type PeriodRouteContext = { params: Promise<{ id: string }> };

const service = () => (resolveDataSource() === "supabase" ? server : mock);

/** Solo un borrador se recalcula: aprobado o pagado responde 409. */
export async function POST(request: Request, context: PeriodRouteContext) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const { id } = await context.params;

    return jsonData(await service().recomputePayrollPeriod(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
