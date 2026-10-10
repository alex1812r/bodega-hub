import { z } from "zod";
import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readJsonBody } from "@/lib/api/readJsonBody";
import { requireStoreAnyPermission } from "@/lib/api/requirePermission";
import * as mock from "@/modules/cash/services/cash.session.mock-server";
import * as server from "@/modules/cash/services/cash.session.server";
const schema = z.object({ closingRef: z.number().nonnegative(), closingVes: z.number().nonnegative(), sessionId: z.string().min(1) });
const service = () => resolveDataSource() === "supabase" ? server : mock;
/**
 * Cierra quien opera caja (`cash.operate`). POS-02 / caos 7.8: quien perdió ese
 * permiso con un turno abierto (se apagó «El administrador puede vender») y
 * administra cajas (`cash.manage`) puede cerrar SOLO su propio turno abierto.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, ["cash.operate", "cash.manage"]);
    const input = schema.parse(await readJsonBody(request));
    const userId = auth.userId ?? "";

    if (!auth.permissions.includes("cash.operate")) {
      const ownSession = await service().getCurrentCashSession(userId, auth.storeId);

      if (ownSession?.id !== input.sessionId) {
        throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta accion.");
      }
    }

    return jsonData(await service().closeCashSession(input, userId, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
