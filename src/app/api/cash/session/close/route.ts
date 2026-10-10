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
 * Cierra quien opera caja (`cash.operate`) o quien administra cajas (`cash.manage`):
 * este último es el admin al que se le apagó «El administrador puede vender» con un
 * turno abierto (POS-02 / caos 7.8). En ambos casos SOLO un turno abierto por uno
 * mismo: `close_cash_session` deja a cualquier admin cerrar el de otro (POS-F3).
 * La pertenencia se decide por el `sessionId` (`opened_by`), no por «el turno
 * actual»: quien tenga varios abiertos por datos previos los cierra uno a uno.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireStoreAnyPermission(request, ["cash.operate", "cash.manage"]);
    const input = schema.parse(await readJsonBody(request));
    const userId = auth.userId ?? "";
    const owner = await service().getCashSessionOwner(input.sessionId, auth.storeId);

    if (!owner) {
      throw new ApiError(404, "NOT_FOUND", mock.CASH_SESSION_NOT_FOUND_MESSAGE);
    }

    if (!userId || owner.openedBy !== userId) {
      throw new ApiError(403, "FORBIDDEN", "No tienes permiso para realizar esta acción.");
    }

    return jsonData(await service().closeCashSession(input, userId, auth.storeId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
