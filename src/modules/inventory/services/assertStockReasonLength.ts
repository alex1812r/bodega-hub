import { ApiError } from "@/lib/api/apiError";

import {
  STOCK_REASON_MAX_LENGTH,
  STOCK_REASON_TOO_LONG_MESSAGE,
} from "../utils/stockReason";

/**
 * Tope del motivo de un movimiento de stock, igual en BFF real y mock (lo
 * aplica la ruta antes de elegir el servicio). El motivo viaja en cada listado
 * y en el Excel: sin tope, un texto enorme se guardaba tal cual. Va fuera del
 * schema para que el 400 lleve su mensaje y no el genérico de zod.
 */
export function assertStockReasonLength(reason: string | undefined) {
  if (reason !== undefined && reason.trim().length > STOCK_REASON_MAX_LENGTH) {
    throw new ApiError(400, "BAD_REQUEST", STOCK_REASON_TOO_LONG_MESSAGE);
  }
}
