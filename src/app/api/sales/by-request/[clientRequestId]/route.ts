import { z } from "zod";

import { resolveDataSource } from "@/lib/api/dataSource";
import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { getSaleByClientRequestId as getSaleByClientRequestIdMock } from "@/modules/sales/services/sales.mock-server";
import { getSaleByClientRequestId as getSaleByClientRequestIdServer } from "@/modules/sales/services/sales.server";

const clientRequestIdSchema = z.string().uuid();

/**
 * Venta registrada con una clave de idempotencia. El POS la consulta cuando se
 * pierde la respuesta de `POST /api/sales` para saber si la venta llego a
 * crearse antes de dejar reintentar. Mismos permisos, filtro de tienda y forma
 * que `GET /api/sales/[id]`; solo ventas del propio usuario salvo admin.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/sales/by-request/[clientRequestId]">,
) {
  try {
    const auth = await requireStorePermission(request, "sales.view");
    const { clientRequestId: rawClientRequestId } = await context.params;
    const clientRequestId = clientRequestIdSchema.parse(rawClientRequestId);
    const viewer = { role: auth.role, userId: auth.userId };
    const data =
      resolveDataSource() === "supabase"
        ? await getSaleByClientRequestIdServer(clientRequestId, auth.storeId, viewer)
        : getSaleByClientRequestIdMock(clientRequestId, auth.storeId, viewer);

    return jsonData(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
