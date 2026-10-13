import { ApiError } from "@/lib/api/apiError";
import type { StockMovementType } from "@/shared/mocks/erp-data";

/**
 * El signo de la cantidad debe casar con el tipo, como exige `adjust_stock`
 * (PT400): los tipos de salida restan y los de entrada suman. Sin `type` el
 * signo decide el tipo y no hay nada que cruzar. Se comprueba en la ruta, antes
 * de elegir el servicio, para que el 400 sea el mismo en BFF real y mock.
 */
export function assertAdjustmentSignMatchesType(input: {
  quantityDelta: number;
  type?: StockMovementType;
}) {
  const isExitType = input.type === "ajuste_salida" || input.type === "devolucion_proveedor";
  const isEntryType =
    input.type === "ajuste_entrada" ||
    input.type === "devolucion_cliente" ||
    input.type === "inventario_inicial";

  if (isExitType && input.quantityDelta > 0) {
    throw new ApiError(400, "BAD_REQUEST", "Una salida debe restar unidades.");
  }

  if (isEntryType && input.quantityDelta < 0) {
    throw new ApiError(400, "BAD_REQUEST", "Una entrada debe sumar unidades.");
  }
}
