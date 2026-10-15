import { toErrorResponse, unauthenticatedError } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { createInvoiceScanDeps, discardInvoiceScan } from "@/modules/invoice-scan/server/scanService";

/**
 * `POST /api/purchases/invoice-scan/[id]/discard`: descarta un escaneo aún sin
 * confirmar. 404 si no es de la tienda; 409 si ya no está `extracted`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/purchases/invoice-scan/[id]/discard">,
) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");

    if (!auth.userId) {
      throw unauthenticatedError();
    }

    const { id } = await context.params;
    const discarded = await discardInvoiceScan(
      createInvoiceScanDeps(resolveDataSource()),
      { storeId: auth.storeId, userId: auth.userId },
      id,
    );

    return jsonData(discarded);
  } catch (error) {
    return toErrorResponse(error);
  }
}
