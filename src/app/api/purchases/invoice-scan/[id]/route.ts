import { toErrorResponse, unauthenticatedError } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import { createInvoiceScanDeps, getInvoiceScanDetail } from "@/modules/invoice-scan/server/scanService";

/**
 * `GET /api/purchases/invoice-scan/[id]`: escaneo de la tienda de la sesión con
 * URLs firmadas de lectura (5 min) de cada página. 404 si no existe en la tienda.
 * Lo abre quien ve compras o quien las crea (la revisión del escaneo; M-q2005-1).
 */
export async function GET(request: Request, context: RouteContext<"/api/purchases/invoice-scan/[id]">) {
  try {
    const auth = await requireStoreAnyPermission(request, ["purchases.view", "purchases.create"]);

    if (!auth.userId) {
      throw unauthenticatedError();
    }

    const { id } = await context.params;
    const detail = await getInvoiceScanDetail(
      createInvoiceScanDeps(resolveDataSource()),
      { storeId: auth.storeId, userId: auth.userId },
      id,
    );

    return jsonData(detail);
  } catch (error) {
    return toErrorResponse(error, { zodIssues: "public" });
  }
}
