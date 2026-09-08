import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

const service = () => (resolveDataSource() === "supabase" ? server : mock);

/** Estimación viva del cajero para la quincena en curso. No escribe nada. */
export async function GET(request: Request) {
  try {
    const auth = await requireStorePermission(request, "payroll.view_own");

    if (!auth.userId) {
      throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion.");
    }

    return jsonData(
      await service().getMyPayrollCurrent({
        profileId: auth.userId,
        storeId: auth.storeId,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
