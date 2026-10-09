import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { requireStorePermission } from "@/lib/api/requirePermission";
import { receivePurchaseBodySchema } from "@/modules/purchases/services/purchaseDisassemble";
import {
  PURCHASE_IMPACT_ACTIONS,
  type PurchaseImpactAction,
} from "@/modules/purchases/services/purchaseImpact";
import { getPurchaseImpact as getPurchaseImpactMock } from "@/modules/purchases/services/purchaseImpact.mock-server";
import { getPurchaseImpact as getPurchaseImpactServer } from "@/modules/purchases/services/purchaseImpact.server";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import { impactJson, parseImpactAction } from "@/shared/impact/impactServer";

const disassembleSchema = receivePurchaseBodySchema.shape.disassemble;

/**
 * `?disassemble=` (opcional, solo `action=receive`): la misma lista que viajará
 * en el cuerpo de `PATCH /receive`, como JSON y validada con su mismo esquema.
 * Ausente = se usan las marcas guardadas con el pedido.
 */
function parseDisassemble(request: Request, action: PurchaseImpactAction) {
  const values = new URL(request.url).searchParams.getAll("disassemble");

  if (values.length === 0) {
    return null;
  }

  if (values.length > 1 || action !== "receive") {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "El parametro disassemble va una sola vez y solo con action=receive.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(values[0]);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "El parametro disassemble no es un JSON válido.");
  }

  return disassembleSchema.unwrap().parse(parsed);
}

/**
 * Efecto de recibir (`action=receive`), cancelar (`cancel`) o devolver
 * (`return`) la compra, sin escribir. Mismo permiso que las tres acciones
 * reales (`purchases.create`). Las líneas de pago solo viajan a quien puede ver
 * pagos de compras (admin, contador); el veredicto es el mismo para todos.
 */
export async function GET(request: Request, context: RouteContext<"/api/purchases/[id]/impact">) {
  try {
    const auth = await requireStorePermission(request, "purchases.create");
    const action = parseImpactAction(request, PURCHASE_IMPACT_ACTIONS);
    const options = {
      canViewPayments: canViewPurchasePayments(auth.role),
      disassemble: parseDisassemble(request, action),
    };
    const { id } = await context.params;
    const data =
      resolveDataSource() === "supabase"
        ? await getPurchaseImpactServer(id, action, auth.storeId, options)
        : getPurchaseImpactMock(id, action, auth.storeId, options);

    return impactJson(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
