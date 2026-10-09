/** Largo máximo del motivo de un ajuste o de una conversión, sin los espacios de los extremos. */
export const STOCK_REASON_MAX_LENGTH = 500;

export const STOCK_REASON_TOO_LONG_MESSAGE = `El motivo admite hasta ${STOCK_REASON_MAX_LENGTH} caracteres.`;

export const STOCK_REASON_INVALID_CHARACTERS_MESSAGE = "El motivo contiene caracteres no permitidos.";

/** Ayuda del campo "Motivo": cuánto lleva escrito de lo que cabe. */
export function describeStockReasonLength(reason: string) {
  return `${reason.length} de ${STOCK_REASON_MAX_LENGTH} caracteres.`;
}

/** Espacios y caracteres que no se ven (ancho cero, BOM, guion opcional) en un extremo del motivo. */
const REASON_EDGE_PADDING = /^[\s­​-‍⁠﻿]+|[\s­​-‍⁠﻿]+$/g;

/**
 * El motivo sin lo que no se lee en sus extremos. Un motivo hecho solo de espacios o de
 * caracteres invisibles queda en "": no cuenta como motivo.
 */
export function trimStockReason(reason: string) {
  return reason.replace(REASON_EDGE_PADDING, "");
}
