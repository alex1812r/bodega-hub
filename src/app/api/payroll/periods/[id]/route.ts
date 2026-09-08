import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/payroll/services/payroll.mock-server";
import * as server from "@/modules/payroll/services/payroll.server";

type PeriodRouteContext = { params: Promise<{ id: string }> };

const service = () => (resolveDataSource() === "supabase" ? server : mock);

/**
 * El admin ve la quincena completa; el cajero solo su propio recibo (y sin las
 * cifras del negocio: ni ganancia bruta ni desglose del dueño).
 */
export async function GET(request: Request, context: PeriodRouteContext) {
  try {
    const auth = await requireStoreAnyPermission(request, [
      "payroll.manage",
      "payroll.view_own",
    ]);
    const { id } = await context.params;
    const canManage = auth.permissions.includes("payroll.manage");

    // Sin identidad no hay recibo propio que enseñar: mejor un 403 claro que una
    // consulta con `profile_id` vacío, que PostgREST devuelve como 500.
    if (!canManage && !auth.userId) {
      throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion.");
    }

    return jsonData(
      await service().getPayrollPeriodDetail(id, auth.storeId, {
        canManage,
        profileId: auth.userId,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
