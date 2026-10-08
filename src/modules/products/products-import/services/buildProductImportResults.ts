import type { ProductImportRowResult, ProductImportValidatedRow } from "../types";

const NOT_PROCESSED_MESSAGE = "No se procesó: la importación se detuvo antes de esta fila.";
const INVALID_ROW_MESSAGE = "La fila no pasó la validación.";

/**
 * Resultado final de la importación, una entrada por fila del archivo. El job
 * solo informa de las filas que envió: aquí se añaden las que la vista previa
 * rechazó (error, con su motivo) y las válidas que no llegaron a enviarse
 * (omitidas), para que el resumen nunca diga "0 errores" con filas sin crear.
 */
export function buildProductImportResults(
  rows: ProductImportValidatedRow[],
  jobResults: ProductImportRowResult[],
): ProductImportRowResult[] {
  const resultByRow = new Map(jobResults.map((result) => [result.rowIndex, result]));

  return rows.map((row) => {
    const jobResult = resultByRow.get(row.rowIndex);

    if (jobResult) {
      return jobResult;
    }

    if (row.status === "error" || !row.input) {
      return {
        error: row.messages.join(" ") || INVALID_ROW_MESSAGE,
        rowIndex: row.rowIndex,
        sku: row.sku,
        status: "failed",
      };
    }

    return {
      error: NOT_PROCESSED_MESSAGE,
      rowIndex: row.rowIndex,
      sku: row.sku,
      status: "skipped",
    };
  });
}
