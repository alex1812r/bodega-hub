import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

type PeriodRouteContext = { params: Promise<{ id: string }> };

const service = () => (resolveDataSource() === "supabase" ? server : mock);

/** Aprobar recalcula una última vez y consume las ventas: a partir de aquí ya no comisionan. */
export async function POST(request: Request, context: PeriodRouteContext) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");
    const { id } = await context.params;

    return jsonData(await service().approvePayrollPeriod(id, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
