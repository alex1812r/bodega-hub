import { ApiError } from "@/lib/api/apiError";
import type { StockMovementType } from "@/shared/mocks/erp-data";

/**
 * R4 / C15: una devolucion sin documento no tiene tope "vendido/recibido − ya
 * devuelto" y duplica unidades junto a la devolucion total del documento. Se
 * rechaza antes de mover stock; el ajuste libre ya no ofrece estos tipos.
 */
export function assertReturnAdjustmentHasDocument(input: {
  purchaseId?: string;
  saleId?: string;
  type?: StockMovementType;
}) {
  if (input.type === "devolucion_cliente" && !input.saleId) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "Una devolucion de cliente debe indicar la venta a la que corresponde (saleId).",
    );
  }

  if (input.type === "devolucion_proveedor" && !input.purchaseId) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "Una devolucion a proveedor debe indicar la compra a la que corresponde (purchaseId).",
    );
  }
}
