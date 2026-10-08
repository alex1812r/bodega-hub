/**
 * Efecto de mover el stock de un producto en `delta` unidades (positivo = entra,
 * negativo = sale): con cuánto queda y si quedaría en negativo.
 *
 * Aún no la usa ninguna pantalla. Es para CNF-08 (Confirmaciones): el modal de
 * ajuste de stock y la conversión de empaque 1 a 1 pintarán con ella el
 * "antes → después" de su `ConfirmActionModal`. La apertura de un surtido usa
 * `computePackOpeningEffect`.
 */

export type StockAdjustmentEffect = {
  delta: number;
  stockAfter: number;
  stockBefore: number;
  /** El stock resultante sería menor que cero: la base lo rechaza. */
  wouldBeNegative: boolean;
};

/**
 * El stock es entero (`products.current_stock integer`): no hay redondeo. Un
 * `delta` no finito (campo vacío o a medio escribir) cuenta como 0.
 */
export function computeStockAdjustmentEffect(input: {
  currentStock: number;
  delta: number;
}): StockAdjustmentEffect {
  const delta = Number.isFinite(input.delta) ? input.delta : 0;
  const stockAfter = input.currentStock + delta;

  return {
    delta,
    stockAfter,
    stockBefore: input.currentStock,
    wouldBeNegative: stockAfter < 0,
  };
}
