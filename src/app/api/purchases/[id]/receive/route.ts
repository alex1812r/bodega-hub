import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { readOptionalJsonBody } from "@/lib/api/readJsonBody";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { receivePurchaseBodySchema } from "@/modules/purchases/services/purchaseDisassemble";
import * as purchasesMockServer from "@/modules/purchases/services/purchases.mock-server";
import * as purchasesServer from "@/modules/purchases/services/purchases.server";

function getPurchasesService() {
  return resolveDataSource() === "supabase" ? purchasesServer : purchasesMockServer;
}

/**
 * Recibe un pedido. COM-14: en la misma operación abre los empaques de las líneas
 * marcadas «Desarmar al recibir»; `disassemble` (opcional) sustituye las marcas del
 * pedido y puede traer el reparto real de un surtido; `clientRequestId` (opcional)
 * hace idempotente el reintento. La tienda sale de la sesión, nunca del cuerpo.
 * El cuerpo es opcional: sin cuerpo se recibe como siempre (y se desarman las
 * líneas que el pedido guardó marcadas). Un cuerpo que no es JSON es un 400.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/purchases/[id]/receive">,
) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const { id } = await context.params;
    const options = receivePurchaseBodySchema.parse(await readOptionalJsonBody(request));
    const service = getPurchasesService();
    return jsonData(await service.receivePurchase(id, auth.storeId, options));
  } catch (error) {
    return toErrorResponse(error);
  }
}
