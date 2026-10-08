/** Largo máximo del motivo de un ajuste o de una conversión, sin los espacios de los extremos. */
export const STOCK_REASON_MAX_LENGTH = 500;

export const STOCK_REASON_TOO_LONG_MESSAGE = `El motivo admite hasta ${STOCK_REASON_MAX_LENGTH} caracteres.`;

/** Ayuda del campo "Motivo": cuánto lleva escrito de lo que cabe. */
export function describeStockReasonLength(reason: string) {
  return `${reason.length} de ${STOCK_REASON_MAX_LENGTH} caracteres.`;
}
