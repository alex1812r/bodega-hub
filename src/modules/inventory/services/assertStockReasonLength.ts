import { ApiError } from "@/lib/api/apiError";

import { stripControlChars } from "@/modules/products/services/productText";

import {
  STOCK_REASON_INVALID_CHARACTERS_MESSAGE,
  STOCK_REASON_MAX_LENGTH,
  STOCK_REASON_TOO_LONG_MESSAGE,
} from "../utils/stockReason";

/**
 * Motivo de un ajuste o de una conversión sin caracteres de control (NUL, resto
 * de C0, DEL y C1): Postgres no admite NUL en `text` y la petición salía como
 * 500. Tabulador, salto de línea y retorno de carro sí se aceptan. Igual en BFF
 * real y mock, y fuera del schema para que el 400 lleve su mensaje.
 */
export function assertStockReasonCharacters(reason: string | undefined) {
  if (reason !== undefined && stripControlChars(reason) !== reason) {
    throw new ApiError(400, "BAD_REQUEST", STOCK_REASON_INVALID_CHARACTERS_MESSAGE);
  }
}

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
