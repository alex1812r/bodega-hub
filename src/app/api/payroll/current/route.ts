import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

const service = () => (resolveDataSource() === "supabase" ? server : mock);

/** Quincena en curso (estimación viva) y la anterior si ya fue calculada. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payroll.manage");

    return jsonData(await service().getPayrollCurrent(auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
