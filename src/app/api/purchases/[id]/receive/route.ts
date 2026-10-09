import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { receivePurchaseBodySchema } from "@/modules/purchases/services/purchaseDisassemble";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

/**
 * El cuerpo es opcional: sin cuerpo se recibe como siempre (y se desarman las
 * líneas que el pedido guardó marcadas). Un cuerpo que no es JSON es un 400.
 */
async function readOptionalBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (text.trim() === "") {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "El cuerpo de la solicitud no es un JSON válido.");
  }
}

/**
 * Recibe un pedido. COM-14: en la misma operación abre los empaques de las líneas
 * marcadas «Desarmar al recibir»; `disassemble` (opcional) sustituye las marcas del
 * pedido y puede traer el reparto real de un surtido; `clientRequestId` (opcional)
 * hace idempotente el reintento. La tienda sale de la sesión, nunca del cuerpo.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/purchases/[id]/receive">,
) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const { id } = await context.params;
    const options = receivePurchaseBodySchema.parse(await readOptionalBody(request));
    const service = getPurchasesService();
    return jsonData(await service.receivePurchase(id, auth.storeId, options));
  } catch (error) {
    return toErrorResponse(error);
  }
}
